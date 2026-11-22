import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPEARANCE_LIMITS,
  DEFAULT_APPEARANCE,
  THEME_PRESETS,
  contrastRatio,
  deriveAccentTokens,
  exportAppearanceJson,
  mergeAppearance,
  normalizeHexColor,
  parseImportedAppearanceJson,
  resolveAppearanceTokens,
  sanitizeAppearance
} from '../src/shared/appearance.ts'

test('sanitizeAppearance clamps numeric ranges, validates hex colours and enums, and drops unknown keys', () => {
  assert.deepEqual(sanitizeAppearance(null), DEFAULT_APPEARANCE)
  assert.deepEqual(sanitizeAppearance(['bad']), DEFAULT_APPEARANCE)

  const cleaned = sanitizeAppearance({
    preset: 'midnight',
    accent: ' #3A7 ',
    cornerRadius: 99,
    density: 'spacious',
    textScale: 50,
    sidebarSide: 'right',
    sidebarWidth: 120,
    translucentSidebar: false,
    tabCloseButtons: 'always',
    addressBarAlign: 'left',
    showNavButtons: false,
    showBookmarkStar: false,
    showExtensions: false,
    menuBarStyle: 'hamburger',
    pageGap: -10,
    pageRadius: 42.6,
    pageShadow: false,
    motion: 'reduced',
    customCss: 'body { display: none }',
    __proto__: { evil: true }
  })

  assert.deepEqual(cleaned, {
    preset: 'midnight',
    accent: '#33aa77',
    cornerRadius: APPEARANCE_LIMITS.cornerRadius.max,
    density: 'spacious',
    textScale: APPEARANCE_LIMITS.textScale.min,
    sidebarSide: 'right',
    sidebarWidth: APPEARANCE_LIMITS.sidebarWidth.min,
    translucentSidebar: false,
    tabCloseButtons: 'always',
    addressBarAlign: 'left',
    showNavButtons: false,
    showBookmarkStar: false,
    showExtensions: false,
    menuBarStyle: 'hamburger',
    pageGap: APPEARANCE_LIMITS.pageGap.min,
    pageRadius: APPEARANCE_LIMITS.pageRadius.max,
    pageShadow: false,
    motion: 'reduced'
  })
  assert.equal('customCss' in cleaned, false)
})

test('sanitizeAppearance falls back to defaults on invalid enum, NaN, Infinity, and bad hex strings', () => {
  const cleaned = sanitizeAppearance({
    preset: 'neon-cyber',
    accent: 'javascript:alert(1)',
    cornerRadius: Number.NaN,
    density: 'huge',
    textScale: Number.POSITIVE_INFINITY,
    sidebarSide: 'top',
    sidebarWidth: '300',
    translucentSidebar: 'yes',
    tabCloseButtons: 'never',
    addressBarAlign: 'right',
    showNavButtons: 1,
    showBookmarkStar: 0,
    showExtensions: null,
    menuBarStyle: 'ribbon',
    pageGap: '8px',
    pageRadius: null,
    pageShadow: 'on',
    motion: 'fast'
  })
  assert.deepEqual(cleaned, DEFAULT_APPEARANCE)
  assert.equal(normalizeHexColor('#12345g'), null)
  assert.equal(normalizeHexColor('red'), null)
  assert.equal(normalizeHexColor('#ABCDEF'), '#abcdef')
})

test('mergeAppearance updates only valid provided fields and preserves others', () => {
  const step1 = mergeAppearance(DEFAULT_APPEARANCE, {
    preset: 'ocean',
    sidebarWidth: 310,
    sidebarSide: 'right',
    accent: '#116688'
  })
  assert.equal(step1.preset, 'ocean')
  assert.equal(step1.sidebarWidth, 310)
  assert.equal(step1.sidebarSide, 'right')
  assert.equal(step1.accent, '#116688')

  // Invalid values leave previous state untouched; out-of-range numbers clamp.
  const step2 = mergeAppearance(step1, {
    preset: 'invalid',
    accent: 'not-a-hex',
    sidebarWidth: 999,
    pageGap: 12
  })
  assert.equal(step2.preset, 'ocean')
  assert.equal(step2.accent, '#116688')
  assert.equal(step2.sidebarWidth, APPEARANCE_LIMITS.sidebarWidth.max)
  assert.equal(step2.pageGap, 12)
})

