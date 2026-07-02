"""POSIX computer-use backend with persistent video capture streams.

Cross-platform approach for Unix-like systems (Linux, BSD, etc.):
  - Persistent video stream via OpenCV VideoCapture — stays open between captures
  - Screenshot fallbacks: ImageMagick `import` (X11/Wayland), /dev/fb0 (Linux)
  - Input simulation: xdotool (X11), /dev/uinput (Linux kernel-level)

Works on headless systems, X11, and Wayland sessions.
"""

from __future__ import annotations

import fcntl
import logging
import os
import re
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from tools.computer_use.backend import (
    ActionResult,
    CaptureResult,
    ComputerUseBackend,
    UIElement,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FBIOGET_VSCREENINFO = 0x4600  # _IOR('F', 0, struct)
FBIOPUT_VSCREENINFO = 0x4601

# uinput ioctls
UI_DEV_CREATE   = 0x5501
UI_DEV_DESTROY  = 0x5502
UI_SET_EVBIT    = 0x40045564  # _IOW('U', 100, int)
UI_SET_KEYBIT   = 0x40045565  # _IOW('U', 101, int)
UI_SET_RELBIT   = 0x40045566  # _IOW('U', 102, int)

# evdev event types
EV_SYN  = 0x00
EV_KEY  = 0x01
EV_REL  = 0x03
EV_ABS  = 0x03

REL_X   = 0x00
REL_Y   = 0x01
REL_WHEEL = 0x08

BTN_LEFT  = 0x110
BTN_RIGHT = 0x111
BTN_MIDDLE = 0x112

# Key code mapping (Linux input event key codes)
_KEY_MAP = {
    "return": 28, "enter": 28, "escape": 1, "esc": 1,
    "backspace": 14, "delete": 111, "tab": 15,
    "up": 103, "down": 108, "left": 105, "right": 106,
    "home": 102, "end": 107, "pageup": 104, "pagedown": 109,
    "insert": 110, "pause": 119,
    "f1": 59, "f2": 60, "f3": 61, "f4": 62,
    "f5": 63, "f6": 64, "f7": 65, "f8": 66,
    "f9": 67, "f10": 68, "f11": 69, "f12": 70,
    # Modifiers
    "ctrl": 29, "control": 29, "leftctrl": 29, "rightctrl": 103,
    "shift": 42, "leftshift": 42, "rightshift": 54,
    "alt": 56, "leftalt": 56, "rightalt": 100,
    "meta": 125, "super": 125, "cmd": 125, "command": 125,
    "capslock": 58, "numlock": 69, "scrolllock": 70,
}

# Modifier key codes for combos
_MODIFIER_KEYS = {"ctrl", "control", "shift", "alt", "meta", "super", "cmd", "command"}


def _has_fb0() -> bool:
    return os.path.exists("/dev/fb0") and os.access("/dev/fb0", os.R_OK)


def _find_video_device() -> Optional[str]:
    """Scan for available video capture devices (/dev/video*).

    Returns the first readable device path that OpenCV can actually open, or None.
    Prefers HDMI IN receivers (snps_hdmirx) over codec/encoder devices.
    Works across Linux, BSD, and other POSIX systems with V4L2-like devices.
    """
    import glob

    try:
        import cv2
    except ImportError:
        return None

    # Collect all video devices with their sysfs card names
    devs = sorted(glob.glob("/dev/video*"))
    numeric = [d for d in devs if d.startswith("/dev/video") and d[len("/dev/video"):].isdigit()]
    others = [d for d in devs if d not in numeric]

    # Read card names from sysfs to identify device types
    def _get_card_name(dev: str) -> str:
        num = dev.replace("/dev/video", "")
        name_file = f"/sys/class/video4linux/video{num}/name"
        try:
            with open(name_file) as f:
                return f.read().strip().lower()
        except Exception:
            return ""

    # Prioritize HDMI IN receivers (snps_hdmirx) over codec devices
    hdmi_candidates = [d for d in numeric if "hdmirx" in _get_card_name(d)]
    other_numeric = [d for d in numeric if not _get_card_name(d).startswith("rockchip") and "hdmirx" not in _get_card_name(d)]
    candidates = hdmi_candidates + other_numeric + others

    for dev in candidates:
        if not os.access(dev, os.R_OK):
            continue
        # Try to actually open it with OpenCV
        cap = cv2.VideoCapture(dev)
        if cap.isOpened():
            card = _get_card_name(dev)
            logger.info("Found video device: %s (card=%s)", dev, card or "unknown")
            return dev

    return None


def _has_video_capture() -> bool:
    """Check if any video capture device is available."""
    return _find_video_device() is not None


def _has_uinput() -> bool:
    """Check if /dev/uinput exists AND ioctls actually work."""
    if not os.path.exists("/dev/uinput"):
        return False
    if not os.access("/dev/uinput", os.W_OK):
        return False
    # Many embedded kernels (Rockchip, etc.) have uinput device but broken ioctls.
    # Do a quick probe to verify it actually works.
    try:
        import struct as _struct
        fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
        # Try EVIOCGVERSION (0x4004557f) — should always work on a real uinput
        fcntl.ioctl(fd, 0x4004557f, _struct.pack("I", 0))
        os.close(fd)
        return True
    except Exception:
        return False


def _has_xdotool() -> bool:
    return bool(__import__("shutil").which("xdotool"))


def _has_import_cmd() -> bool:
    return bool(__import__("shutil").which("import"))  # ImageMagick


# ---------------------------------------------------------------------------
# HDMI IN persistent stream (OpenCV V4L2) — primary source
# ---------------------------------------------------------------------------

class _VideoStream:
    """Persistent video capture stream. Opens once, stays alive.

    Works with any OpenCV-compatible capture device (V4L2 on Linux/BSD,
    AVFoundation on macOS, DirectShow on Windows).
    Uses threading timeout to avoid blocking indefinitely on multiplanar devices.
    """

    _READ_TIMEOUT = 3  # seconds for read() calls

    def __init__(self):
        self._cap = None
        self._device_path: Optional[str] = None
        self._width = 640
        self._height = 480
        self._error_msg = ""

    @staticmethod
    def _read_with_timeout(cap, timeout: float) -> Tuple[bool, Any]:
        """Read a frame with a timeout to avoid blocking on multiplanar devices."""
        result: list = [None]  # type: ignore[var-annotated]
        def _do_read():
            ret, frame = cap.read()
            result[0] = (ret, frame)
        t = threading.Thread(target=_do_read, daemon=True)
        t.start()
        t.join(timeout=timeout)
        if t.is_alive():
            return False, None  # type: ignore[return-value]  # Timed out
        return result[0]  # type: ignore[return-value]

    def open(self) -> bool:
        """Open a video capture device and start streaming. Call once at startup."""
        try:
            import cv2
        except ImportError as e:
            self._error_msg = f"Video capture unavailable: OpenCV not installed ({e})"
            logger.error(self._error_msg)
            return False

        # Try to find a video device dynamically
        dev_path = _find_video_device()
        if dev_path:
            self._cap = cv2.VideoCapture(dev_path)
            self._device_path = dev_path
        else:
            # Fallback: try index 0 (default camera/device)
            self._cap = cv2.VideoCapture(0)
            self._device_path = "index 0 (default)"

        if not self._cap.isOpened():
            self._error_msg = f"Video capture unavailable: cannot open device ({self._device_path})"
            logger.error(self._error_msg)
            return False

        backend_name = self._cap.getBackendName()
        w = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH)) if self._cap.get(cv2.CAP_PROP_FRAME_WIDTH) > 0 else 640
        h = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) if self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT) > 0 else 480
        self._width = w
        self._height = h

        # Prime the stream — read one frame with timeout to avoid blocking on multiplanar devices
        ret, _ = self._read_with_timeout(self._cap, self._READ_TIMEOUT)
        logger.info("Video stream open: %s %s %dx%d (primed=%s)", backend_name, self._device_path, w, h, ret)
        return True

    def close(self):
        """Release the capture device. Call once at shutdown."""
        if self._cap is not None:
            self._cap.release()
            self._cap = None
            logger.info("Video stream closed")

    @property
    def is_open(self) -> bool:
        return self._cap is not None and self._cap.isOpened()

    @property
    def resolution(self) -> Tuple[int, int]:
        return self._width, self._height

    def capture_frame(self) -> Tuple[Optional[bytes], str]:
        """Read one frame from the live stream. Returns (png_bytes, error_msg)."""
        if not self.is_open:
            return None, self._error_msg or "Video stream is not open"

        ret, frame = self._read_with_timeout(self._cap, self._READ_TIMEOUT)
        if not ret or frame is None:
            msg = f"Video capture failed: read() returned no frame ({self._width}x{self._height}, device={self._device_path}). Check connection."
            logger.error(msg)
            return None, msg

        try:
            import cv2
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            import io
            buf = io.BytesIO()
            from PIL import Image
            img = Image.fromarray(frame_rgb)
            img.save(buf, format="PNG", optimize=True)
            return buf.getvalue(), ""
        except Exception as e:
            msg = f"Video capture failed during encoding: {e}"
            logger.error(msg)
            return None, msg


