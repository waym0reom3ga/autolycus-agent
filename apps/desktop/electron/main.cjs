const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  safeStorage,
  session,
  shell,
  systemPreferences
} = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const path = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const {
  bundledRuntimeImportCheck,
  isWindowsBinaryPathInWsl,
  isWslEnvironment
} = require('./bootstrap-platform.cjs')

const USER_DATA_OVERRIDE = process.env.HERMES_DESKTOP_USER_DATA_DIR
if (USER_DATA_OVERRIDE) {
  const resolvedUserData = path.resolve(USER_DATA_OVERRIDE)
  fs.mkdirSync(resolvedUserData, { recursive: true })
  app.setPath('userData', resolvedUserData)
}

const PORT_FLOOR = 9120
const PORT_CEILING = 9199
const DEV_SERVER = process.env.HERMES_DESKTOP_DEV_SERVER
const IS_PACKAGED = app.isPackaged
const IS_MAC = process.platform === 'darwin'
const IS_WINDOWS = process.platform === 'win32'
const IS_WSL = isWslEnvironment()
const APP_ROOT = app.getAppPath()
const SOURCE_REPO_ROOT = path.resolve(APP_ROOT, '../..')
const BUNDLED_HERMES_ROOT = path.join(process.resourcesPath, 'hermes-agent')
const BUNDLED_VENV_ROOT = path.join(app.getPath('userData'), 'hermes-runtime')
const BUNDLED_VENV_MARKER = path.join(BUNDLED_VENV_ROOT, '.hermes-desktop-runtime.json')
const DESKTOP_CONNECTION_CONFIG_PATH = path.join(app.getPath('userData'), 'connection.json')
const DESKTOP_LOG_PATH = path.join(app.getPath('userData'), 'desktop.log')
const DESKTOP_LOG_FLUSH_MS = 120
const DESKTOP_LOG_BUFFER_MAX_CHARS = 64 * 1024
const BOOT_FAKE_MODE = process.env.HERMES_DESKTOP_BOOT_FAKE === '1'
const BOOT_FAKE_STEP_MS = (() => {
  const raw = Number.parseInt(String(process.env.HERMES_DESKTOP_BOOT_FAKE_STEP_MS || ''), 10)
  if (!Number.isFinite(raw) || raw <= 0) return 650
  return Math.max(120, raw)
})()
const RUNTIME_SCHEMA_VERSION = 3
const BUNDLED_RUNTIME_REQUIREMENTS = [
  'openai>=2.21.0,<3',
  'anthropic>=0.39.0,<1',
  'python-dotenv>=1.2.1,<2',
  'fire>=0.7.1,<1',
  'httpx[socks]>=0.28.1,<1',
  'rich>=14.3.3,<15',
  'tenacity>=9.1.4,<10',
  'pyyaml>=6.0.2,<7',
  'requests>=2.32.0,<3',
  'jinja2>=3.1.5,<4',
  'pydantic>=2.12.5,<3',
  'prompt_toolkit>=3.0.52,<4',
  'exa-py>=2.9.0,<3',
  'firecrawl-py>=4.16.0,<5',
  'parallel-web>=0.4.2,<1',
  'fal-client>=0.13.1,<1',
  'croniter>=6.0.0,<7',
  'edge-tts>=7.2.7,<8',
  'PyJWT[crypto]>=2.12.0,<3',
  'fastapi>=0.104.0,<1',
  'uvicorn[standard]>=0.24.0,<1',
  IS_WINDOWS ? 'pywinpty>=2.0.0,<3' : 'ptyprocess>=0.7.0,<1'
]
const BUNDLED_RUNTIME_IMPORT_CHECK = bundledRuntimeImportCheck()
const APP_NAME = 'Hermes'
const TITLEBAR_HEIGHT = 34
const MACOS_TRAFFIC_LIGHTS_HEIGHT = 14
const WINDOW_BUTTON_POSITION = {
  x: 24,
  y: TITLEBAR_HEIGHT / 2 - MACOS_TRAFFIC_LIGHTS_HEIGHT / 2
}
const APP_ICON_PATHS = [
  path.join(APP_ROOT, 'public', 'apple-touch-icon.png'),
  path.join(APP_ROOT, 'dist', 'apple-touch-icon.png'),
  path.join(unpackedPathFor(APP_ROOT), 'dist', 'apple-touch-icon.png')
]

const MEDIA_MIME_TYPES = {
  '.avi': 'video/x-msvideo',
  '.bmp': 'image/bmp',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp'
}

const PREVIEW_HTML_EXTENSIONS = new Set(['.html', '.htm'])
const PREVIEW_WATCH_DEBOUNCE_MS = 120
const LOCAL_PREVIEW_HOSTS = new Set(['0.0.0.0', '127.0.0.1', '::1', '[::1]', 'localhost'])
const TEXT_PREVIEW_MAX_BYTES = 512 * 1024
const PREVIEW_LANGUAGE_BY_EXT = {
  '.c': 'c',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.css': 'css',
  '.csv': 'csv',
  '.go': 'go',
  '.graphql': 'graphql',
  '.h': 'c',
  '.hpp': 'cpp',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'jsx',
  '.kt': 'kotlin',
  '.lua': 'lua',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'shell',
  '.sql': 'sql',
  '.svg': 'xml',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.txt': 'text',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shell'
}

function looksBinary(buffer) {
  if (!buffer.length) return false

  let suspicious = 0

  for (const byte of buffer) {
    if (byte === 0) return true
    // Allow common whitespace controls: tab, LF, CR.
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) suspicious += 1
  }

  return suspicious / buffer.length > 0.12
}

function previewFileMetadata(filePath, mimeType) {
  let byteSize = 0
  let binary = false

  try {
    const stat = fs.statSync(filePath)
    byteSize = stat.size

    if (!mimeType.startsWith('image/')) {
      const fd = fs.openSync(filePath, 'r')

      try {
        const sample = Buffer.alloc(Math.min(byteSize, 4096))
        const bytesRead = fs.readSync(fd, sample, 0, sample.length, 0)
        binary = looksBinary(sample.subarray(0, bytesRead))
      } finally {
        fs.closeSync(fd)
      }
    }
  } catch {
    // Metadata is best-effort; the read handlers surface hard errors later.
  }

  return {
    binary,
    byteSize,
    large: byteSize > TEXT_PREVIEW_MAX_BYTES
  }
}

app.setName(APP_NAME)
app.setAboutPanelOptions({
  applicationName: APP_NAME,
  copyright: 'Copyright © 2026 Nous Research'
})

