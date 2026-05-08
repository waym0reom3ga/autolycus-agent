/**
 * Desktop bundles ship precompiled renderer assets and a staged Hermes payload
 * from extraResources. Returning false here tells electron-builder to skip the
 * node_modules collector/install step, which avoids workspace dependency graph
 * explosions and keeps packaging deterministic across environments.
 */
module.exports = async function beforeBuild() {
  return false
}
