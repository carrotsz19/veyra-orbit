import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/store.ts'

function fresh(): { s: Store; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-store-'))
  const s = new Store(join(dir, 'orbit.db'))
  return { s, done: () => (s.close(), rmSync(dir, { recursive: true, force: true })) }
}

const T = Date.UTC(2026, 10, 21, 12)

test('visits are recorded once per quick reload, newest first', () => {
  const { s, done } = fresh()
  s.visit('https://example.com/a', 'A', true, T)
  s.visit('https://example.com/a', 'A', false, T + 1000) // a reload: same visit
  s.visit('https://example.com/b', 'B', false, T + 60_000)
  s.visit('https://example.com/a', '', false, T + 120_000) // empty title keeps the old one
  const h = s.history('', null)
  assert.deepEqual(h.map((r) => r.url), ['https://example.com/a', 'https://example.com/b', 'https://example.com/a'])
  assert.equal(h[0].title, 'A')
  const [a] = s.candidates('example.com/a')
  assert.equal(a.visits, 2)
  assert.equal(a.typed, 1)
  done()
})

test('only web pages are recorded', () => {
  const { s, done } = fresh()
  for (const u of ['orbit://history', 'about:blank', 'file:///C:/x.txt', 'javascript:alert(1)']) s.visit(u, 'x', false, T)
  assert.equal(s.history('', null).length, 0)
  assert.equal(s.toggleBookmark('orbit://history', 'x'), false)
  assert.equal(s.bookmarks().length, 0)
  done()
})

test('search, paging and deleting', () => {
  const { s, done } = fresh()
  for (let i = 0; i < 5; i++) s.visit(`https://site${i}.test/`, `Page ${i}`, false, T + i * 10_000)
  assert.deepEqual(s.history('page 3', null).map((r) => r.title), ['Page 3'])
  const first = s.history('', null, 2)
  const next = s.history('', first[1].time, 2)
  assert.deepEqual([...first, ...next].map((r) => r.title), ['Page 4', 'Page 3', 'Page 2', 'Page 1'])
  s.deleteVisit(first[0].id)
  assert.equal(s.candidates('site4').length, 0, 'last visit gone: the address goes too')
  s.clear(T + 25_000) // clears Page 3 (T+30s); keeps 0-2
  assert.deepEqual(s.history('', null).map((r) => r.title), ['Page 2', 'Page 1', 'Page 0'])
  s.clear(0)
  assert.equal(s.history('', null).length, 0)
  done()
})

test('bookmarks: toggle, rename, and found by the address bar even if never visited', () => {
  const { s, done } = fresh()
  assert.equal(s.toggleBookmark('https://classroom.google.com/', 'Classroom'), true)
  assert.equal(s.isBookmarked('https://classroom.google.com/'), true)
  const [c] = s.candidates('class')
  assert.equal(c.bookmarked, true)
  s.renameBookmark('https://classroom.google.com/', '  School  ')
  assert.equal(s.bookmarks()[0].title, 'School')
  s.visit('https://classroom.google.com/', 'Classroom', false, T)
  s.clear(0)
  assert.equal(s.bookmarks().length, 1, 'clearing history keeps bookmarks')
  assert.equal(s.toggleBookmark('https://classroom.google.com/', ''), false)
  assert.equal(s.bookmarks().length, 0)
  done()
})
