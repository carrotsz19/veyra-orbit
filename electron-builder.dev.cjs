// Veyra Orbit Dev: a separate app (own name, ID, install folder and profile) for trying changes
// before they reach Veyra Orbit. Built by tools/dist-dev.mjs.
const base = require('./package.json').build

module.exports = {
  ...base,
  appId: 'app.veyra.orbit.dev',
  productName: 'Veyra Orbit Dev',
  directories: { output: 'release-dev' },
  artifactName: 'Veyra-Orbit-Dev-Setup-${version}.${ext}',
  nsis: { ...base.nsis, shortcutName: 'Veyra Orbit Dev', uninstallDisplayName: 'Veyra Orbit Dev' }
}
