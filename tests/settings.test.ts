import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, SEARCH_ENGINES, mergeSettings, sanitizeSettings, searchUrlFor } from '../src/shared/settings.ts'
import { SettingsStore } from '../src/main/settings.ts'

test('sanitizeSettings returns safe defaults for non-objects and drops unknown keys', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(sanitizeSettings('bad'), DEFAULT_SETTINGS)
  assert.deepEqual(sanitizeSettings([1, 2, 3]), DEFAULT_SETTINGS)

  const cleaned = sanitizeSettings({
    searchEngine: 'duckduckgo',
    theme: 'dark',
    startup: 'new-tab',
    downloadsDir: '  C:\\Temp\\DL  ',
    askWhereToSave: true,
    compactMode: true,
    sleepAfterMinutes: 60,
    sleepPinnedTabs: true,
    windowButtons: 'dots',
    extra: 'drop me',
    __proto__: { polluted: true }
  })
  assert.deepEqual(cleaned, {
    searchEngine: 'duckduckgo',
    theme: 'dark',
    startup: 'new-tab',
    downloadsDir: 'C:\\Temp\\DL',
    askWhereToSave: true,
    compactMode: true,
    sleepAfterMinutes: 60,
    sleepPinnedTabs: true,
    windowButtons: 'dots'
  })
  assert.equal('extra' in cleaned, false)
})

test('sanitizeSettings rejects invalid field values and falls back to defaults', () => {
  const cleaned = sanitizeSettings({
    searchEngine: 'yahoo',
    theme: 'sepia',
    startup: 'homepage',
    downloadsDir: 'bad\0path',
    askWhereToSave: 'yes',
    compactMode: 'on',
    sleepAfterMinutes: 45,
    sleepPinnedTabs: 1,
    windowButtons: 'macos'
  })
  assert.deepEqual(cleaned, DEFAULT_SETTINGS)
})

test('mergeSettings applies valid fields and ignores invalid or unknown ones', () => {
  const start = { ...DEFAULT_SETTINGS }
  const next = mergeSettings(start, {
    searchEngine: 'brave',
    theme: 'invalid',
    startup: 'new-tab',
    downloadsDir: 'C:\\Downloads',
    askWhereToSave: true,
    compactMode: true,
    sleepAfterMinutes: 15,
    sleepPinnedTabs: true,
    windowButtons: 'dots',
    unknown: 123
  })
  assert.deepEqual(next, {
    searchEngine: 'brave',
    theme: 'system',
    startup: 'new-tab',
    downloadsDir: 'C:\\Downloads',
    askWhereToSave: true,
    compactMode: true,
    sleepAfterMinutes: 15,
    sleepPinnedTabs: true,
    windowButtons: 'dots'
  })
  assert.deepEqual(mergeSettings(next, null), next)
  assert.deepEqual(mergeSettings(next, { downloadsDir: 'bad\nline' }), next)
})

test('searchUrlFor covers every configured search engine', () => {
  for (const engine of SEARCH_ENGINES) {
    assert.equal(searchUrlFor(engine.id), engine.url)
    assert.ok(engine.url.startsWith('https://'))
  }
})

test('SettingsStore persists sanitized settings and honours env downloads override', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-settings-'))
  try {
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ searchEngine: 'ecosia', unknownKey: 42, theme: 'invalid' }), 'utf8')

    const store = new SettingsStore(file, 'C:\\DefaultDownloads')
    assert.deepEqual(store.get(), {
      ...DEFAULT_SETTINGS,
      searchEngine: 'ecosia'
    })
    assert.equal(store.view().effectiveDownloadsDir, 'C:\\DefaultDownloads')
    assert.equal(store.view().downloadsOverridden, false)

    const updated = store.update({ theme: 'dark', downloadsDir: 'C:\\CustomDL', askWhereToSave: true })
    assert.equal(updated.theme, 'dark')
    assert.equal(updated.effectiveDownloadsDir, 'C:\\CustomDL')
    assert.equal(updated.askWhereToSave, true)

    const rawOnDisk = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    assert.equal('unknownKey' in rawOnDisk, false)
    assert.equal(rawOnDisk.theme, 'dark')

    // Reload with VEYRA_DOWNLOADS override winning over saved downloadsDir
    const overridden = new SettingsStore(file, 'C:\\DefaultDownloads', 'C:\\EnvDownloads')
    assert.equal(overridden.get().downloadsDir, 'C:\\CustomDL')
    assert.equal(overridden.effectiveDownloadsDir(), 'C:\\EnvDownloads')
    assert.equal(overridden.view().downloadsOverridden, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
