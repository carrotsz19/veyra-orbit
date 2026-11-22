import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBookmarkBarEntries,
  extractDroppedBookmark,
  normalizeBookmarkFolder,
  reorderBookmarkBarEntries,
  shouldShowBookmarkBar,
  toggleBookmarkBarMode
} from '../src/shared/bookmarks.ts'

test('buildBookmarkBarEntries preserves order and groups named folders', () => {
  const entries = buildBookmarkBarEntries([
    { url: 'https://a.example/', title: 'A', created: 100, folder: '', position: 0 },
    { url: 'https://b.example/', title: 'B', created: 200, folder: 'Study', position: 1 },
    { url: 'https://c.example/', title: 'C', created: 300, folder: '', position: 2 },
    { url: 'https://d.example/', title: 'D', created: 400, folder: 'Study', position: 3 }
  ])

  assert.equal(entries.length, 3)
  assert.equal(entries[0].kind, 'bookmark')
  assert.equal(entries[1].kind, 'folder')
  if (entries[1].kind === 'folder') {
    assert.equal(entries[1].name, 'Study')
    assert.deepEqual(
      entries[1].items.map((x) => x.title),
      ['B', 'D']
    )
  }
  assert.equal(entries[2].kind, 'bookmark')
})

test('reorderBookmarkBarEntries moves bookmarks and folders and produces sequential positions', () => {
  const list = [
    { url: 'https://a.example/', title: 'A', created: 100, folder: '', position: 0 },
    { url: 'https://b.example/', title: 'B', created: 200, folder: 'Study', position: 1 },
    { url: 'https://d.example/', title: 'D', created: 400, folder: 'Study', position: 2 },
    { url: 'https://c.example/', title: 'C', created: 300, folder: '', position: 3 }
  ]

  const updates = reorderBookmarkBarEntries(list, 'bm:https://c.example/', 'bm:https://a.example/')
  assert.deepEqual(updates, [
    { url: 'https://c.example/', position: 0 },
    { url: 'https://a.example/', position: 1 },
    { url: 'https://b.example/', position: 2 },
    { url: 'https://d.example/', position: 3 }
  ])
  assert.equal(reorderBookmarkBarEntries(list, 'bm:https://a.example/', 'bm:https://a.example/'), null)
})

test('extractDroppedBookmark parses address-bar icon JSON, HTML links, and URI lists while rejecting unsafe schemes', () => {
  assert.deepEqual(
    extractDroppedBookmark({ customJson: JSON.stringify({ url: 'https://example.com/notes', title: 'Notes' }) }),
    { url: 'https://example.com/notes', title: 'Notes' }
  )
  assert.deepEqual(
    extractDroppedBookmark({ html: '<a href="https://docs.example.org/guide">Study Guide</a>' }),
    { url: 'https://docs.example.org/guide', title: 'Study Guide' }
  )
  assert.deepEqual(
    extractDroppedBookmark({ uriList: '# comment\nhttps://www.wikipedia.org/' }),
    { url: 'https://www.wikipedia.org/', title: 'wikipedia.org' }
  )
  assert.equal(extractDroppedBookmark({ uriList: 'javascript:alert(1)' }), null)
  assert.equal(extractDroppedBookmark({ uriList: 'file:///C:/Windows/win.ini' }), null)
  assert.equal(extractDroppedBookmark({ plain: 'not a url' }), null)
  assert.equal(normalizeBookmarkFolder('  Math\nNotes  '), 'Math Notes')
})

test('shouldShowBookmarkBar and toggleBookmarkBarMode handle always / start-page / never modes', () => {
  assert.equal(shouldShowBookmarkBar('always', false, false), true)
  assert.equal(shouldShowBookmarkBar('always', false, true), false)
  assert.equal(shouldShowBookmarkBar('start-page', true, false), true)
  assert.equal(shouldShowBookmarkBar('start-page', false, false), false)
  assert.equal(shouldShowBookmarkBar('never', true, false), false)

  // Ctrl+Shift+B visibly flips current visibility
  assert.equal(toggleBookmarkBarMode('start-page', true), 'never')
  assert.equal(toggleBookmarkBarMode('start-page', false), 'always')
  assert.equal(toggleBookmarkBarMode('always', false), 'never')
  assert.equal(toggleBookmarkBarMode('never', false), 'always')
})
