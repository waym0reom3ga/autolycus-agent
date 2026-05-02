import type { HermesConnection } from '@/global'

export const TITLEBAR_HEIGHT = 34
export const MACOS_TRAFFIC_LIGHTS_HEIGHT = 14
export const TITLEBAR_ICON_SIZE = 12
export const TITLEBAR_CONTROL_OFFSET_X = 60
export const TITLEBAR_CONTROL_HEIGHT = 22
export const TITLEBAR_CONTROLS_TOP = (TITLEBAR_HEIGHT - TITLEBAR_CONTROL_HEIGHT) / 2

const WINDOW_BUTTON_FALLBACK = {
  x: 24,
  y: TITLEBAR_HEIGHT / 2 - MACOS_TRAFFIC_LIGHTS_HEIGHT / 2
}

export const titlebarButtonClass =
  'h-[var(--titlebar-control-height)] w-[var(--titlebar-control-size)] rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'

export const titlebarHeaderBaseClass =
  'relative z-3 flex h-(--titlebar-height) shrink-0 items-center justify-center gap-3 bg-background/70 px-[max(0.75rem,var(--titlebar-content-inset,0px))] backdrop-blur-sm'

export const titlebarHeaderShadowClass =
  "shadow-header after:pointer-events-none after:absolute after:left-0 after:right-0 after:top-full after:h-10 after:bg-linear-to-b after:from-background after:via-background/80 after:to-transparent after:content-['']"

export function titlebarControlsPosition(windowButtonPosition: HermesConnection['windowButtonPosition'] | undefined) {
  const position = windowButtonPosition || WINDOW_BUTTON_FALLBACK

  return {
    left: position.x + TITLEBAR_CONTROL_OFFSET_X,
    top: Math.max(0, TITLEBAR_CONTROLS_TOP)
  }
}
