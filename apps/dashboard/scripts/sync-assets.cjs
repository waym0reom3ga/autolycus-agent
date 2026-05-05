#!/usr/bin/env node
/**
 * Copy font and asset folders from @nous-research/ui into public/ for Vite.
 *
 * Locates @nous-research/ui by walking up from this script looking for
 * node_modules/@nous-research/ui — works whether the dep is co-located
 * (non-workspace layout) or hoisted to the repo root (npm workspaces).
 */
const fs = require('node:fs')
const path = require('node:path')

const DASHBOARD_ROOT = path.resolve(__dirname, '..')

function locateUiPackage() {
  let dir = DASHBOARD_ROOT
  const { root } = path.parse(dir)
  while (true) {
    const candidate = path.join(dir, 'node_modules', '@nous-research', 'ui')
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate
    }
    if (dir === root) break
    dir = path.dirname(dir)
  }
  throw new Error(
    '@nous-research/ui not found. Run `npm install` from the repo root.'
  )
}

const uiRoot = locateUiPackage()
const distRoot = path.join(uiRoot, 'dist')

const mappings = [
  ['fonts', path.join(DASHBOARD_ROOT, 'public', 'fonts')],
  ['assets', path.join(DASHBOARD_ROOT, 'public', 'ds-assets')],
]

for (const [srcName, destPath] of mappings) {
  const srcPath = path.join(distRoot, srcName)
  if (!fs.existsSync(srcPath)) {
    throw new Error(`Missing ${srcPath} in @nous-research/ui — rebuild that package.`)
  }
  fs.rmSync(destPath, { recursive: true, force: true })
  fs.cpSync(srcPath, destPath, { recursive: true })
  console.log(`synced ${path.relative(DASHBOARD_ROOT, destPath)}`)
}
