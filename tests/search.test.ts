import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SEARCH_ENGINES,
  buildEngineSearchUrl,
  parseKeywordSearch,
  sanitizeSearchEngines,
  sanitizeSearchKeyword,
  validateSearchUrlTemplate
} from '../src/shared/search.ts'
import { mergeSettings, sanitizeSettings, searchUrlFor } from '../src/shared/settings.ts'
import { SettingsStore } from '../src/main/settings.ts'
import { toUrl } from '../src/shared/url.ts'
import { suggest } from '../src/shared/suggest.ts'
import { buildPaletteResults, resolveTypedPaletteText } from '../src/shared/palette.ts'

test('built-in search engines include all 9 defaults with valid https templates and unique keywords', () => {
  const ids = DEFAULT_SEARCH_ENGINES.map((e) => e.id)
  for (const required of ['google', 'duckduckgo', 'bing', 'brave', 'ecosia', 'wikipedia', 'youtube', 'github', 'mdn']) {
    assert.ok(ids.includes(required), `Missing built-in engine: ${required}`)
  }
  const kwSet = new Set<string>()
  for (const e of DEFAULT_SEARCH_ENGINES) {
    assert.ok(validateSearchUrlTemplate(e.urlTemplate), `Invalid template for ${e.id}`)
    assert.equal(kwSet.has(e.keyword), false, `Duplicate keyword ${e.keyword}`)
    kwSet.add(e.keyword)
  }
})

test('validateSearchUrlTemplate allows https with %s and rejects http, javascript, file, or missing %s', () => {
  assert.equal(validateSearchUrlTemplate('https://scholar.google.com/scholar?q=%s'), 'https://scholar.google.com/scholar?q=%s')
  assert.equal(validateSearchUrlTemplate('http://example.com/search?q=%s'), null)
  assert.equal(validateSearchUrlTemplate('javascript:alert(%s)'), null)
  assert.equal(validateSearchUrlTemplate('file:///C:/%s'), null)
  assert.equal(validateSearchUrlTemplate('https://example.com/search?q=fixed'), null)
  assert.equal(validateSearchUrlTemplate('not a url %s'), null)

  assert.equal(sanitizeSearchKeyword('!W'), 'w')
  assert.equal(sanitizeSearchKeyword('mdn'), 'mdn')
  assert.equal(sanitizeSearchKeyword('bad space'), null)
})

test('parseKeywordSearch matches "w cats", "!w cats", "w ", and trailing "cats !w"', () => {
  const m1 = parseKeywordSearch('w cats', DEFAULT_SEARCH_ENGINES)
  assert.equal(m1?.engine.id, 'wikipedia')
  assert.equal(m1?.query, 'cats')
  assert.equal(m1?.isBang, false)

  const m2 = parseKeywordSearch('!w domestic cats', DEFAULT_SEARCH_ENGINES)
  assert.equal(m2?.engine.id, 'wikipedia')
  assert.equal(m2?.query, 'domestic cats')
  assert.equal(m2?.isBang, true)

  // Space after keyword immediately triggers chip even before query is typed
  const m3 = parseKeywordSearch('!yt ', DEFAULT_SEARCH_ENGINES)
  assert.equal(m3?.engine.id, 'youtube')
  assert.equal(m3?.query, '')

  // Trailing bang
  const m4 = parseKeywordSearch('fetch api !mdn', DEFAULT_SEARCH_ENGINES)
  assert.equal(m4?.engine.id, 'mdn')
  assert.equal(m4?.query, 'fetch api')

  // Bare word without space does not hijack
  assert.equal(parseKeywordSearch('w', DEFAULT_SEARCH_ENGINES), null)
  assert.equal(parseKeywordSearch('https://wikipedia.org', DEFAULT_SEARCH_ENGINES), null)
})

