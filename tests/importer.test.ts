import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  CHROME_EPOCH_OFFSET_MS,
  chromeTimeToUnixMs,
  filterChromeHistoryRows,
  formatImportSummary,
  parseChromeBookmarks,
  unixMsToChromeTimeUs
} from '../src/shared/importer.ts'
import { BrowserImporter, discoverBrowserProfiles, readChromeHistoryFromFile } from '../src/main/importer.ts'
import { Store } from '../src/main/store.ts'

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0)
const DAY_MS = 24 * 60 * 60 * 1000

test('chromeTimeToUnixMs and unixMsToChromeTimeUs convert microseconds since 1601-01-01 accurately', () => {
  const sampleMs = Date.UTC(2026, 10, 1, 9, 30, 0)
  const expectedUs = (BigInt(sampleMs) + BigInt(CHROME_EPOCH_OFFSET_MS)) * 1000n

  assert.equal(unixMsToChromeTimeUs(sampleMs), expectedUs)
  assert.equal(chromeTimeToUnixMs(expectedUs), sampleMs)
  assert.equal(chromeTimeToUnixMs(expectedUs.toString()), sampleMs)
  assert.equal(chromeTimeToUnixMs(Number(expectedUs)), sampleMs)

  // Rejects zero, negative, non-numeric, and out-of-range timestamps.
  assert.equal(chromeTimeToUnixMs(0), null)
  assert.equal(chromeTimeToUnixMs('0'), null)
  assert.equal(chromeTimeToUnixMs(-100), null)
  assert.equal(chromeTimeToUnixMs('not-a-number'), null)
  assert.equal(chromeTimeToUnixMs(null), null)
  assert.equal(chromeTimeToUnixMs(1000), null) // year 1601
})

test('parseChromeBookmarks flattens nested folders into "Folder › Title", skips top-level roots and unsafe URLs', () => {
  const added1 = unixMsToChromeTimeUs(NOW - 5 * DAY_MS).toString()
  const added2 = unixMsToChromeTimeUs(NOW - 2 * DAY_MS).toString()

  const fixture = {
    version: 1,
    roots: {
      bookmark_bar: {
        type: 'folder',
        name: 'Bookmarks bar',
        children: [
          { type: 'url', name: 'MDN Web Docs', url: 'https://developer.mozilla.org/', date_added: added1 },
          { type: 'url', name: 'Unsafe JS', url: 'javascript:alert(1)', date_added: added1 },
          { type: 'url', name: 'Chrome Settings', url: 'chrome://settings', date_added: added1 },
          { type: 'url', name: 'Local File', url: 'file:///C:/secret.txt', date_added: added1 },
          {
            type: 'folder',
            name: 'Study',
            children: [
              {
                type: 'folder',
                name: 'Physics',
                children: [
                  { type: 'url', name: 'Khan Academy', url: 'https://www.khanacademy.org/science/physics', date_added: added2 },
                  { type: 'url', name: '', url: 'https://phet.colorado.edu/', date_added: added2 },
                  // Duplicate URL already seen in bookmark_bar: should be skipped.
                  { type: 'url', name: 'MDN Duplicate', url: 'https://developer.mozilla.org/', date_added: added2 }
                ]
              }
            ]
          }
        ]
      },
      other: {
        type: 'folder',
        name: 'Other bookmarks',
        children: [{ type: 'url', name: 'Wikipedia', url: 'http://en.wikipedia.org/', date_added: '0' }]
      },
      synced: {
        type: 'folder',
        name: 'Mobile bookmarks',
        children: [
          {
            type: 'folder',
            name: 'Reading',
            children: [{ type: 'url', name: 'ArXiv', url: 'https://arxiv.org/', date_added: added2 }]
          }
        ]
      }
    }
  }

  const parsed = parseChromeBookmarks(fixture, NOW)
  assert.deepEqual(parsed, [
    { url: 'https://developer.mozilla.org/', title: 'MDN Web Docs', created: NOW - 5 * DAY_MS },
    { url: 'https://www.khanacademy.org/science/physics', title: 'Study › Physics › Khan Academy', created: NOW - 2 * DAY_MS },
    { url: 'https://phet.colorado.edu/', title: 'Study › Physics › phet.colorado.edu', created: NOW - 2 * DAY_MS },
    { url: 'http://en.wikipedia.org/', title: 'Wikipedia', created: NOW },
    { url: 'https://arxiv.org/', title: 'Reading › ArXiv', created: NOW - 2 * DAY_MS }
  ])

  assert.deepEqual(parseChromeBookmarks(null, NOW), [])
  assert.deepEqual(parseChromeBookmarks({}, NOW), [])
})