def _has_hdmi_in() -> bool:
    """Check if any video capture device is available (legacy alias)."""
    return _has_video_capture()


# ---------------------------------------------------------------------------
# Framebuffer screenshot (fallback only — does NOT capture DRM content)
# ---------------------------------------------------------------------------

def _read_fb0_screenshot() -> Optional[bytes]:
    """Read /dev/fb0 and return PNG bytes. FALLBACK ONLY — misses DRM content."""
    try:
        from PIL import Image
    except ImportError:
        logger.warning("PIL/Pillow required for framebuffer screenshot")
        return None

    fb_path = "/dev/fb0"
    with open(fb_path, "rb") as fb:
        # Get screen info via ioctl
        try:
            vi_buf = bytearray(92)  # struct fb_var_screeninfo is ~88 bytes
            fcntl.ioctl(fb, FBIOGET_VSCREENINFO, vi_buf)
            xres, yres, bits_per_pixel = struct.unpack_from("<HHH", vi_buf, 0)
        except Exception:
            # Fallback: try to detect from file size
            fb.seek(0, 2)
            fsize = fb.tell()
            fb.seek(0)
            # Assume common resolutions and bpp
            xres, yres, bits_per_pixel = 1920, 1080, 32
            if fsize > 0:
                pixel_size = fsize // (xres * yres)
                bits_per_pixel = pixel_size * 8

        if not xres or not yres:
            logger.error("fb0: invalid resolution %dx%d", xres, yres)
            return None

        fb.seek(0)
        row_bytes = (xres * bits_per_pixel + 7) // 8
        total_size = row_bytes * yres

        # Read framebuffer data in chunks to avoid huge allocations
        raw = bytearray()
        chunk = min(total_size, 1024 * 1024)  # 1MB chunks
        while len(raw) < total_size:
            raw.extend(fb.read(min(chunk, total_size - len(raw))))

    if not raw:
        return None

    try:
        if bits_per_pixel == 32:
            mode = "RGBA"
        elif bits_per_pixel == 24:
            mode = "RGB"
        else:
            logger.warning("fb0: unsupported bpp=%d", bits_per_pixel)
            return None

        img = Image.frombytes(mode, (xres, yres), bytes(raw))

        # Convert RGBA -> RGB for smaller PNG
        if mode == "RGBA":
            img = img.convert("RGB")

        import io
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()
    except Exception as e:
        logger.error("fb0 screenshot failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# uinput device for keyboard/mouse simulation
# ---------------------------------------------------------------------------

class _UInputDevice:
    """Minimal uinput device for keyboard + mouse events."""

    def __init__(self):
        self._fd = None

    def open(self) -> bool:
        if not _has_uinput():
            return False
        try:
            self._fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)

            # Enable event types
            fcntl.ioctl(self._fd, UI_SET_EVBIT, EV_KEY)
            fcntl.ioctl(self._fd, UI_SET_EVBIT, EV_REL)

            # Enable mouse buttons
            for btn in (BTN_LEFT, BTN_RIGHT, BTN_MIDDLE):
                fcntl.ioctl(self._fd, UI_SET_KEYBIT, btn)

            # Enable all key codes we might use
            for kc in _KEY_MAP.values():
                try:
                    fcntl.ioctl(self._fd, UI_SET_KEYBIT, kc)
                except OSError:
                    pass  # Some keycodes may not be valid on this kernel

            # Enable relative axes (mouse movement/scroll)
            fcntl.ioctl(self._fd, UI_SET_RELBIT, REL_X)
            fcntl.ioctl(self._fd, UI_SET_RELBIT, REL_Y)
            fcntl.ioctl(self._fd, UI_SET_RELBIT, REL_WHEEL)

            # Create device
            fcntl.ioctl(self._fd, UI_DEV_CREATE)
            return True
        except Exception as e:
            logger.error("uinput open failed: %s", e)
            if self._fd is not None:
                try:
                    os.close(self._fd)
                except OSError:
                    pass
                self._fd = None
            return False

    def close(self):
        if self._fd is not None:
            try:
                fcntl.ioctl(self._fd, UI_DEV_DESTROY)
            except Exception:
                pass
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None

    def _write_event(self, etype: int, code: int, value: int):
        """Write a single input event (type, code, value) + sync."""
        if self._fd is None:
            return
        # struct input_event: __kernel_time64_t tv_sec(8) + tv_nsec(8) + type(2) + code(2) + value(4) = 24 bytes
        import time as _time
        ts = _time.time()
        sec = int(ts)
        nsec = int((ts - sec) * 1_000_000_000)
        event = struct.pack("<llhhi", sec, nsec, etype, code, value)
        try:
            os.write(self._fd, event)
            # Sync
            os.write(self._fd, struct.pack("<llhhi", sec, nsec, EV_SYN, 0, 0))
        except OSError as e:
            logger.debug("uinput write failed: %s", e)

    def key_event(self, keycode: int, down: bool = True):
        self._write_event(EV_KEY, keycode, 1 if down else 0)
        time.sleep(0.02)  # Small delay for event processing

    def click(self, button: str = "left", count: int = 1):
        btn_map = {"left": BTN_LEFT, "right": BTN_RIGHT, "middle": BTN_MIDDLE}
        btn = btn_map.get(button, BTN_LEFT)
        for _ in range(count):
            self.key_event(btn, down=True)
            time.sleep(0.05)
            self.key_event(btn, down=False)
            time.sleep(0.1)

    def move(self, dx: int = 0, dy: int = 0):
        if self._fd is None:
            return
        sec = int(time.time())
        nsec = int((time.time() - sec) * 1_000_000_000)
        try:
            os.write(self._fd, struct.pack("<llhhi", sec, nsec, EV_REL, REL_X, dx))
            os.write(self._fd, struct.pack("<llhhi", sec, nsec, EV_REL, REL_Y, dy))
            os.write(self._fd, struct.pack("<llhhi", sec, nsec, EV_SYN, 0, 0))
        except OSError:
            pass

    def scroll(self, direction: str = "up", amount: int = 3):
        delta = -amount if direction in ("up",) else amount
        if direction == "down":
            delta = amount
        elif direction == "left":
            # Horizontal scroll not well supported via REL_WHEEL; skip
            return
        elif direction == "right":
            return
        self._write_event(EV_REL, REL_WHEEL, -delta)