let mainWindow = null
let hermesProcess = null
let connectionPromise = null
let connectionConfigCache = null
const hermesLog = []
const previewWatchers = new Map()
let previewShortcutActive = false
let desktopLogBuffer = ''
let desktopLogFlushTimer = null
let desktopLogFlushPromise = Promise.resolve()
let bootProgressState = {
  error: null,
  fakeMode: BOOT_FAKE_MODE,
  message: 'Waiting to start Hermes backend',
  phase: 'idle',
  progress: 0,
  running: false,
  timestamp: Date.now()
}

function flushDesktopLogBufferSync() {
  if (!desktopLogBuffer) return
  const chunk = desktopLogBuffer
  desktopLogBuffer = ''

  try {
    fs.mkdirSync(path.dirname(DESKTOP_LOG_PATH), { recursive: true })
    fs.appendFileSync(DESKTOP_LOG_PATH, chunk)
  } catch {
    // Logging must never block app startup/shutdown.
  }
}

function flushDesktopLogBufferAsync() {
  if (!desktopLogBuffer) return desktopLogFlushPromise
  const chunk = desktopLogBuffer
  desktopLogBuffer = ''

  desktopLogFlushPromise = desktopLogFlushPromise
    .then(async () => {
      await fs.promises.mkdir(path.dirname(DESKTOP_LOG_PATH), { recursive: true })
      await fs.promises.appendFile(DESKTOP_LOG_PATH, chunk)
    })
    .catch(() => {
      // Logging must never crash the desktop shell.
    })

  return desktopLogFlushPromise
}

function scheduleDesktopLogFlush() {
  if (desktopLogFlushTimer) return
  desktopLogFlushTimer = setTimeout(() => {
    desktopLogFlushTimer = null
    void flushDesktopLogBufferAsync()
  }, DESKTOP_LOG_FLUSH_MS)
}

function rememberLog(chunk) {
  const text = String(chunk || '').trim()
  if (!text) return
  const lines = text.split(/\r?\n/).map(line => `[hermes] ${line}`)
  hermesLog.push(...lines)
  if (hermesLog.length > 300) {
    hermesLog.splice(0, hermesLog.length - 300)
  }

  desktopLogBuffer += `${lines.join('\n')}\n`

  if (desktopLogBuffer.length >= DESKTOP_LOG_BUFFER_MAX_CHARS) {
    if (desktopLogFlushTimer) {
      clearTimeout(desktopLogFlushTimer)
      desktopLogFlushTimer = null
    }
    void flushDesktopLogBufferAsync()

    return
  }

  scheduleDesktopLogFlush()
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function clampBootProgress(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function broadcastBootProgress() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { webContents } = mainWindow
  if (!webContents || webContents.isDestroyed()) return
  webContents.send('hermes:boot-progress', bootProgressState)
}

function updateBootProgress(update, options = {}) {
  const nextProgressRaw =
    typeof update.progress === 'number' ? clampBootProgress(update.progress) : bootProgressState.progress
  const nextProgress = options.allowDecrease ? nextProgressRaw : Math.max(bootProgressState.progress, nextProgressRaw)

  bootProgressState = {
    ...bootProgressState,
    ...update,
    error: update.error === undefined ? bootProgressState.error : update.error,
    fakeMode: BOOT_FAKE_MODE || Boolean(update.fakeMode),
    progress: nextProgress,
    timestamp: Date.now()
  }

  if (update.message) {
    rememberLog(`[boot] ${update.message}`)
  }

  broadcastBootProgress()
}

async function advanceBootProgress(phase, message, progress) {
  updateBootProgress({
    phase,
    message,
    progress,
    running: true,
    error: null
  })

  if (BOOT_FAKE_MODE) {
    await sleep(BOOT_FAKE_STEP_MS)
  }
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function directoryExists(filePath) {
  try {
    return fs.statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

function unpackedPathFor(filePath) {
  return filePath.replace(/app\.asar(?=$|[\\/])/, 'app.asar.unpacked')
}

function findOnPath(command) {
  if (!command) return null

  if (path.isAbsolute(command) || command.includes(path.sep) || (IS_WINDOWS && command.includes('/'))) {
    if (!fileExists(command)) return null
    if (isWindowsBinaryPathInWsl(command, { isWsl: IS_WSL })) return null
    return command
  }

  const pathEntries = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
  const extensions = IS_WINDOWS
    ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : ['']

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${command}${extension}`)
      if (fileExists(candidate)) return candidate
    }
  }

  return null
}

function isCommandScript(command) {
  return IS_WINDOWS && /\.(cmd|bat)$/i.test(command || '')
}

function isHermesSourceRoot(root) {
  return directoryExists(root) && fileExists(path.join(root, 'hermes_cli', 'main.py'))
}

function findPythonForRoot(root) {
  const override = process.env.HERMES_DESKTOP_PYTHON
  if (override && fileExists(override)) return override

  const relativePaths = IS_WINDOWS
    ? [path.join('.venv', 'Scripts', 'python.exe'), path.join('venv', 'Scripts', 'python.exe')]
    : [path.join('.venv', 'bin', 'python'), path.join('venv', 'bin', 'python')]

  for (const relativePath of relativePaths) {
    const candidate = path.join(root, relativePath)
    if (fileExists(candidate)) return candidate
  }

  return findSystemPython()
}

function findSystemPython() {
  const commands = IS_WINDOWS ? ['python.exe', 'py.exe', 'python'] : ['python3', 'python']

  for (const command of commands) {
    const candidate = findOnPath(command)
    if (candidate) return candidate
  }

  return null
}

function getVenvPython(venvRoot) {
  return path.join(venvRoot, IS_WINDOWS ? path.join('Scripts', 'python.exe') : path.join('bin', 'python'))
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: Boolean(options.shell),
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout.on('data', rememberLog)
    child.stderr.on('data', rememberLog)
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${path.basename(command)} exited with code ${code}: ${recentHermesLog()}`))
      }
    })
  })
}

