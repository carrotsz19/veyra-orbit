import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_MODS,
  MAX_CUSTOM_CSS_BYTES,
  buildEffectiveCustomCss,
  isSafeModeLaunch,
  sanitizeCustomCss,
  sanitizeEnabledMods,
  utf8ByteLength
} from '../src/shared/customCss.ts'
import {
  DEFAULT_APPEARANCE,
  exportAppearanceJson,
  parseImportedAppearanceJson,
  resolveAppearanceTokens,
  sanitizeAppearance
} from '../src/shared/appearance.ts'

test('sanitizeCustomCss strips @import, remote url(), closing style tags, and legacy JS-in-CSS vectors', () => {
  const malicious = [
    '@import url("https://evil.example/a.css");',
    '@import "https://evil.example/b.css";',
    '@\\69 mport url(http://evil.example/c.css);',
    '.a { background: url(https://evil.example/bg.png); }',
    '.b { background: url("http://evil.example/bg.png"); }',
    '.c { background: url(file:///C:/secret.png); }',
    '.d { background: u\\72 l(https://evil.example/escaped.png); }',
    '.e { background: url("data:image/png;base64,iVBORw0KGgo="); }',
    '.f { background: url("data:text/html,<script>alert(1)</script>"); }',
    '.g { width: expression(alert(1)); behavior: url(x.htc); }',
    '</style><script>alert(1)</script>',
    '.ok { border-radius: 12px; }'
  ].join('\n')

  const clean = sanitizeCustomCss(malicious)
  assert.equal(clean.includes('@import'), false)
  assert.equal(clean.includes('evil.example'), false)
  assert.equal(clean.includes('file:///'), false)
  assert.equal(clean.includes('</style'), false)
  assert.equal(clean.includes('expression('), false)
  assert.equal(clean.includes('behavior:'), false)
  assert.equal(clean.includes('data:text/html'), false)
  // Safe image data: URI and normal rules survive
  assert.ok(clean.includes('data:image/png;base64,iVBORw0KGgo='))
  assert.ok(clean.includes('.ok { border-radius: 12px; }'))
})

test('sanitizeCustomCss enforces 64 KB UTF-8 limit', () => {
  const huge = '.x { color: red; }\n'.repeat(5000)
  assert.ok(utf8ByteLength(huge) > MAX_CUSTOM_CSS_BYTES)
  const clean = sanitizeCustomCss(huge)
  assert.ok(utf8ByteLength(clean) <= MAX_CUSTOM_CSS_BYTES)
})

test('built-in mods sanitize, combine with custom CSS, and disable completely in safe mode', () => {
  assert.equal(BUILTIN_MODS.length, 3)
  assert.deepEqual(sanitizeEnabledMods(['hide-sidebar-footer', 'unknown', 'hide-sidebar-footer', 'larger-tab-rows']), [
    'hide-sidebar-footer',
    'larger-tab-rows'
  ])

  const combined = buildEffectiveCustomCss({
    customCssEnabled: true,
    customCss: '.custom { opacity: 0.9; }',
    enabledMods: ['hide-sidebar-footer'],
    safeMode: false
  })
  assert.ok(combined.includes('.side .ws-bar'))
  assert.ok(combined.includes('.custom { opacity: 0.9; }'))

  // Custom CSS disabled still allows enabled built-in mods
  const modsOnly = buildEffectiveCustomCss({
    customCssEnabled: false,
    customCss: '.custom { opacity: 0.9; }',
    enabledMods: ['hide-bookmark-icons'],
    safeMode: false
  })
  assert.ok(modsOnly.includes('.bm-bar'))
  assert.equal(modsOnly.includes('.custom'), false)

  // Safe mode disables BOTH custom CSS and mods
  const safe = buildEffectiveCustomCss({
    customCssEnabled: true,
    customCss: '.custom { opacity: 0.9; }',
    enabledMods: ['hide-sidebar-footer', 'larger-tab-rows'],
    safeMode: true
  })
  assert.equal(safe, '')

  assert.equal(isSafeModeLaunch(['electron', '.', '--safe-mode'], {}), true)
  assert.equal(isSafeModeLaunch(['electron', '.'], { VEYRA_SAFE_MODE: '1' }), true)
  assert.equal(isSafeModeLaunch(['electron', '.'], {}), false)
})

test('custom CSS & enabled mods round-trip safely through theme export/import and resolveAppearanceTokens', () => {
  const app = sanitizeAppearance({
    ...DEFAULT_APPEARANCE,
    customCssEnabled: true,
    customCss: '@import "https://bad.example/x.css";\n.tab { letter-spacing: 0.01em; }',
    enabledMods: ['larger-tab-rows']
  })
  assert.equal(app.customCss.includes('@import'), false)
  assert.ok(app.customCss.includes('.tab { letter-spacing: 0.01em; }'))
  assert.deepEqual(app.enabledMods, ['larger-tab-rows'])

  const tokens = resolveAppearanceTokens(app, false, false, false, false)
  assert.ok(tokens.customCss.includes('--tab-h: 40px'))
  assert.ok(tokens.customCss.includes('letter-spacing'))

  const safeTokens = resolveAppearanceTokens(app, false, false, false, true)
  assert.equal(safeTokens.customCss, '')
  assert.equal(safeTokens.safeMode, true)

  const json = exportAppearanceJson('dark', app)
  const imported = parseImportedAppearanceJson(json)
  assert.equal(imported.ok, true)
  if (imported.ok) {
    assert.deepEqual(imported.appearance.enabledMods, ['larger-tab-rows'])
    assert.equal(imported.appearance.customCssEnabled, true)
    assert.equal(imported.appearance.customCss, app.customCss)
  }
})