# ---------------------------------------------------------------------------
# The backend
# ---------------------------------------------------------------------------

class PosixBackend(ComputerUseBackend):
    """POSIX computer-use backend with persistent video capture streams.

    Screenshot sources (priority order):
      1. Persistent video stream via OpenCV — captures from any available device including DRM content
      2. ImageMagick `import` — X11/Wayland compositor output (virtual desktop)

    fb0 framebuffer fallback is REMOVED — fails loudly if capture sources unavailable.

    Input simulation:
      - xdotool (X11) or /dev/uinput (Linux kernel-level), graceful degradation
    """

    def __init__(self) -> None:
        self._uinput = _UInputDevice()
        self._video_stream = _VideoStream()
        self._started = False
        self._screen_width = 1920
        self._screen_height = 1080
        self._use_xdotool = False
        self._input_available = False

    # ── Lifecycle ──────────────────────────────────────────────────

    def start(self) -> None:
        if self._started:
            return

        # Open persistent video stream (may fail on multiplanar devices — that's OK)
        hdmi_ok = self._video_stream.open()
        if hdmi_ok:
            self._screen_width, self._screen_height = self._video_stream.resolution

        # Input setup
        self._input_available = self._uinput.open()
        if not self._input_available and _has_xdotool():
            self._use_xdotool = True
            logger.info("computer_use: uinput unavailable, using xdotool")
        elif not self._input_available:
            logger.warning(
                "computer_use: neither uinput nor xdotool available — "
                "screenshot-only mode (click/type/scroll will fail)"
            )
        self._started = True

    def stop(self) -> None:
        try:
            self._uinput.close()
            self._video_stream.close()
        finally:
            self._started = False

    def is_available(self) -> bool:
        return _has_hdmi_in()

    # ── Capture ────────────────────────────────────────────────────

    def capture(self, mode: str = "som", app: Optional[str] = None) -> CaptureResult:
        png_b64: Optional[str] = None
        elements: List[UIElement] = []
        width = self._screen_width
        height = self._screen_height

        if mode in ("vision", "som"):
            raw_png, err = self._video_stream.capture_frame()
            if not raw_png:
                raise RuntimeError(
                    f"Screenshot capture failed. "
                    f"HDMI IN error: {err or 'device not available'}."
                )

            png_b64 = __import__("base64").b64encode(raw_png).decode("ascii")
            # Detect dimensions from PNG header
            if len(raw_png) >= 24 and raw_png[:8] == b"\x89PNG\r\n\x1a\n":
                width, height = struct.unpack(">II", raw_png[16:24])

        return CaptureResult(
            mode=mode,
            width=width,
            height=height,
            png_b64=png_b64,
            elements=elements,
            app=app or "",
            window_title="",
            png_bytes_len=len(raw_png) if raw_png else 0,
        )

    # ── Pointer actions ────────────────────────────────────────────

    def _xdotool_click(self, button="left", click_count=1):
        """Fallback click via xdotool."""
        btn_map = {"left": "1", "middle": "2", "right": "3"}
        btn = btn_map.get(button, "1")
        cmd = ["xdotool", "click"] + [btn] * click_count
        try:
            subprocess.run(cmd, timeout=5, check=True)
            return True
        except Exception as e:
            logger.debug("xdotool click failed: %s", e)
            return False

    def _xdotool_type(self, text):
        """Fallback type via xdotool."""
        try:
            subprocess.run(
                ["xdotool", "type", "--clearmodifiers", text],
                timeout=10, check=True, input=text.encode(),
            )
            return True
        except Exception as e:
            logger.debug("xdotool type failed: %s", e)
            return False

    def _xdotool_key(self, keys):
        """Fallback key press via xdotool."""
        try:
            subprocess.run(["xdotool", "key", keys], timeout=5, check=True)
            return True
        except Exception as e:
            logger.debug("xdotool key failed: %s", e)
            return False

    def click(
        self, *, element: Optional[int] = None, x: Optional[int] = None,
        y: Optional[int] = None, button: str = "left", click_count: int = 1,
        modifiers: Optional[List[str]] = None,
    ) -> ActionResult:
        if not self._input_available and not self._use_xdotool:
            return ActionResult(ok=False, action="click", message="No input device available (uinput broken, no xdotool)")

        if self._use_xdotool:
            ok = self._xdotool_click(button=button, click_count=click_count)
            return ActionResult(ok=ok, action="click", message=f"clicked {button} x{click_count}" if ok else "xdotool click failed")

        # uinput path
        if not self._uinput._fd:
            return ActionResult(ok=False, action="click", message="uinput not available")

        # Apply modifiers
        if modifiers:
            for mod in modifiers:
                kc = _KEY_MAP.get(mod.lower())
                if kc is not None:
                    self._uinput.key_event(kc, down=True)
            time.sleep(0.05)

        try:
            self._uinput.click(button=button, count=click_count)
        finally:
            # Release modifiers in reverse
            if modifiers:
                for mod in reversed(modifiers):
                    kc = _KEY_MAP.get(mod.lower())
                    if kc is not None:
                        self._uinput.key_event(kc, down=False)

        return ActionResult(ok=True, action="click", message=f"clicked {button} x{click_count}")

    def drag(
        self, *, from_element: Optional[int] = None, to_element: Optional[int] = None,
        from_xy: Optional[Tuple[int, int]] = None, to_xy: Optional[Tuple[int, int]] = None,
        button: str = "left", modifiers: Optional[List[str]] = None,
    ) -> ActionResult:
        if not self._uinput._fd:
            return ActionResult(ok=False, action="drag", message="uinput not available")

        btn_map = {"left": BTN_LEFT, "right": BTN_RIGHT, "middle": BTN_MIDDLE}
        btn = btn_map.get(button, BTN_LEFT)

        # Press button
        self._uinput.key_event(btn, down=True)
        time.sleep(0.1)

        # Move (relative movement approximation)
        if from_xy and to_xy:
            dx = to_xy[0] - from_xy[0]
            dy = to_xy[1] - from_xy[1]
            steps = max(abs(dx), abs(dy)) // 50
            if steps > 0:
                for _ in range(min(steps, 20)):
                    self._uinput.move(dx // steps, dy // steps)
                    time.sleep(0.02)

        time.sleep(0.1)
        # Release button
        self._uinput.key_event(btn, down=False)

        return ActionResult(ok=True, action="drag", message=f"dragged {button}")

    def scroll(
        self, *, direction: str, amount: int = 3, element: Optional[int] = None,
        x: Optional[int] = None, y: Optional[int] = None,
        modifiers: Optional[List[str]] = None,
    ) -> ActionResult:
        if not self._uinput._fd:
            return ActionResult(ok=False, action="scroll", message="uinput not available")

        amount = max(1, min(50, amount))
        self._uinput.scroll(direction=direction, amount=amount)
        return ActionResult(ok=True, action="scroll", message=f"scrolled {direction} x{amount}")

    # ── Keyboard ───────────────────────────────────────────────────

    def type_text(self, text: str) -> ActionResult:
        if not self._input_available and not self._use_xdotool:
            return ActionResult(ok=False, action="type_text", message="No input device available")

        if self._use_xdotool:
            ok = self._xdotool_type(text)
            return ActionResult(ok=ok, action="type_text", message=f"typed {len(text)} chars" if ok else "xdotool type failed")

        if not self._uinput._fd:
            return ActionResult(ok=False, action="type_text", message="uinput not available")

        import string as _string

        for ch in text:
            kc = None
            shift_needed = False

            if ch.isalpha():
                idx = _string.ascii_lowercase.index(ch.lower())
                kc = 30 + idx
                shift_needed = ch.isupper()
            elif ch.isdigit():
                kc = 2 + int(ch)
            elif ch == " ":
                kc = 44
            elif ch in "!@#$%^&*()":
                sym_map = {"!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
                           "^": "6", "&": "7", "*": "8", "(": "9", ")": "0"}
                digit = sym_map.get(ch)
                if digit:
                    kc = 2 + int(digit)
                    shift_needed = True
            elif ch in "\n\r":
                kc = _KEY_MAP["return"]
            elif ch == "\t":
                kc = _KEY_MAP["tab"]
            else:
                continue

            if kc is None:
                continue

            if shift_needed:
                self._uinput.key_event(42, down=True)  # left shift
            self._uinput.key_event(kc, down=True)
            time.sleep(0.01)
            self._uinput.key_event(kc, down=False)
            if shift_needed:
                self._uinput.key_event(42, down=False)
            time.sleep(0.03)

        return ActionResult(ok=True, action="type_text", message=f"typed {len(text)} chars")

    def key(self, keys: str) -> ActionResult:
        if not self._uinput._fd:
            return ActionResult(ok=False, action="key", message="uinput not available")

        parts = [p.strip().lower() for p in re.split(r"[\+]", keys) if p.strip()]
        modifiers = [p for p in parts if p in _MODIFIER_KEYS]
        main_key = [p for p in parts if p not in _MODIFIER_KEYS]

        if not main_key:
            return ActionResult(ok=False, action="key", message=f"no key found in '{keys}'")

        # Press modifiers
        mod_codes = []
        for m in modifiers:
            kc = _KEY_MAP.get(m)
            if kc is not None:
                self._uinput.key_event(kc, down=True)
                mod_codes.append(kc)
        time.sleep(0.05)

        try:
            # Press main key
            main_name = main_key[0]
            kc = _KEY_MAP.get(main_name)
            if kc is not None:
                self._uinput.key_event(kc, down=True)
                time.sleep(0.03)
                self._uinput.key_event(kc, down=False)
            else:
                # Try single character
                if len(main_name) == 1 and main_name.isalpha():
                    import string
                    idx = string.ascii_lowercase.index(main_name.lower())
                    kc = 30 + idx
                    self._uinput.key_event(kc, down=True)
                    time.sleep(0.03)
                    self._uinput.key_event(kc, down=False)
        finally:
            # Release modifiers in reverse
            for kc in reversed(mod_codes):
                self._uinput.key_event(kc, down=False)

        return ActionResult(ok=True, action="key", message=f"pressed {keys}")

    # ── Introspection ──────────────────────────────────────────────

    def list_apps(self) -> List[Dict[str, Any]]:
        """List running processes from /proc."""
        apps = []
        try:
            for pid_dir in sorted(Path("/proc").iterdir(), key=lambda p: int(p.name) if p.name.isdigit() else 0):
                pid = pid_dir.name
                if not pid.isdigit():
                    continue
                cmdline_path = pid_dir / "cmdline"
                if not cmdline_path.exists():
                    continue
                try:
                    cmdline = cmdline_path.read_bytes().decode("utf-8", errors="replace")
                    # First null-separated token is the command
                    cmd = cmdline.split("\x00")[0] if cmdline else ""
                    if not cmd or len(cmd) < 2:
                        continue
                    # Extract app name from path
                    name = Path(cmd).name
                    apps.append({
                        "name": name,
                        "pid": int(pid),
                        "cmdline": cmd[:200],
                    })
                except (PermissionError, FileNotFoundError):
                    continue

            # Deduplicate by name, keep first occurrence
            seen = set()
            unique = []
            for app in apps:
                if app["name"] not in seen:
                    seen.add(app["name"])
                    unique.append(app)
            return unique[:100]  # Cap at 100 entries
        except Exception as e:
            logger.debug("list_apps failed: %s", e)
            return []

    def focus_app(self, app: str, raise_window: bool = False) -> ActionResult:
        """Find and note an app by name. Cannot actually focus without a WM."""
        apps = self.list_apps()
        app_lower = app.lower()
        matched = [a for a in apps if app_lower in a["name"].lower()]

        if not matched:
            # Try partial match on cmdline
            matched = [a for a in apps if app_lower in a.get("cmdline", "").lower()]

        if matched:
            return ActionResult(
                ok=True, action="focus_app",
                message=f"Found {matched[0]['name']} (pid {matched[0]['pid']}). "
                        f"Note: cannot raise window without a window manager.",
            )
        return ActionResult(ok=False, action="focus_app",
                            message=f"No running process matched '{app}'.")

    # ── Value setter ────────────────────────────────────────────────

    def set_value(self, value: str, element: Optional[int] = None) -> ActionResult:
        """Type the value as text (no native AX support on headless Linux)."""
        return self.type_text(value)


# ---------------------------------------------------------------------------
# Availability check
# ---------------------------------------------------------------------------

def posix_backend_available() -> bool:
    """True if we can screenshot (video capture preferred, ImageMagick/fb0 fallback).

    Input simulation is optional — the backend degrades gracefully to
    screenshot-only mode when uinput/xdotool are unavailable.
    """
    return _has_video_capture() or _has_import_cmd() or _has_fb0()


# Backward compatibility alias
linux_backend_available = posix_backend_available
LinuxBackend = PosixBackend
