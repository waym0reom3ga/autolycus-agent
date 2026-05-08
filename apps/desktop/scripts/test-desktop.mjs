import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { listPackage } from '@electron/asar'

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(DESKTOP_ROOT, 'package.json'), 'utf8'))
const MODE = process.argv[2] || 'help'
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'
const RELEASE_ROOT = path.join(DESKTOP_ROOT, 'release')
const APP_PATH = path.join(RELEASE_ROOT, `mac-${ARCH}`, 'Hermes.app')
const APP_BIN = path.join(APP_PATH, 'Contents', 'MacOS', 'Hermes')
const USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'Hermes')
const RUNTIME_ROOT = path.join(USER_DATA, 'hermes-runtime')
const FRESH_SANDBOX_ROOT = path.join(os.tmpdir(), 'hermes-desktop-fresh-install')

function die(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || DESKTOP_ROOT,
    env: options.env || process.env,
    shell: Boolean(options.shell),
    stdio: 'inherit'
  })

  if (result.status !== 0) {
    die(`${command} ${args.join(' ')} failed`)
  }
}

function output(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })

  return result.status === 0 ? result.stdout.trim() : ''
}

function exists(target) {
  return fs.existsSync(target)
}

function resolveDmgPath() {
  if (!exists(RELEASE_ROOT)) {
    return path.join(RELEASE_ROOT, `Hermes-${PACKAGE_JSON.version}-${ARCH}.dmg`)
  }

  const prefix = `Hermes-${PACKAGE_JSON.version}`
  const candidates = fs
    .readdirSync(RELEASE_ROOT)
    .filter(name => name.endsWith('.dmg'))
    .filter(name => name.startsWith(prefix))
    .filter(name => name.includes(ARCH))
    .sort((a, b) => {
      const aMtime = fs.statSync(path.join(RELEASE_ROOT, a)).mtimeMs
      const bMtime = fs.statSync(path.join(RELEASE_ROOT, b)).mtimeMs
      return bMtime - aMtime
    })

  if (candidates.length > 0) {
    return path.join(RELEASE_ROOT, candidates[0])
  }

  return path.join(RELEASE_ROOT, `Hermes-${PACKAGE_JSON.version}-${ARCH}.dmg`)
}

function ensureMac() {
  if (process.platform !== 'darwin') {
    die('Desktop launch tests are macOS-only from this script.')
  }
}

function ensurePackagedApp() {
  if (process.env.HERMES_DESKTOP_SKIP_BUILD === '1' && exists(APP_BIN)) {
    return
  }

  run('npm', ['run', 'pack'])
}

function ensureDmg() {
  if (process.env.HERMES_DESKTOP_SKIP_BUILD === '1' && exists(resolveDmgPath())) {
    return
  }

  run('npm', ['run', 'dist:mac:dmg'])
}

function openApp() {
  if (!exists(APP_PATH)) {
    die(`Missing packaged app: ${APP_PATH}`)
  }

  run('open', ['-n', APP_PATH])
}

function openDmg() {
  const dmgPath = resolveDmgPath()
  if (!exists(dmgPath)) {
    die(`Missing DMG: ${dmgPath}`)
  }

  run('open', [dmgPath])
}

const CREDENTIAL_ENV_SUFFIXES = [
  '_API_KEY',
  '_TOKEN',
  '_SECRET',
  '_PASSWORD',
  '_CREDENTIALS',
  '_ACCESS_KEY',
  '_PRIVATE_KEY',
  '_OAUTH_TOKEN'
]

const CREDENTIAL_ENV_NAMES = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'CUSTOM_API_KEY',
  'GEMINI_BASE_URL',
  'OPENAI_BASE_URL',
  'OPENROUTER_BASE_URL',
  'OLLAMA_BASE_URL',
  'GROQ_BASE_URL',
  'XAI_BASE_URL'
])

function isCredentialEnvVar(name) {
  if (CREDENTIAL_ENV_NAMES.has(name)) return true
  return CREDENTIAL_ENV_SUFFIXES.some(suffix => name.endsWith(suffix))
}

