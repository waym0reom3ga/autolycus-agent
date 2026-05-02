import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(DESKTOP_ROOT, 'package.json'), 'utf8'))
const MODE = process.argv[2] || 'help'
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64'
const RELEASE_ROOT = path.join(DESKTOP_ROOT, 'release')
const APP_PATH = path.join(RELEASE_ROOT, `mac-${ARCH}`, 'Hermes.app')
const APP_BIN = path.join(APP_PATH, 'Contents', 'MacOS', 'Hermes')
const DMG_PATH = path.join(RELEASE_ROOT, `Hermes-${PACKAGE_JSON.version}-${ARCH}.dmg`)
const USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'Hermes')
const RUNTIME_ROOT = path.join(USER_DATA, 'hermes-runtime')

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
  if (process.env.HERMES_DESKTOP_SKIP_BUILD === '1' && exists(DMG_PATH)) {
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
  if (!exists(DMG_PATH)) {
    die(`Missing DMG: ${DMG_PATH}`)
  }

  run('open', [DMG_PATH])
}

function launchFresh() {
  if (!exists(APP_BIN)) {
    die(`Missing app executable: ${APP_BIN}`)
  }

  fs.rmSync(RUNTIME_ROOT, { force: true, recursive: true })

  const python = output('which', ['python3'])
  if (!python) {
    die('python3 is required for fresh bundled-runtime bootstrap.')
  }

  const env = {
    ...process.env,
    HERMES_DESKTOP_IGNORE_EXISTING: '1',
    HERMES_DESKTOP_TEST_MODE: 'fresh-bundled-runtime'
  }
  delete env.HERMES_DESKTOP_HERMES
  delete env.HERMES_DESKTOP_HERMES_ROOT

  const child = spawn(APP_BIN, [], {
    cwd: os.homedir(),
    detached: true,
    env,
    stdio: 'ignore'
  })
  child.unref()
}

function validateBundle() {
  const required = [
    APP_BIN,
    path.join(APP_PATH, 'Contents', 'Resources', 'hermes-agent', 'hermes_cli', 'main.py'),
    path.join(APP_PATH, 'Contents', 'Resources', 'app.asar.unpacked', 'dist', 'index.html')
  ]

  for (const target of required) {
    if (!exists(target)) {
      die(`Missing packaged payload file: ${target}`)
    }
  }
}

function printArtifacts() {
  console.log('\nDesktop artifacts:')
  console.log(`  app: ${APP_PATH}`)
  console.log(`  dmg: ${DMG_PATH}`)
  console.log(`  runtime: ${RUNTIME_ROOT}`)
}

function help() {
  console.log(`Usage:
  npm run test:desktop:existing  # build packaged app, launch with normal PATH/existing Hermes
  npm run test:desktop:fresh     # build packaged app, delete bundled runtime, hide existing Hermes, launch
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
  launchFresh()
  printArtifacts()
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