test('filterChromeHistoryRows keeps only http(s) visits within the 90-day window and deduplicates', () => {
  const recent = Number(unixMsToChromeTimeUs(NOW - 3 * DAY_MS))
  const edgeInside = Number(unixMsToChromeTimeUs(NOW - 89 * DAY_MS))
  const tooOld = Number(unixMsToChromeTimeUs(NOW - 95 * DAY_MS))
  const farFuture = Number(unixMsToChromeTimeUs(NOW + 10 * DAY_MS))

  const rows = [
    { url: 'https://example.com/a', title: 'Page A', visit_time: recent, typed_count: 2 },
    { url: 'https://example.com/a', title: 'Page A duplicate', visit_time: recent, typed_count: 2 },
    { url: 'http://example.org/b', title: 'Page\nB', visit_time: edgeInside, typed_count: 0 },
    { url: 'https://old.example.com/', title: 'Too Old', visit_time: tooOld, typed_count: 1 },
    { url: 'https://future.example.com/', title: 'Future', visit_time: farFuture, typed_count: 0 },
    { url: 'chrome://extensions/', title: 'Extensions', visit_time: recent, typed_count: 0 },
    { url: 'file:///C:/notes.html', title: 'Notes', visit_time: recent, typed_count: 0 },
    { url: 'data:text/html,hi', title: 'Data', visit_time: recent, typed_count: 0 }
  ]

  const filtered = filterChromeHistoryRows(rows, NOW, 90)
  assert.deepEqual(filtered, [
    { url: 'https://example.com/a', title: 'Page A', time: NOW - 3 * DAY_MS, typed: true },
    { url: 'http://example.org/b', title: 'Page B', time: NOW - 89 * DAY_MS, typed: false }
  ])
})

test('formatImportSummary formats singular, plural, thousands separators, and empty results', () => {
  assert.equal(
    formatImportSummary({ bookmarksImported: 312, historyImported: 4120, bookmarksSkipped: 0, historySkipped: 0 }),
    'Imported 312 bookmarks and 4,120 history entries.'
  )
  assert.equal(
    formatImportSummary({ bookmarksImported: 1, historyImported: 1, bookmarksSkipped: 0, historySkipped: 0 }),
    'Imported 1 bookmark and 1 history entry.'
  )
  assert.equal(
    formatImportSummary({ bookmarksImported: 5, historyImported: 0, bookmarksSkipped: 0, historySkipped: 0 }),
    'Imported 5 bookmarks.'
  )
  assert.equal(
    formatImportSummary({ bookmarksImported: 0, historyImported: 0, bookmarksSkipped: 4, historySkipped: 10 }),
    'Everything selected is already in Veyra Orbit.'
  )
  assert.equal(
    formatImportSummary({ bookmarksImported: 0, historyImported: 0, bookmarksSkipped: 0, historySkipped: 0 }),
    'No new bookmarks or history entries found to import.'
  )
})

function createHistoryFixture(filePath: string, entries: { url: string; title: string; timeMs: number; typed?: number }[]): void {
  const db = new DatabaseSync(filePath)
  db.exec(`
    CREATE TABLE urls (
      id INTEGER PRIMARY KEY,
      url LONGVARCHAR,
      title LONGVARCHAR,
      visit_count INTEGER DEFAULT 0,
      typed_count INTEGER DEFAULT 0,
      last_visit_time INTEGER NOT NULL
    );
    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      url INTEGER NOT NULL,
      visit_time INTEGER NOT NULL
    );
  `)
  const insertUrl = db.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time) VALUES (?, ?, 1, ?, ?)')
  const insertVisit = db.prepare('INSERT INTO visits (url, visit_time) VALUES (?, ?)')
  db.exec('BEGIN')
  for (const e of entries) {
    const chromeUs = unixMsToChromeTimeUs(e.timeMs)
    const info = insertUrl.run(e.url, e.title, e.typed ?? 0, chromeUs)
    insertVisit.run(info.lastInsertRowid, chromeUs)
  }
  db.exec('COMMIT')
  db.close()
}