function recentHermesLog() {
  return hermesLog.slice(-20).join('\n')
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function resolveWebDist() {
  const override = process.env.HERMES_DESKTOP_WEB_DIST
  if (override && directoryExists(path.resolve(override))) return path.resolve(override)

  const unpackedDist = path.join(unpackedPathFor(APP_ROOT), 'dist')
  if (directoryExists(unpackedDist)) return unpackedDist

  return path.join(APP_ROOT, 'dist')
}

function resolveRendererIndex() {
  const candidates = [path.join(APP_ROOT, 'dist', 'index.html'), path.join(resolveWebDist(), 'index.html')]
  return candidates.find(fileExists) || candidates[0]
}

function resolveHermesCwd() {
  const candidates = [
    process.env.HERMES_DESKTOP_CWD,
    process.env.INIT_CWD,
    process.cwd(),
    !IS_PACKAGED ? SOURCE_REPO_ROOT : null,
    app.getPath('home')
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const resolved = path.resolve(String(candidate))
    if (directoryExists(resolved)) return resolved
  }

  return app.getPath('home')
}

function createPythonBackend(root, label, dashboardArgs, options = {}) {
  const python = findPythonForRoot(root)
  if (!python) return null

  return {
    kind: 'python',
    label,
    command: python,
    args: ['-m', 'hermes_cli.main', ...dashboardArgs],
    env: {
      PYTHONPATH: [root, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)
    },
    root,
    bootstrap: Boolean(options.bootstrap),
    shell: false
  }
}

function createBundledBackend(root, dashboardArgs) {
  const python = getVenvPython(BUNDLED_VENV_ROOT)

  return {
    kind: 'python',
    label: 'bundled Hermes',
    command: fileExists(python) ? python : findSystemPython(),
    args: ['-m', 'hermes_cli.main', ...dashboardArgs],
    env: {
      PYTHONPATH: [root, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)
    },
    root,
    bootstrap: true,
    shell: false
  }
}

function resolveHermesBackend(dashboardArgs) {
  const overrideRoot = process.env.HERMES_DESKTOP_HERMES_ROOT && path.resolve(process.env.HERMES_DESKTOP_HERMES_ROOT)
  if (overrideRoot && isHermesSourceRoot(overrideRoot)) {
    const backend = createPythonBackend(overrideRoot, `Hermes source at ${overrideRoot}`, dashboardArgs)
    if (backend) return backend
  }

  if (process.env.HERMES_DESKTOP_IGNORE_EXISTING !== '1') {
    let hermesCommand = null
    const hermesOverride = process.env.HERMES_DESKTOP_HERMES

    if (hermesOverride) {
      const resolvedOverride = findOnPath(hermesOverride)
      if (resolvedOverride) {
        hermesCommand = resolvedOverride
      } else if (!isWindowsBinaryPathInWsl(hermesOverride, { isWsl: IS_WSL })) {
        hermesCommand = hermesOverride
      } else {
        rememberLog(`Ignoring Windows Hermes override under WSL: ${hermesOverride}`)
      }
    } else {
      hermesCommand = findOnPath('hermes')
    }

    if (hermesCommand) {
      return {
        label: `existing Hermes CLI at ${hermesCommand}`,
        command: hermesCommand,
        args: dashboardArgs,
        bootstrap: false,
        env: {},
        kind: 'command',
        shell: isCommandScript(hermesCommand)
      }
    }
  }

  if (IS_PACKAGED && isHermesSourceRoot(BUNDLED_HERMES_ROOT)) {
    const backend = createBundledBackend(BUNDLED_HERMES_ROOT, dashboardArgs)
    if (backend.command) return backend
  }

  if (!IS_PACKAGED && isHermesSourceRoot(SOURCE_REPO_ROOT)) {
    const backend = createPythonBackend(SOURCE_REPO_ROOT, `Hermes source at ${SOURCE_REPO_ROOT}`, dashboardArgs)
    if (backend) return backend
  }

  const python = findSystemPython()
  if (python) {
    return {
      kind: 'python',
      label: `installed hermes_cli module via ${python}`,
      command: python,
      args: ['-m', 'hermes_cli.main', ...dashboardArgs],
      bootstrap: false,
      env: {},
      shell: false
    }
  }

  throw new Error('Could not find Hermes. Install the Hermes CLI or set HERMES_DESKTOP_HERMES_ROOT.')
}

async function ensureBundledRuntime(backend) {
  if (!backend.bootstrap) {
    await advanceBootProgress('runtime.external', `Using ${backend.label}`, 32)
    return backend
  }

  const sourceVersion = readJson(path.join(backend.root, 'package.json'))?.version || app.getVersion()
  const marker = readJson(BUNDLED_VENV_MARKER)
  const venvPython = getVenvPython(BUNDLED_VENV_ROOT)

  const runtimeReady =
    fileExists(venvPython) &&
    marker?.sourceVersion === sourceVersion &&
    marker?.runtimeSchemaVersion === RUNTIME_SCHEMA_VERSION &&
    (await hasBundledRuntimeImports(venvPython))

  if (runtimeReady) {
    await advanceBootProgress('runtime.ready', 'Reusing bundled Hermes runtime', 58)
    backend.command = venvPython
    backend.label = `${backend.label} runtime at ${BUNDLED_VENV_ROOT}`
    return backend
  }

  const systemPython = findSystemPython()
  if (!systemPython) {
    throw new Error('Python 3.11+ is required to bootstrap the bundled Hermes runtime.')
  }

  await advanceBootProgress('runtime.prepare', 'Preparing bundled Hermes runtime', 42)
  rememberLog(`Preparing bundled Hermes runtime in ${BUNDLED_VENV_ROOT}`)
  fs.mkdirSync(BUNDLED_VENV_ROOT, { recursive: true })

  if (!fileExists(venvPython)) {
    await advanceBootProgress('runtime.venv', 'Creating desktop runtime virtual environment', 50)
    await runProcess(systemPython, ['-m', 'venv', BUNDLED_VENV_ROOT])
  }

  await advanceBootProgress('runtime.dependencies', 'Installing desktop runtime dependencies', 66)
  await runProcess(venvPython, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-warn-script-location',
    '--upgrade',
    ...BUNDLED_RUNTIME_REQUIREMENTS
  ])

  await advanceBootProgress('runtime.verify', 'Validating bundled runtime dependencies', 78)
  await runProcess(venvPython, ['-c', BUNDLED_RUNTIME_IMPORT_CHECK])

  fs.writeFileSync(
    BUNDLED_VENV_MARKER,
    JSON.stringify(
      {
        runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
        sourceVersion,
        installedAt: new Date().toISOString()
      },
      null,
      2
    )
  )

  backend.command = venvPython
  backend.label = `${backend.label} runtime at ${BUNDLED_VENV_ROOT}`
  updateBootProgress({
    phase: 'runtime.ready',
    message: 'Bundled runtime is ready',
    progress: 82,
    running: true,
    error: null
  })
  return backend
}