function launchFresh() {
  if (!exists(APP_BIN)) {
    die(`Missing app executable: ${APP_BIN}`)
  }

  const python = output('which', ['python3'])
  if (!python) {
    die('python3 is required for fresh bundled-runtime bootstrap.')
  }

  const sandbox = fs.mkdtempSync(`${FRESH_SANDBOX_ROOT}-`)
  const userDataDir = path.join(sandbox, 'electron-user-data')
  const hermesHome = path.join(sandbox, 'hermes-home')
  const cwd = path.join(sandbox, 'workspace')

  fs.mkdirSync(userDataDir, { recursive: true })
  fs.mkdirSync(hermesHome, { recursive: true })
  fs.mkdirSync(cwd, { recursive: true })

  // Strip every credential-shaped env var so the sandbox is actually fresh.
  // Without this, shell-set OPENAI_API_KEY/OPENAI_BASE_URL/etc. leak into the
  // packaged backend, making setup.status report "configured" while the
  // agent's own credential resolution still fails.
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (isCredentialEnvVar(key)) continue
    env[key] = value
  }

  env.HERMES_DESKTOP_CWD = cwd
  env.HERMES_DESKTOP_IGNORE_EXISTING = '1'
  env.HERMES_DESKTOP_TEST_MODE = 'fresh-install'
  env.HERMES_DESKTOP_USER_DATA_DIR = userDataDir
  env.HERMES_HOME = hermesHome
  delete env.HERMES_DESKTOP_HERMES
  delete env.HERMES_DESKTOP_HERMES_ROOT

  const child = spawn(APP_BIN, [], {
    cwd: os.homedir(),
    detached: true,
    env,
    stdio: 'ignore'
  })
  child.unref()

  console.log('\nFresh install sandbox:')
  console.log(`  root: ${sandbox}`)
  console.log(`  electron userData: ${userDataDir}`)
  console.log(`  HERMES_HOME: ${hermesHome}`)
  console.log(`  cwd: ${cwd}`)

  return { runtimeRoot: path.join(userDataDir, 'hermes-runtime') }
}

function validateBundle() {
  const appAsar = path.join(APP_PATH, 'Contents', 'Resources', 'app.asar')
  const unpackedIndex = path.join(APP_PATH, 'Contents', 'Resources', 'app.asar.unpacked', 'dist', 'index.html')
  const required = [
    APP_BIN,
    path.join(APP_PATH, 'Contents', 'Resources', 'hermes-agent', 'hermes_cli', 'main.py')
  ]

  for (const target of required) {
    if (!exists(target)) {
      die(`Missing packaged payload file: ${target}`)
    }
  }

  if (exists(unpackedIndex)) {
    return
  }

  if (!exists(appAsar)) {
    die(`Missing renderer payload: neither ${unpackedIndex} nor ${appAsar} exists`)
  }

  const files = listPackage(appAsar)
  if (!files.includes('/dist/index.html') && !files.includes('dist/index.html')) {
    die(`Missing renderer payload file in app.asar: ${appAsar} (expected dist/index.html)`)
  }
}

function printArtifacts(options = {}) {
  const runtimeRoot = options.runtimeRoot || RUNTIME_ROOT

  console.log('\nDesktop artifacts:')
  console.log(`  app: ${APP_PATH}`)
  console.log(`  dmg: ${resolveDmgPath()}`)
  console.log(`  runtime: ${runtimeRoot}`)
}

function help() {
  console.log(`Usage:
  npm run test:desktop:existing  # build packaged app, launch with normal PATH/existing Hermes
  npm run test:desktop:fresh     # build packaged app, launch with temp userData + HERMES_HOME
  npm run test:desktop:dmg       # build DMG and open it
  npm run test:desktop:all       # build DMG, validate app payload, print paths

Fast rerun:
  HERMES_DESKTOP_SKIP_BUILD=1 npm run test:desktop:fresh
`)
}

ensureMac()

if (MODE === 'existing') {
  ensurePackagedApp()
  validateBundle()
  openApp()
  printArtifacts()
} else if (MODE === 'fresh') {
  ensurePackagedApp()
  validateBundle()
  printArtifacts(launchFresh())
} else if (MODE === 'dmg') {
  ensureDmg()
  openDmg()
  printArtifacts()
} else if (MODE === 'all') {
  ensureDmg()
  validateBundle()
  printArtifacts()
} else {
  help()
}
