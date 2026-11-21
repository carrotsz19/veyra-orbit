import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggest, score, type Candidate } from '../src/shared/suggest.ts'
import { SEARCH_URL, toUrl, isAllowedUrl, isInternalUrl } from '../src/shared/url.ts'

const now = Date.UTC(2026, 10, 21)
const day = 86_400_000
const c = (url: string, title: string, extra: Partial<Candidate> = {}): Candidate => ({ url, title, visits: 1, typed: 0, last: now - day, bookmarked: false, ...extra })

test('the first row is what Enter does', () => {
  assert.deepEqual(suggest('photosynthesis', [])[0], { kind: 'search', text: 'photosynthesis', url: SEARCH_URL + 'photosynthesis' })
  const s = suggest('example.com', [])
  assert.equal(s[0].kind, 'url')
  assert.equal(s[1].kind, 'search')
  assert.deepEqual(suggest('   ', []), [])
})

test('sites you know rise to the top', () => {
  const cands = [
    c('https://en.wikipedia.org/wiki/Photosynthesis', 'Photosynthesis - Wikipedia', { visits: 2 }),
    c('https://classroom.google.com/u/0/h', 'Classroom', { visits: 40, typed: 10, last: now - 3600_000 }),
    c('https://www.khanacademy.org/science/biology', 'Biology | Khan Academy')
  ]
  const s = suggest('class', cands, now)
  assert.equal(s[1].kind, 'page')
  assert.equal((s[1] as { url: string }).url, 'https://classroom.google.com/u/0/h')
  // every word has to match somewhere
  assert.equal(suggest('biology wikipedia', cands, now).length, 1)
})

test('an open tab is offered as a switch, once', () => {
  const cands = [c('https://docs.google.com/document/d/1', 'Essay draft', { tabId: 4 }), c('https://docs.google.com/document/d/1', 'Essay draft', { visits: 9 })]
  const s = suggest('essay', cands, now)
  assert.equal(s.filter((x) => x.url === 'https://docs.google.com/document/d/1').length, 1)
  assert.equal(s[1].kind, 'tab')
})

test('recent and bookmarked beat old', () => {
  const old = c('https://a.example/notes', 'Notes', { last: now - 200 * day, visits: 3 })
  const fresh = c('https://b.example/notes', 'Notes', { last: now - 3600_000, visits: 3 })
  const marked = c('https://c.example/notes', 'Notes', { last: 0, visits: 0, bookmarked: true })
  assert.ok(score(fresh, 'notes', now) > score(old, 'notes', now))
  assert.ok(score(marked, 'notes', now) > score(old, 'notes', now))
})

test('internal pages: reachable from the address bar, never from a web page', () => {
  assert.equal(toUrl('orbit://history'), 'orbit://history')
  assert.equal(toUrl('ORBIT://Bookmarks/'), 'orbit://bookmarks')
  assert.equal(isInternalUrl('orbit://history'), true)
  assert.equal(isAllowedUrl('orbit://history'), false)
  assert.ok(toUrl('orbit://anything-else')!.startsWith(SEARCH_URL))
})