async function hasBundledRuntimeImports(python) {
  try {
    await runProcess(python, ['-c', BUNDLED_RUNTIME_IMPORT_CHECK])
    return true
  } catch {
    rememberLog('Bundled Hermes runtime is missing required dashboard dependencies; reinstalling.')
    return false
  }
}

function isPortAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

async function pickPort() {
  for (let port = PORT_FLOOR; port <= PORT_CEILING; port += 1) {
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`No free localhost port in ${PORT_FLOOR}-${PORT_CEILING}`)
}

function fetchJson(url, token, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body))
    const parsed = new URL(url)
    const client = parsed.protocol === 'https:' ? https : http

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new Error(`Unsupported Hermes backend URL protocol: ${parsed.protocol}`))
      return
    }

    const req = client.request(
      parsed,
      {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Token': token,
          ...(body ? { 'Content-Length': String(body.length) } : {})
        }
      },
      res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`${res.statusCode}: ${text || res.statusMessage}`))
            return
          }
          try {
            resolve(text ? JSON.parse(text) : null)
          } catch (error) {
            reject(error)
          }
        })
      }
    )

    req.on('error', reject)
    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new Error(`Timed out connecting to Hermes backend after ${options.timeoutMs}ms`))
      })
    }
    if (body) req.write(body)
    req.end()
  })
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase()

  return MEDIA_MIME_TYPES[ext] || 'application/octet-stream'
}

function extensionForMimeType(mimeType) {
  const type = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (type === 'image/png') return '.png'
  if (type === 'image/jpeg') return '.jpg'
  if (type === 'image/gif') return '.gif'
  if (type === 'image/webp') return '.webp'
  if (type === 'image/bmp') return '.bmp'
  if (type === 'image/svg+xml') return '.svg'
  return ''
}

function filenameFromUrl(rawUrl, fallback = 'image') {
  try {
    const parsed = new URL(rawUrl)
    const base = path.basename(decodeURIComponent(parsed.pathname || ''))
    return base && base.includes('.') ? base : fallback
  } catch {
    return fallback
  }
}

async function resourceBufferFromUrl(rawUrl) {
  if (!rawUrl) throw new Error('Missing URL')
  if (rawUrl.startsWith('data:')) {
    const match = rawUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
    if (!match) throw new Error('Invalid data URL')
    const mimeType = match[1] || 'application/octet-stream'
    const encoded = match[3] || ''
    const buffer = match[2] ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded), 'utf8')
    return { buffer, mimeType }
  }
  if (rawUrl.startsWith('file:')) {
    const filePath = fileURLToPath(rawUrl)
    const buffer = await fs.promises.readFile(filePath)
    return { buffer, mimeType: mimeTypeForPath(filePath) }
  }

  const parsed = new URL(rawUrl)
  const client = parsed.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = client.get(parsed, res => {
      if ((res.statusCode || 500) >= 400) {
        reject(new Error(`Failed to fetch ${rawUrl}: ${res.statusCode}`))
        res.resume()
        return
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          buffer: Buffer.concat(chunks),
          mimeType: res.headers['content-type'] || 'application/octet-stream'
        })
      })
    })
    req.on('error', reject)
  })
}

async function copyImageFromUrl(rawUrl) {
  const { buffer } = await resourceBufferFromUrl(rawUrl)
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) throw new Error('Could not read image')
  clipboard.writeImage(image)
}

async function saveImageFromUrl(rawUrl) {
  const { buffer, mimeType } = await resourceBufferFromUrl(rawUrl)
  const fallbackName = filenameFromUrl(rawUrl, `image${extensionForMimeType(mimeType) || '.png'}`)
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Image',
    defaultPath: fallbackName
  })
  if (result.canceled || !result.filePath) return false
  await fs.promises.writeFile(result.filePath, buffer)
  return true
}

async function writeComposerImage(buffer, ext = '.png') {
  const rawExt = String(ext || '.png')
    .trim()
    .toLowerCase()
  const normalizedExt = rawExt.startsWith('.') ? rawExt : `.${rawExt}`
  const safeExt = /^\.[a-z0-9]{1,5}$/.test(normalizedExt) ? normalizedExt : '.png'
  const dir = path.join(app.getPath('userData'), 'composer-images')
  await fs.promises.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const random = crypto.randomBytes(3).toString('hex')
  const filePath = path.join(dir, `composer_${stamp}_${random}${safeExt}`)
  await fs.promises.writeFile(filePath, buffer)
  return filePath
}

function previewLabelForUrl(url) {
  return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
}

function expandUserPath(filePath) {
  const value = String(filePath || '').trim()

  if (value === '~') {
    return app.getPath('home')
  }

  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(app.getPath('home'), value.slice(2))
  }

  return value
}

function previewFileTarget(rawTarget, baseDir) {
  const raw = String(rawTarget || '').trim()
  const base = baseDir ? path.resolve(expandUserPath(baseDir)) : resolveHermesCwd()
  const filePath = raw.startsWith('file:') ? fileURLToPath(raw) : path.resolve(base, expandUserPath(raw))
  let resolved = filePath

  if (directoryExists(resolved)) {
    resolved = path.join(resolved, 'index.html')
  }

  const ext = path.extname(resolved).toLowerCase()
  if (!fileExists(resolved)) {
    return null
  }

  const mimeType = mimeTypeForPath(resolved)
  const metadata = previewFileMetadata(resolved, mimeType)
  const isHtml = PREVIEW_HTML_EXTENSIONS.has(ext)
  const isImage = mimeType.startsWith('image/')
  const previewKind = isHtml ? 'html' : isImage ? 'image' : metadata.binary ? 'binary' : 'text'

  return {
    binary: metadata.binary,
    byteSize: metadata.byteSize,
    kind: 'file',
    large: metadata.large,
    label: path.basename(resolved),
    language: PREVIEW_LANGUAGE_BY_EXT[ext] || 'text',
    mimeType,
    path: resolved,
    previewKind,
    source: raw,
    url: pathToFileURL(resolved).toString()
  }
}

function previewUrlTarget(rawTarget) {
  const raw = String(rawTarget || '').trim()
  const url = new URL(raw)

  if (!['http:', 'https:'].includes(url.protocol)) {
    return null
  }

  if (!LOCAL_PREVIEW_HOSTS.has(url.hostname.toLowerCase())) {
    return null
  }

  if (url.hostname === '0.0.0.0') {
    url.hostname = '127.0.0.1'
  }

  return {
    kind: 'url',
    label: previewLabelForUrl(url),
    source: raw,
    url: url.toString()
  }
}