test('deriveAccentTokens guarantees >= 4.5:1 WCAG contrast across extreme colours in light and dark modes', () => {
  const testColors = [
    '#000000',
    '#ffffff',
    '#ffff00',
    '#00ff00',
    '#ff00ff',
    '#777777',
    '#b3492b',
    '#d9633e',
    '#2244aa',
    '#ff9900',
    '#12c2e9',
    '#f64f59'
  ]

  for (const preset of THEME_PRESETS) {
    for (const isDark of [false, true]) {
      const pal = isDark ? preset.dark : preset.light
      for (const hex of testColors) {
        const d = deriveAccentTokens(hex, isDark, pal.bgElevated, pal.bgGrouped)
        assert.ok(
          contrastRatio(d.tint, d.onTint) >= 4.5,
          `onTint contrast failed for ${hex} on ${preset.id} (${isDark ? 'dark' : 'light'}): ${contrastRatio(d.tint, d.onTint)}`
        )
        assert.ok(
          contrastRatio(d.tintHover, d.onTint) >= 4.5,
          `hover onTint contrast failed for ${hex} on ${preset.id} (${isDark ? 'dark' : 'light'}): ${contrastRatio(d.tintHover, d.onTint)}`
        )
        assert.ok(
          contrastRatio(d.tintText, pal.bgElevated) >= 4.5,
          `tintText elevated contrast failed for ${hex} on ${preset.id} (${isDark ? 'dark' : 'light'}): ${contrastRatio(d.tintText, pal.bgElevated)}`
        )
        assert.ok(
          contrastRatio(d.tintText, pal.bgGrouped) >= 4.5,
          `tintText grouped contrast failed for ${hex} on ${preset.id} (${isDark ? 'dark' : 'light'}): ${contrastRatio(d.tintText, pal.bgGrouped)}`
        )
      }
    }
  }
})

test('exportAppearanceJson and parseImportedAppearanceJson round-trip safely and reject bad/malicious payloads', () => {
  const custom = sanitizeAppearance({
    preset: 'forest',
    accent: '#2b6b45',
    cornerRadius: 14,
    density: 'spacious',
    textScale: 110,
    sidebarSide: 'right',
    sidebarWidth: 292,
    translucentSidebar: false,
    tabCloseButtons: 'always',
    addressBarAlign: 'left',
    showNavButtons: false,
    showBookmarkStar: true,
    showExtensions: false,
    menuBarStyle: 'hamburger',
    pageGap: 12,
    pageRadius: 16,
    pageShadow: false,
    motion: 'reduced'
  })

  const json = exportAppearanceJson('dark', custom)
  const imported = parseImportedAppearanceJson(json)
  assert.equal(imported.ok, true)
  if (imported.ok) {
    assert.equal(imported.theme, 'dark')
    assert.deepEqual(imported.appearance, custom)
  }

  // Reject malformed, wrong format, oversized, or non-appearance JSON
  assert.equal(parseImportedAppearanceJson('').ok, false)
  assert.equal(parseImportedAppearanceJson('{not json').ok, false)
  assert.equal(parseImportedAppearanceJson('[]').ok, false)
  assert.equal(parseImportedAppearanceJson(JSON.stringify({ format: 'evil-theme', appearance: { preset: 'ocean' } })).ok, false)
  assert.equal(parseImportedAppearanceJson(JSON.stringify({ unrelated: 123 })).ok, false)
  assert.equal(parseImportedAppearanceJson('{"preset":"ocean","pad":"' + 'a'.repeat(40_000) + '"}').ok, false)

  // Strips unknown / injected fields even inside valid JSON
  const injected = parseImportedAppearanceJson(
    JSON.stringify({
      format: 'veyra-orbit-theme',
      version: 1,
      theme: 'light',
      appearance: {
        preset: 'rose',
        accent: '#a63e5c',
        customCss: '*{background:red}',
        customJs: 'alert(1)',
        cornerRadius: 500
      }
    })
  )
  assert.equal(injected.ok, true)
  if (injected.ok) {
    assert.equal(injected.appearance.preset, 'rose')
    assert.equal(injected.appearance.cornerRadius, APPEARANCE_LIMITS.cornerRadius.max)
    assert.equal('customCss' in injected.appearance, false)
    assert.equal('customJs' in injected.appearance, false)
  }
})

test('resolveAppearanceTokens produces full CSS vars, falls back to solid without acrylic, and honours reduced motion', () => {
  const solid = resolveAppearanceTokens({ ...DEFAULT_APPEARANCE, preset: 'paper', translucentSidebar: true }, false, false, false)
  assert.equal(solid.effectiveMaterial, 'solid')
  assert.equal(solid.attrs.material, 'solid')
  assert.equal(solid.vars['--side'], '248px')

  const acrylicOn = resolveAppearanceTokens({ ...DEFAULT_APPEARANCE, preset: 'midnight', translucentSidebar: true }, true, true, false)
  assert.equal(acrylicOn.effectiveMaterial, 'acrylic')
  assert.equal(acrylicOn.isDark, true)
  assert.equal(acrylicOn.vars['--bg-shell'], '#0c0e17')

  const reducedByOs = resolveAppearanceTokens({ ...DEFAULT_APPEARANCE, motion: 'full' }, false, false, true)
  assert.equal(reducedByOs.effectiveMotion, 'reduced')
  assert.equal(reducedByOs.attrs.motion, 'reduced')

  const motionOff = resolveAppearanceTokens({ ...DEFAULT_APPEARANCE, motion: 'off' }, false, false, false)
  assert.equal(motionOff.effectiveMotion, 'off')
  assert.equal(motionOff.vars['--t-base'], '0ms')
})
