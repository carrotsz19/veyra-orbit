import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DAILY_QUOTES,
  DEFAULT_START_PAGE,
  START_PAGE_LIMITS,
  START_WIDGET_IDS,
  isValidBackgroundFilename,
  mergeStartPage,
  normalizeQuickLinkUrl,
  quoteForDate,
  reorderList,
  sanitizeQuickLinks,
  sanitizeStartPage,
  sanitizeStartWidgets
} from '../src/shared/startpage.ts'

test('normalizeQuickLinkUrl accepts valid http(s) and bare domains, rejects dangerous schemes', () => {
  assert.equal(normalizeQuickLinkUrl('https://en.wikipedia.org/wiki/Electron'), 'https://en.wikipedia.org/wiki/Electron')
  assert.equal(normalizeQuickLinkUrl('http://localhost:3000/test'), 'http://localhost:3000/test')
  assert.equal(normalizeQuickLinkUrl('khanacademy.org'), 'https://khanacademy.org/')

  assert.equal(normalizeQuickLinkUrl('javascript:alert(1)'), null)
  assert.equal(normalizeQuickLinkUrl('file:///C:/Windows/win.ini'), null)
  assert.equal(normalizeQuickLinkUrl('data:text/html,<script>alert(1)</script>'), null)
  assert.equal(normalizeQuickLinkUrl('chrome://settings'), null)
  assert.equal(normalizeQuickLinkUrl('orbit://settings'), null)
  assert.equal(normalizeQuickLinkUrl('not a url with spaces'), null)
  assert.equal(normalizeQuickLinkUrl('justoneword'), null)
  assert.equal(normalizeQuickLinkUrl('https://example.com/' + 'a'.repeat(3000)), null)
})

test('sanitizeQuickLinks drops unsafe entries, deduplicates ids, truncates titles, and enforces max count', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: 'dup',
    title: `Site ${i} ` + 'x'.repeat(100),
    url: `https://site${i}.example.com`
  }))
  const cleaned = sanitizeQuickLinks([
    { id: 'bad1', title: 'XSS', url: 'javascript:alert(1)' },
    { id: 'bad2', title: 'File', url: 'file:///etc/passwd' },
    { id: 'ok-1', title: '', url: 'wikipedia.org' },
    ...many
  ])

  assert.equal(cleaned.length, START_PAGE_LIMITS.maxQuickLinks)
  assert.equal(cleaned[0].url, 'https://wikipedia.org/')
  assert.equal(cleaned[0].title, 'wikipedia.org')
  assert.ok(cleaned[1].title.length <= START_PAGE_LIMITS.maxQuickLinkTitle)
  const ids = new Set(cleaned.map((c) => c.id))
  assert.equal(ids.size, cleaned.length)
})

test('isValidBackgroundFilename allows only app-owned uuid .jpg filenames and blocks traversal', () => {
  assert.equal(isValidBackgroundFilename(''), true)
  assert.equal(isValidBackgroundFilename('550e8400-e29b-41d4-a716-446655440000.jpg'), true)
  assert.equal(isValidBackgroundFilename('../secret.jpg'), false)
  assert.equal(isValidBackgroundFilename('C:\\Windows\\bg.jpg'), false)
  assert.equal(isValidBackgroundFilename('photo.png'), false)
  assert.equal(isValidBackgroundFilename('a/b.jpg'), false)
})

test('sanitizeStartWidgets preserves valid order, deduplicates, and appends missing widgets', () => {
  const cleaned = sanitizeStartWidgets([
    { id: 'quote', enabled: false },
    { id: 'search', enabled: true },
    { id: 'quote', enabled: true },
    { id: 'nonexistent', enabled: true }
  ])
  assert.equal(cleaned.length, START_WIDGET_IDS.length)
  assert.deepEqual(cleaned[0], { id: 'quote', enabled: false })
  assert.deepEqual(cleaned[1], { id: 'search', enabled: true })
  assert.equal(new Set(cleaned.map((w) => w.id)).size, START_WIDGET_IDS.length)
})

test('sanitizeStartPage and mergeStartPage clamp ranges, sanitize strings, and preserve valid fields', () => {
  const cleaned = sanitizeStartPage({
    background: 'image',
    backgroundImage: '../evil.jpg',
    backgroundDim: 99,
    backgroundBlur: -5,
    layout: 'wide',
    density: 'spacious',
    clockFormat: '24h',
    showSeconds: true,
    userName: '  Garrett\nLine  ',
    quickLinks: [{ id: 'a', title: 'Docs', url: 'docs.example.com' }],
    quickLinksCustomized: true,
    quickLinkSize: 'lg',
    quickLinkColumns: 12,
    focusNote: 'Study chapter 4\r\nDo exercises',
    widgets: [{ id: 'focus-note', enabled: true }]
  })

  assert.equal(cleaned.background, 'image')
  assert.equal(cleaned.backgroundImage, '')
  assert.equal(cleaned.backgroundDim, START_PAGE_LIMITS.backgroundDim.max)
  assert.equal(cleaned.backgroundBlur, START_PAGE_LIMITS.backgroundBlur.min)
  assert.equal(cleaned.layout, 'wide')
  assert.equal(cleaned.density, 'spacious')
  assert.equal(cleaned.clockFormat, '24h')
  assert.equal(cleaned.showSeconds, true)
  assert.equal(cleaned.userName, 'Garrett Line')
  assert.equal(cleaned.quickLinks.length, 1)
  assert.equal(cleaned.quickLinkSize, 'lg')
  assert.equal(cleaned.quickLinkColumns, START_PAGE_LIMITS.quickLinkColumns.max)
  assert.equal(cleaned.focusNote, 'Study chapter 4\nDo exercises')
  assert.equal(cleaned.widgets[0].id, 'focus-note')
  assert.equal(cleaned.widgets.length, START_WIDGET_IDS.length)

  const merged = mergeStartPage(cleaned, {
    clockFormat: 'invalid',
    backgroundDim: 40,
    userName: 'Alex'
  })
  assert.equal(merged.clockFormat, '24h')
  assert.equal(merged.backgroundDim, 40)
  assert.equal(merged.userName, 'Alex')
  assert.deepEqual(sanitizeStartPage(null), DEFAULT_START_PAGE)

  // Legacy 'ambient' background setting migrates cleanly to the calm default surface.
  const migrated = sanitizeStartPage({ background: 'ambient' })
  assert.equal(migrated.background, DEFAULT_START_PAGE.background)
  assert.equal(migrated.background, 'solid')

  // Calm tinted mode is accepted and preserved.
  const tinted = sanitizeStartPage({ background: 'tinted' })
  assert.equal(tinted.background, 'tinted')
})

test('reorderList and quoteForDate work deterministically', () => {
  assert.deepEqual(reorderList(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(reorderList(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b'])
  assert.deepEqual(reorderList(['a', 'b'], 0, 99), ['b', 'a'])

  const q1 = quoteForDate(new Date(2026, 10, 22))
  const q2 = quoteForDate(new Date(2026, 10, 22))
  const q3 = quoteForDate(new Date(2026, 10, 23))
  assert.deepEqual(q1, q2)
  assert.ok(DAILY_QUOTES.includes(q1))
  assert.notEqual(q1.text, q3.text)
})