function normalizePreviewTarget(rawTarget, baseDir) {
  const raw = String(rawTarget || '').trim()

  if (!raw) {
    return null
  }

  try {
    if (/^https?:\/\//i.test(raw)) {
      return previewUrlTarget(raw)
    }

    return previewFileTarget(raw, baseDir)
  } catch {
    return null
  }
}

function filePathFromPreviewUrl(rawUrl) {
  const filePath = fileURLToPath(String(rawUrl || ''))

  if (!fileExists(filePath)) {
    throw new Error('Preview file is not readable')
  }

  return filePath
}

function sendPreviewFileChanged(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { webContents } = mainWindow
  if (!webContents || webContents.isDestroyed()) return
  webContents.send('hermes:preview-file-changed', payload)
}

function watchPreviewFile(rawUrl) {
  const filePath = filePathFromPreviewUrl(rawUrl)
  const watchDir = path.dirname(filePath)
  const targetName = path.basename(filePath)
  const id = crypto.randomBytes(12).toString('base64url')
  let timer = null
  const watcher = fs.watch(watchDir, (_eventType, filename) => {
    const changedName = filename ? path.basename(String(filename)) : ''

    if (changedName && changedName !== targetName) {
      return
    }

    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (!fileExists(filePath)) return
      sendPreviewFileChanged({ id, path: filePath, url: pathToFileURL(filePath).toString() })
    }, PREVIEW_WATCH_DEBOUNCE_MS)
  })

  previewWatchers.set(id, {
    close: () => {
      if (timer) clearTimeout(timer)
      watcher.close()
    }
  })

  return { id, path: filePath }
}

function stopPreviewFileWatch(id) {
  const watcher = previewWatchers.get(id)

  if (!watcher) {
    return false
  }

  watcher.close()
  previewWatchers.delete(id)

  return true
}

function closePreviewWatchers() {
  for (const id of previewWatchers.keys()) {
    stopPreviewFileWatch(id)
  }
}

async function waitForHermes(baseUrl, token) {
  const deadline = Date.now() + 45_000
  let lastError = null

  while (Date.now() < deadline) {
    try {
      await fetchJson(`${baseUrl}/api/status`, token)
      return
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  throw new Error(`Hermes dashboard did not become ready: ${lastError?.message || 'timeout'}`)
}

function getWindowButtonPosition() {
  if (!IS_MAC) return null
  return mainWindow?.getWindowButtonPosition?.() || WINDOW_BUTTON_POSITION
}

function sendBackendExit(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { webContents } = mainWindow
  if (!webContents || webContents.isDestroyed()) return
  webContents.send('hermes:backend-exit', payload)
}

function sendClosePreviewRequested() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { webContents } = mainWindow
  if (!webContents || webContents.isDestroyed()) return
  webContents.send('hermes:close-preview-requested')
}

function getAppIconPath() {
  return APP_ICON_PATHS.find(fileExists)
}

function buildApplicationMenu() {
  const template = []
  if (IS_MAC) {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `About ${APP_NAME}` },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push({
    label: 'File',
    submenu: [
      IS_MAC
        ? {
            accelerator: 'CommandOrControl+W',
            click: () => {
              if (previewShortcutActive) {
                sendClosePreviewRequested()
              } else {
                mainWindow?.close()
              }
            },
            label: 'Close'
          }
        : { role: 'quit' }
    ]
  })
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'delete' },
      { role: 'selectAll' }
    ]
  })
  template.push({
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  })
  template.push({
    label: 'Window',
    submenu: IS_MAC
      ? [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'close' }]
  })

  return Menu.buildFromTemplate(template)
}

function toggleDevTools(window) {
  if (!DEV_SERVER) return
  const { webContents } = window
  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools()
  } else {
    webContents.openDevTools({ mode: 'detach' })
  }
}

function installDevToolsShortcut(window) {
  if (!DEV_SERVER) return
  window.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase()
    const isInspectShortcut =
      input.key === 'F12' ||
      (IS_MAC && input.meta && input.alt && key === 'i') ||
      (!IS_MAC && input.control && input.shift && key === 'i')
    if (!isInspectShortcut) return
    event.preventDefault()
    toggleDevTools(window)
  })
}

function installPreviewShortcut(window) {
  window.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase()
    const isPreviewCloseShortcut = key === 'w' && (IS_MAC ? input.meta : input.control) && !input.alt && !input.shift

    if (!isPreviewCloseShortcut || !previewShortcutActive) return

    event.preventDefault()
    sendClosePreviewRequested()
  })
}

function installContextMenu(window) {
  window.webContents.on('context-menu', (_event, params) => {
    const template = []
    const hasSelection = Boolean(params.selectionText?.trim())
    const hasImage = params.mediaType === 'image' && Boolean(params.srcURL)
    const hasLink = Boolean(params.linkURL)
    const isEditable = Boolean(params.isEditable)

    if (hasImage) {
      template.push(
        {
          label: 'Open Image',
          click: () => {
            if (params.srcURL && !params.srcURL.startsWith('data:')) {
              void shell.openExternal(params.srcURL)
            }
          },
          enabled: !params.srcURL.startsWith('data:')
        },
        {
          label: 'Copy Image',
          click: () => {
            void copyImageFromUrl(params.srcURL).catch(error => rememberLog(`Copy image failed: ${error.message}`))
          }
        },
        {
          label: 'Copy Image Address',
          click: () => clipboard.writeText(params.srcURL)
        },
        {
          label: 'Save Image As...',
          click: () => {
            void saveImageFromUrl(params.srcURL).catch(error => rememberLog(`Save image failed: ${error.message}`))
          }
        }
      )
    }

    if (hasLink) {
      if (template.length) template.push({ type: 'separator' })
      template.push(
        {
          label: 'Open Link',
          click: () => void shell.openExternal(params.linkURL)
        },
        {
          label: 'Copy Link',
          click: () => clipboard.writeText(params.linkURL)
        }
      )
    }

    if (hasSelection || isEditable) {
      if (template.length) template.push({ type: 'separator' })
      if (isEditable) {
        template.push(
          { role: 'cut', enabled: params.editFlags.canCut },
          { role: 'copy', enabled: params.editFlags.canCopy },
          { role: 'paste', enabled: params.editFlags.canPaste },
          { type: 'separator' },
          { role: 'selectAll', enabled: params.editFlags.canSelectAll }
        )
      } else {
        template.push({ role: 'copy', enabled: params.editFlags.canCopy })
      }
    }

    if (!template.length) {
      template.push({ role: 'selectAll' })
    }

    Menu.buildFromTemplate(template).popup({ window })
  })
}

function installMediaPermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === 'media' && details?.mediaTypes?.includes('audio')) {
      callback(true)

      return
    }

    callback(false)
  })
}

function normalizeRemoteBaseUrl(rawUrl) {
  const value = String(rawUrl || '').trim()

  if (!value) {
    throw new Error('Remote gateway URL is required.')
  }

  let parsed
  try {
    parsed = new URL(value)
  } catch (error) {
    throw new Error(`Remote gateway URL is not valid: ${error.message}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Remote gateway URL must be http:// or https://, got ${parsed.protocol}`)
  }

  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')

  return parsed.toString().replace(/\/+$/, '')
}

function buildGatewayWsUrl(baseUrl, token) {
  const parsed = new URL(baseUrl)
  const wsScheme = parsed.protocol === 'https:' ? 'wss' : 'ws'
  const prefix = parsed.pathname.replace(/\/+$/, '')

  return `${wsScheme}://${parsed.host}${prefix}/api/ws?token=${encodeURIComponent(token)}`
}

function tokenPreview(value) {
  const raw = String(value || '')

  if (!raw) {
    return null
  }

  return raw.length <= 8 ? 'set' : `...${raw.slice(-6)}`
}

function encryptDesktopSecret(value) {
  const raw = String(value || '')

  if (!raw) {
    return null
  }

  try {
    if (safeStorage.isEncryptionAvailable()) {
      return {
        encoding: 'safeStorage',
        value: safeStorage.encryptString(raw).toString('base64')
      }
    }
  } catch {
    // Fall through to plaintext for platforms where Electron cannot encrypt.
  }

  return { encoding: 'plain', value: raw }
}

function decryptDesktopSecret(secret) {
  if (!secret || typeof secret !== 'object') {
    return ''
  }

  const value = String(secret.value || '')

  if (!value) {
    return ''
  }

  if (secret.encoding === 'safeStorage') {
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      return ''
    }
  }

  return value
}

function readDesktopConnectionConfig() {
  if (connectionConfigCache) {
    return connectionConfigCache
  }

  let config = { mode: 'local', remote: {} }

  try {
    const raw = fs.readFileSync(DESKTOP_CONNECTION_CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw)

    if (parsed && typeof parsed === 'object') {
      config = {
        mode: parsed.mode === 'remote' ? 'remote' : 'local',
        remote: parsed.remote && typeof parsed.remote === 'object' ? parsed.remote : {}
      }
    }
  } catch {
    // Missing or malformed connection settings should fall back to local.
  }

  connectionConfigCache = config

  return config
}

function writeDesktopConnectionConfig(config) {
  fs.mkdirSync(path.dirname(DESKTOP_CONNECTION_CONFIG_PATH), { recursive: true })
  fs.writeFileSync(DESKTOP_CONNECTION_CONFIG_PATH, JSON.stringify(config, null, 2))
  connectionConfigCache = config
}

function sanitizeDesktopConnectionConfig(config = readDesktopConnectionConfig()) {
  const remoteToken = decryptDesktopSecret(config.remote?.token)

  return {
    mode: config.mode === 'remote' ? 'remote' : 'local',
    remoteUrl: String(config.remote?.url || ''),
    remoteTokenPreview: tokenPreview(remoteToken),
    remoteTokenSet: Boolean(remoteToken),
    envOverride: Boolean(process.env.HERMES_DESKTOP_REMOTE_URL)
  }
}

function coerceDesktopConnectionConfig(input = {}, existing = readDesktopConnectionConfig()) {
  const mode = input.mode === 'remote' ? 'remote' : 'local'
  const remoteUrl = String(input.remoteUrl ?? existing.remote?.url ?? '').trim()
  const incomingToken = typeof input.remoteToken === 'string' ? input.remoteToken.trim() : ''
  const existingToken = existing.remote?.token
  const nextRemote = {
    url: remoteUrl,
    token: incomingToken ? encryptDesktopSecret(incomingToken) : existingToken
  }

  if (mode === 'remote') {
    nextRemote.url = normalizeRemoteBaseUrl(remoteUrl)

    if (!decryptDesktopSecret(nextRemote.token)) {
      throw new Error('Remote gateway session token is required.')
    }
  } else if (remoteUrl) {
    nextRemote.url = normalizeRemoteBaseUrl(remoteUrl)
  }

  return { mode, remote: nextRemote }
}

function resolveRemoteBackend() {
  const rawEnvUrl = process.env.HERMES_DESKTOP_REMOTE_URL
  const rawEnvToken = process.env.HERMES_DESKTOP_REMOTE_TOKEN

  if (rawEnvUrl) {
    if (!rawEnvToken) {
      throw new Error(
        'HERMES_DESKTOP_REMOTE_URL is set but HERMES_DESKTOP_REMOTE_TOKEN is not. ' +
        'Both must be provided to connect to a remote Hermes backend.'
      )
    }

    const baseUrl = normalizeRemoteBaseUrl(rawEnvUrl)

    return {
      baseUrl,
      mode: 'remote',
      source: 'env',
      token: rawEnvToken,
      wsUrl: buildGatewayWsUrl(baseUrl, rawEnvToken)
    }
  }

  const config = readDesktopConnectionConfig()

  if (config.mode !== 'remote') {
    return null
  }

  const token = decryptDesktopSecret(config.remote?.token)

  if (!token) {
    throw new Error(
      'Remote Hermes gateway is selected, but no session token is saved. ' +
      'Open Settings → Gateway and save a token, or switch back to Local.'
    )
  }

  const baseUrl = normalizeRemoteBaseUrl(config.remote?.url)

  return {
    baseUrl,
    mode: 'remote',
    source: 'settings',
    token,
    wsUrl: buildGatewayWsUrl(baseUrl, token)
  }
}

async function testDesktopConnectionConfig(input = {}) {
  const config = coerceDesktopConnectionConfig(input)
  const remote = config.mode === 'remote'
    ? {
        baseUrl: normalizeRemoteBaseUrl(config.remote.url),
        token: decryptDesktopSecret(config.remote.token)
      }
    : resolveRemoteBackend() || (await startHermes())
  const status = await fetchJson(`${remote.baseUrl}/api/status`, remote.token, { timeoutMs: 8_000 })

  return {
    ok: true,
    baseUrl: remote.baseUrl,
    version: status?.version || null
  }
}

function resetBootProgressForReconnect() {
  updateBootProgress(
    {
      error: null,
      message: 'Restarting desktop connection',
      phase: 'backend.resolve',
      progress: 4,
      running: true
    },
    { allowDecrease: true }
  )
}