test('toUrl, suggest, and palette route keyword and !bang searches to the matched engine', () => {
  assert.equal(
    toUrl('!w cats', 'https://www.google.com/search?q=%s', DEFAULT_SEARCH_ENGINES),
    'https://en.wikipedia.org/w/index.php?search=cats'
  )
  assert.equal(
    toUrl('gh veyra orbit', 'https://www.google.com/search?q=%s', DEFAULT_SEARCH_ENGINES),
    'https://github.com/search?q=veyra%20orbit'
  )
  assert.equal(
    buildEngineSearchUrl('a b', DEFAULT_SEARCH_ENGINES.find((e) => e.id === 'mdn')!),
    'https://developer.mozilla.org/en-US/search?q=a%20b'
  )

  const sug = suggest('!w cats', [], Date.now(), 7, 'https://www.google.com/search?q=%s', DEFAULT_SEARCH_ENGINES)
  assert.equal(sug[0]?.kind, 'search')
  if (sug[0]?.kind === 'search') {
    assert.equal(sug[0].engineName, 'Wikipedia')
    assert.equal(sug[0].text, 'cats')
    assert.equal(sug[0].url, 'https://en.wikipedia.org/w/index.php?search=cats')
  }

  assert.equal(
    resolveTypedPaletteText('!yt lofi', 'https://www.google.com/search?q=%s', DEFAULT_SEARCH_ENGINES),
    'https://www.youtube.com/results?search_query=lofi'
  )

  const pal = buildPaletteResults('!w electron', {
    mode: 'command',
    tabs: [],
    candidates: [],
    workspaces: [{ id: 'personal', name: 'Personal', active: true }],
    activeTab: null,
    isSplit: false,
    compactMode: false,
    isFullscreen: false,
    canReopenClosed: false,
    theme: 'system',
    searchUrl: 'https://www.google.com/search?q=%s',
    searchEngines: DEFAULT_SEARCH_ENGINES
  })
  const searchItem = pal.items.find((i) => i.id === 'search:web')
  assert.equal(searchItem?.badge, 'Wikipedia')
  assert.deepEqual(pal.actions.get('search:web'), {
    type: 'navigate',
    url: 'https://en.wikipedia.org/w/index.php?search=electron'
  })
})

test('sanitizeSearchEngines drops invalid / insecure / duplicate-keyword engines and falls back when empty', () => {
  const cleaned = sanitizeSearchEngines([
    { id: 'custom1', name: 'Scholar', keyword: 'gs', urlTemplate: 'https://scholar.google.com/scholar?q=%s' },
    { id: 'dup', name: 'Duplicate KW', keyword: 'gs', urlTemplate: 'https://example.com/?q=%s' },
    { id: 'httpbad', name: 'Insecure', keyword: 'ins', urlTemplate: 'http://example.com/?q=%s' },
    { id: 'noplaceholder', name: 'No Placeholder', keyword: 'np', urlTemplate: 'https://example.com/' }
  ])
  assert.equal(cleaned.length, 1)
  assert.equal(cleaned[0].name, 'Scholar')
  assert.equal(cleaned[0].keyword, 'gs')

  // Empty array falls back to built-in defaults
  assert.equal(sanitizeSearchEngines([]).length, DEFAULT_SEARCH_ENGINES.length)
})

test('legacy searchEngine migrates cleanly and custom default engines persist via SettingsStore', () => {
  const migrated = sanitizeSettings({ searchEngine: 'ecosia' })
  assert.equal(migrated.searchEngine, 'ecosia')
  assert.equal(migrated.searchEngines.length, DEFAULT_SEARCH_ENGINES.length)
  assert.equal(searchUrlFor(migrated.searchEngine, migrated.searchEngines), 'https://www.ecosia.org/search?q=%s')

  const customList = [
    ...DEFAULT_SEARCH_ENGINES,
    { id: 'scholar', name: 'Google Scholar', keyword: 'gs', urlTemplate: 'https://scholar.google.com/scholar?q=%s' }
  ]
  const withCustom = mergeSettings(migrated, { searchEngines: customList, searchEngine: 'scholar' })
  assert.equal(withCustom.searchEngine, 'scholar')
  assert.equal(searchUrlFor(withCustom.searchEngine, withCustom.searchEngines), 'https://scholar.google.com/scholar?q=%s')

  // Removing the active default falls back to the first remaining engine
  const afterRemove = mergeSettings(withCustom, { searchEngines: DEFAULT_SEARCH_ENGINES })
  assert.equal(afterRemove.searchEngine, DEFAULT_SEARCH_ENGINES[0].id)

  // SettingsStore validates on load and update, dropping http:// engines
  const dir = mkdtempSync(join(tmpdir(), 'orbit-search-'))
  try {
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ searchEngine: 'duckduckgo' }), 'utf8')
    const store = new SettingsStore(file, dir)
    assert.equal(store.get().searchEngine, 'duckduckgo')
    assert.equal(store.searchUrl(), 'https://duckduckgo.com/?q=%s')

    store.update({
      searchEngines: [
        { id: 'kagi', name: 'Kagi', keyword: 'k', urlTemplate: 'https://kagi.com/search?q=%s' },
        { id: 'bad', name: 'Bad', keyword: 'b', urlTemplate: 'http://evil.example/?q=%s' }
      ],
      searchEngine: 'kagi'
    })
    assert.equal(store.get().searchEngines.length, 1)
    assert.equal(store.get().searchEngine, 'kagi')
    assert.equal(store.searchUrl(), 'https://kagi.com/search?q=%s')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
