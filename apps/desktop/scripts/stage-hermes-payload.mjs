import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '../..')
const OUT_ROOT = path.join(DESKTOP_ROOT, 'build', 'hermes-agent')

const ROOT_FILES = [
  'README.md',
  'LICENSE',
  'pyproject.toml',
  'run_agent.py',
  'model_tools.py',
  'toolsets.py',
  'batch_runner.py',
  'trajectory_compressor.py',
  'toolset_distributions.py',
  'cli.py',
  'hermes_constants.py',
  'hermes_logging.py',
  'hermes_state.py',
  'hermes_time.py',
  'rl_cli.py',
  'utils.py'
]

const ROOT_DIRS = [
  'acp_adapter',
  'agent',
  'cron',
  'gateway',
  'hermes_cli',
  'plugins',
  'scripts',
  'skills',
  'tools',
  'tui_gateway'
]

const TUI_FILES = ['package.json', 'package-lock.json']
const TUI_DIRS = ['dist', 'packages/hermes-ink/dist']

const EXCLUDED_NAMES = new Set([
  '.DS_Store',
  '.git',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.venv',
  '__pycache__',
  'node_modules',
  'release',
  'venv'
])

function keep(entry) {
  return !EXCLUDED_NAMES.has(entry.name) && !entry.name.endsWith('.pyc') && !entry.name.endsWith('.pyo')
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function copyFileIfPresent(relativePath) {
  const from = path.join(REPO_ROOT, relativePath)
  if (!(await exists(from))) return

  const to = path.join(OUT_ROOT, relativePath)
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.copyFile(from, to)
}

async function copyDirIfPresent(relativePath) {
  const from = path.join(REPO_ROOT, relativePath)
  if (!(await exists(from))) return

  const to = path.join(OUT_ROOT, relativePath)
  await fs.cp(from, to, {
    recursive: true,
    filter: source => keep({ name: path.basename(source) })
  })
}

async function main() {
  await fs.rm(OUT_ROOT, { force: true, recursive: true })
  await fs.mkdir(OUT_ROOT, { recursive: true })

  await Promise.all(ROOT_FILES.map(copyFileIfPresent))

  for (const dir of ROOT_DIRS) {
    await copyDirIfPresent(dir)
  }

  for (const file of TUI_FILES) {
    await copyFileIfPresent(path.join('ui-tui', file))
  }

  for (const dir of TUI_DIRS) {
    await copyDirIfPresent(path.join('ui-tui', dir))
  }
}

await main()