function resetHermesConnection() {
  connectionPromise = null

  if (hermesProcess && !hermesProcess.killed) {
    hermesProcess.kill('SIGTERM')
  }

  hermesProcess = null
  resetBootProgressForReconnect()
}

async function startHermes() {
  if (connectionPromise) return connectionPromise

  connectionPromise = (async () => {
    await advanceBootProgress('backend.resolve', 'Resolving Hermes backend', 8)
    const remote = resolveRemoteBackend()
    if (remote) {
      await advanceBootProgress('backend.remote', `Connecting to remote Hermes backend at ${remote.baseUrl}`, 24)
      await waitForHermes(remote.baseUrl, remote.token)
      updateBootProgress({
        phase: 'backend.ready',
        message: 'Remote Hermes backend is ready',
        progress: 94,
        running: true,
        error: null
      })
      return {
        baseUrl: remote.baseUrl,
        mode: 'remote',
        source: remote.source,
        token: remote.token,
        wsUrl: remote.wsUrl,
        logs: hermesLog.slice(-80),
        windowButtonPosition: getWindowButtonPosition()
      }
    }

    await advanceBootProgress('backend.port', 'Finding an open local port', 16)
    const port = await pickPort()
    const token = crypto.randomBytes(32).toString('base64url')
    const dashboardArgs = ['dashboard', '--no-open', '--tui', '--host', '127.0.0.1', '--port', String(port)]
    await advanceBootProgress('backend.runtime', 'Resolving Hermes runtime', 28)
    const backend = await ensureBundledRuntime(resolveHermesBackend(dashboardArgs))
    const hermesCwd = resolveHermesCwd()
    const webDist = resolveWebDist()

    await advanceBootProgress('backend.spawn', `Starting Hermes backend via ${backend.label}`, 84)
    rememberLog(`Starting Hermes backend via ${backend.label}`)

    hermesProcess = spawn(backend.command, backend.args, {
      cwd: hermesCwd,
      env: {
        ...process.env,
        ...backend.env,
        HERMES_DASHBOARD_SESSION_TOKEN: token,
        HERMES_DASHBOARD_TUI: '1',
        HERMES_WEB_DIST: webDist
      },
      shell: backend.shell,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    hermesProcess.stdout.on('data', rememberLog)
    hermesProcess.stderr.on('data', rememberLog)
    let backendReady = false
    let rejectBackendStart = null
    const backendStartFailed = new Promise((_resolve, reject) => {
      rejectBackendStart = reject
    })
    hermesProcess.once('error', error => {
      rememberLog(`Hermes backend failed to start: ${error.message}`)
      updateBootProgress(
        {
          error: error.message,
          message: `Hermes backend failed to start: ${error.message}`,
          phase: 'backend.error',
          running: false
        },
        { allowDecrease: true }
      )
      hermesProcess = null
      connectionPromise = null
      sendBackendExit({ code: null, signal: null, error: error.message })
      rejectBackendStart?.(error)
    })
    hermesProcess.once('exit', (code, signal) => {
      rememberLog(`Hermes dashboard exited (${signal || code})`)
      hermesProcess = null
      connectionPromise = null
      sendBackendExit({ code, signal })
      if (!backendReady) {
        const message = `Hermes dashboard exited before it became ready (${signal || code}).`
        updateBootProgress(
          {
            error: message,
            message,
            phase: 'backend.error',
            running: false
          },
          { allowDecrease: true }
        )
        rejectBackendStart?.(
          new Error(
            `Hermes dashboard exited before it became ready (${signal || code}). Log: ${DESKTOP_LOG_PATH}\n${recentHermesLog()}`
          )
        )
      }
    })

    const baseUrl = `http://127.0.0.1:${port}`
    await advanceBootProgress('backend.wait', 'Waiting for Hermes dashboard to become ready', 90)
    await Promise.race([waitForHermes(baseUrl, token), backendStartFailed])
    backendReady = true
    updateBootProgress({
      phase: 'backend.ready',
      message: 'Hermes backend is ready. Finalizing desktop startup',
      progress: 94,
      running: true,
      error: null
    })

    return {
      baseUrl,
      mode: 'local',
      source: 'local',
      token,
      wsUrl: `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(token)}`,
      logs: hermesLog.slice(-80),
      windowButtonPosition: getWindowButtonPosition()
    }
  })().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    updateBootProgress(
      {
        error: message,
        message: `Desktop boot failed: ${message}`,
        phase: 'backend.error',
        running: false
      },
      { allowDecrease: true }
    )
    connectionPromise = null
    throw error
  })

  return connectionPromise
}

function createWindow() {
  const icon = getAppIconPath()
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    title: 'Hermes',
    titleBarStyle: IS_MAC ? 'hidden' : 'default',
    titleBarOverlay: IS_MAC ? { height: TITLEBAR_HEIGHT } : undefined,
    trafficLightPosition: IS_MAC ? WINDOW_BUTTON_POSITION : undefined,
    vibrancy: IS_MAC ? 'sidebar' : undefined,
    icon,
    backgroundColor: '#f7f7f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      webviewTag: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: Boolean(DEV_SERVER)
    }
  })

  if (IS_MAC) {
    mainWindow.setWindowButtonPosition?.(WINDOW_BUTTON_POSITION)
    if (icon) {
      app.dock?.setIcon(icon)
    }
  }

  installPreviewShortcut(mainWindow)
  installDevToolsShortcut(mainWindow)
  installContextMenu(mainWindow)

  if (DEV_SERVER) {
    mainWindow.loadURL(DEV_SERVER)
  } else {
    mainWindow.loadURL(pathToFileURL(resolveRendererIndex()).toString())
  }

  mainWindow.webContents.once('did-finish-load', () => {
    broadcastBootProgress()
    startHermes().catch(error => rememberLog(error.stack || error.message))
  })
}

ipcMain.handle('hermes:connection', async () => startHermes())
ipcMain.handle('hermes:boot-progress:get', async () => bootProgressState)
ipcMain.handle('hermes:connection-config:get', async () => sanitizeDesktopConnectionConfig())
ipcMain.handle('hermes:connection-config:test', async (_event, payload) => testDesktopConnectionConfig(payload))
ipcMain.handle('hermes:connection-config:save', async (_event, payload) => {
  const config = coerceDesktopConnectionConfig(payload)
  writeDesktopConnectionConfig(config)

  return sanitizeDesktopConnectionConfig(config)
})
ipcMain.handle('hermes:connection-config:apply', async (_event, payload) => {
  const config = coerceDesktopConnectionConfig(payload)
  writeDesktopConnectionConfig(config)
  resetHermesConnection()
  setTimeout(() => mainWindow?.reload(), 150)

  return sanitizeDesktopConnectionConfig(config)
})