test('BrowserImporter discovers fixture profiles, copies History read-only, dedupes, and never modifies source files', () => {
  const root = mkdtempSync(join(tmpdir(), 'orbit-import-fixture-'))
  const userData = mkdtempSync(join(tmpdir(), 'orbit-userdata-fixture-'))
  const store = new Store(join(userData, 'orbit.db'))

  try {
    // Build fixture Chrome (Default + Profile 1) and Edge (Default) under importRoot.
    const chromeUserData = join(root, 'Google', 'Chrome', 'User Data')
    const chromeDefault = join(chromeUserData, 'Default')
    const chromeWork = join(chromeUserData, 'Profile 1')
    const edgeDefault = join(root, 'Microsoft', 'Edge', 'User Data', 'Default')
    mkdirSync(chromeDefault, { recursive: true })
    mkdirSync(chromeWork, { recursive: true })
    mkdirSync(edgeDefault, { recursive: true })

    writeFileSync(
      join(chromeUserData, 'Local State'),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: 'Personal' },
            'Profile 1': { name: 'School' }
          }
        }
      })
    )

    const bookmarksPath = join(chromeDefault, 'Bookmarks')
    const bookmarksJson = JSON.stringify({
      version: 1,
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bookmarks bar',
          children: [
            { type: 'url', name: 'Existing Site', url: 'https://existing.example/', date_added: unixMsToChromeTimeUs(NOW - DAY_MS).toString() },
            {
              type: 'folder',
              name: 'Lectures',
              children: [
                { type: 'url', name: 'MIT OCW', url: 'https://ocw.mit.edu/', date_added: unixMsToChromeTimeUs(NOW - 2 * DAY_MS).toString() }
              ]
            }
          ]
        }
      }
    })
    writeFileSync(bookmarksPath, bookmarksJson, 'utf8')

    const historyPath = join(chromeDefault, 'History')
    createHistoryFixture(historyPath, [
      { url: 'https://ocw.mit.edu/courses/', title: 'MIT Courses', timeMs: NOW - DAY_MS, typed: 1 },
      { url: 'https://en.wikipedia.org/wiki/Orbit', title: 'Orbit', timeMs: NOW - 10 * DAY_MS },
      { url: 'https://ancient.example/', title: 'Old Visit', timeMs: NOW - 120 * DAY_MS },
      { url: 'chrome://history', title: 'Chrome History', timeMs: NOW - DAY_MS }
    ])

    // Profile 1 has bookmarks only; Edge Default has history only.
    writeFileSync(join(chromeWork, 'Bookmarks'), bookmarksJson, 'utf8')
    createHistoryFixture(join(edgeDefault, 'History'), [
      { url: 'https://learn.microsoft.com/', title: 'Microsoft Learn', timeMs: NOW - 2 * DAY_MS }
    ])

    const bookmarksBefore = readFileSync(bookmarksPath)
    const historyBefore = readFileSync(historyPath)

    const discovered = discoverBrowserProfiles({ importRoot: root })
    assert.equal(discovered.length, 3)
    assert.deepEqual(
      discovered.map((p) => `${p.id}:${p.profileName}:${p.hasBookmarks}:${p.hasHistory}`),
      [
        'chrome:Default:Personal:true:true',
        'chrome:Profile 1:School:true:false',
        'edge:Default:Default:false:true'
      ]
    )

    // Pre-seed one bookmark so we verify deduplication against Orbit's existing bookmarks.
    store.toggleBookmark('https://existing.example/', 'Already In Orbit')

    const importer = new BrowserImporter(join(userData, 'import-state.json'), { importRoot: root })
    assert.equal(importer.status().showFirstRunPrompt, true)

    const res1 = importer.runImport({ profileId: 'chrome:Default', bookmarks: true, history: true }, store, NOW)
    assert.equal(res1.ok, true)
    assert.equal(res1.bookmarksImported, 1)
    assert.equal(res1.bookmarksSkipped, 1)
    assert.equal(res1.historyImported, 2)
    assert.equal(res1.historySkipped, 0)

    // First-run prompt is dismissed after successful import and stays dismissed across restarts.
    assert.equal(importer.status().showFirstRunPrompt, false)
    const importerReloaded = new BrowserImporter(join(userData, 'import-state.json'), { importRoot: root })
    assert.equal(importerReloaded.status().showFirstRunPrompt, false)

    // Bookmarks preserved existing title and imported nested folder title.
    const marks = store.bookmarks()
    assert.equal(marks.length, 2)
    assert.equal(marks.find((m) => m.url === 'https://existing.example/')?.title, 'Already In Orbit')
    assert.equal(marks.find((m) => m.url === 'https://ocw.mit.edu/')?.title, 'Lectures › MIT OCW')

    // History imported only the 2 recent http(s) visits.
    const hist = store.history('', null)
    assert.deepEqual(
      hist.map((h) => h.url),
      ['https://ocw.mit.edu/courses/', 'https://en.wikipedia.org/wiki/Orbit']
    )

    // Re-running import is idempotent (no duplicate bookmarks or visits).
    const res2 = importer.runImport({ profileId: 'chrome:Default', bookmarks: true, history: true }, store, NOW)
    assert.equal(res2.ok, true)
    assert.equal(res2.bookmarksImported, 0)
    assert.equal(res2.bookmarksSkipped, 2)
    assert.equal(res2.historyImported, 0)
    assert.equal(res2.historySkipped, 2)

    // Source browser files are completely untouched.
    assert.deepEqual(readFileSync(bookmarksPath), bookmarksBefore)
    assert.deepEqual(readFileSync(historyPath), historyBefore)

    // Unknown profileId is rejected safely.
    const bad = importer.runImport({ profileId: 'chrome:../../etc', bookmarks: true, history: true }, store, NOW)
    assert.equal(bad.ok, false)
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

test('readChromeHistoryFromFile and Store.importHistory handle multi-chunk histories cleanly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-import-bulk-'))
  const store = new Store(join(dir, 'orbit.db'))
  try {
    const historyPath = join(dir, 'History')
    const entries = Array.from({ length: 2400 }, (_, i) => ({
      url: `https://site${i % 200}.example/page/${i}`,
      title: `Page ${i}`,
      timeMs: NOW - (i + 1) * 10_000,
      typed: i % 10 === 0 ? 1 : 0
    }))
    createHistoryFixture(historyPath, entries)

    const visits = readChromeHistoryFromFile(historyPath, NOW, 90)
    assert.equal(visits.length, 2400)

    const res = store.importHistory(visits)
    assert.equal(res.imported, 2400)
    assert.equal(res.skipped, 0)
    assert.equal(store.history('', null, 500).length, 500)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