ipcMain.on('hermes:previewShortcutActive', (_event, active) => {
  previewShortcutActive = Boolean(active)
})

ipcMain.handle('hermes:requestMicrophoneAccess', async () => {
  if (!IS_MAC || typeof systemPreferences.askForMediaAccess !== 'function') {
    return true
  }

  return systemPreferences.askForMediaAccess('microphone')
})

ipcMain.handle('hermes:api', async (_event, request) => {
  const connection = await startHermes()
  return fetchJson(`${connection.baseUrl}${request.path}`, connection.token, {
    method: request.method,
    body: request.body
  })
})

ipcMain.handle('hermes:notify', (_event, payload) => {
  if (!Notification.isSupported()) return false
  new Notification({
    title: payload?.title || 'Hermes',
    body: payload?.body || '',
    silent: Boolean(payload?.silent)
  }).show()
  return true
})

ipcMain.handle('hermes:readFileDataUrl', async (_event, filePath) => {
  const input = String(filePath || '')
  const resolved = input.startsWith('file:') ? fileURLToPath(input) : path.resolve(input)
  const data = await fs.promises.readFile(resolved)
  return `data:${mimeTypeForPath(resolved)};base64,${data.toString('base64')}`
})

ipcMain.handle('hermes:readFileText', async (_event, filePath) => {
  const input = String(filePath || '')
  const resolved = input.startsWith('file:') ? fileURLToPath(input) : path.resolve(input)
  const ext = path.extname(resolved).toLowerCase()
  const stat = await fs.promises.stat(resolved)
  const handle = await fs.promises.open(resolved, 'r')
  const bytesToRead = Math.min(stat.size, TEXT_PREVIEW_MAX_BYTES)

  try {
    const buffer = Buffer.alloc(bytesToRead)
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)

    return {
      binary: looksBinary(buffer.subarray(0, Math.min(bytesRead, 4096))),
      byteSize: stat.size,
      language: PREVIEW_LANGUAGE_BY_EXT[ext] || 'text',
      mimeType: mimeTypeForPath(resolved),
      path: resolved,
      text: buffer.subarray(0, bytesRead).toString('utf8'),
      truncated: stat.size > TEXT_PREVIEW_MAX_BYTES
    }
  } finally {
    await handle.close()
  }
})

ipcMain.handle('hermes:selectPaths', async (_event, options = {}) => {
  const properties = ['openFile']
  if (options?.directories) properties.push('openDirectory')
  if (options?.multiple !== false) properties.push('multiSelections')

  const result = await dialog.showOpenDialog(mainWindow, {
    title: options?.title || 'Add context',
    defaultPath: options?.defaultPath ? path.resolve(String(options.defaultPath)) : undefined,
    properties,
    filters: Array.isArray(options?.filters) ? options.filters : undefined
  })

  if (result.canceled) return []
  return result.filePaths
})

ipcMain.handle('hermes:writeClipboard', (_event, text) => {
  clipboard.writeText(String(text || ''))
  return true
})

ipcMain.handle('hermes:saveImageFromUrl', (_event, url) => saveImageFromUrl(String(url || '')))

ipcMain.handle('hermes:saveImageBuffer', async (_event, payload) => {
  const data = payload?.data
  if (!data) throw new Error('saveImageBuffer: missing data')

  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
  return writeComposerImage(buffer, payload?.ext || '.png')
})

ipcMain.handle('hermes:saveClipboardImage', async () => {
  const image = clipboard.readImage()
  if (!image || image.isEmpty()) {
    return ''
  }

  return writeComposerImage(image.toPNG(), '.png')
})

ipcMain.handle('hermes:normalizePreviewTarget', (_event, target, baseDir) =>
  normalizePreviewTarget(String(target || ''), baseDir ? String(baseDir) : '')
)

ipcMain.handle('hermes:watchPreviewFile', (_event, url) => watchPreviewFile(String(url || '')))

ipcMain.handle('hermes:stopPreviewFileWatch', (_event, id) => stopPreviewFileWatch(String(id || '')))

ipcMain.handle('hermes:openExternal', (_event, url) => shell.openExternal(url))

// Always-hidden noise (covers non-git projects too — gitignore would catch
// these anyway when present, but we want the same hygiene without one).
const FS_READDIR_HIDDEN = new Set(['.git', '.hg', '.svn', 'node_modules', '__pycache__', '.next', '.venv', 'venv'])

function findGitRoot(start) {
  let dir = start

  for (let i = 0; i < 50; i += 1) {
    try {
      if (fs.existsSync(path.join(dir, '.git'))) {
        return dir
      }
    } catch {
      return null
    }

    const parent = path.dirname(dir)

    if (parent === dir) {
      return null
    }

    dir = parent
  }

  return null
}

ipcMain.handle('hermes:fs:readDir', async (_event, dirPath) => {
  const resolved = path.resolve(String(dirPath || ''))

  if (!resolved) {
    return { entries: [], error: 'invalid-path' }
  }

  try {
    const dirents = await fs.promises.readdir(resolved, { withFileTypes: true })

    const entries = dirents
      .filter(d => {
        if (FS_READDIR_HIDDEN.has(d.name)) {
          return false
        }

        return true
      })
      .map(d => ({ name: d.name, path: path.join(resolved, d.name), isDirectory: d.isDirectory() }))
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))

    return { entries }
  } catch (error) {
    return { entries: [], error: error?.code || 'read-error' }
  }
})

ipcMain.handle('hermes:fs:gitRoot', async (_event, startPath) => {
  const input = String(startPath || '')
  const resolved = input.startsWith('file:') ? fileURLToPath(input) : path.resolve(input)

  try {
    const stat = await fs.promises.stat(resolved)
    const start = stat.isDirectory() ? resolved : path.dirname(resolved)

    return findGitRoot(start)
  } catch {
    return findGitRoot(resolved)
  }
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildApplicationMenu())
  installMediaPermissions()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  if (desktopLogFlushTimer) {
    clearTimeout(desktopLogFlushTimer)
    desktopLogFlushTimer = null
  }
  flushDesktopLogBufferSync()
  closePreviewWatchers()

  if (hermesProcess && !hermesProcess.killed) {
    hermesProcess.kill('SIGTERM')
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
