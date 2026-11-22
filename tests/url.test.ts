import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toUrl,
  isAllowedUrl,
  isInternalUrl,
  displayUrl,
  buildSearchUrl,
  SEARCH_URL,
  shouldFocusOmniboxOnActivate,
  resolveOmniboxSync
} from '../src/shared/url.ts'

test('sites go to https, local addresses to http', () => {
  assert.equal(toUrl('example.com'), 'https://example.com')
  assert.equal(toUrl('docs.google.com/document/d/1'), 'https://docs.google.com/document/d/1')
  assert.equal(toUrl('localhost:5173'), 'http://localhost:5173')
  assert.equal(toUrl('192.168.1.4:8080/x'), 'http://192.168.1.4:8080/x')
  assert.equal(toUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1')
})

test('anything else is a search', () => {
  assert.equal(toUrl('photosynthesis light reactions'), SEARCH_URL + 'photosynthesis%20light%20reactions')
  assert.equal(toUrl('mitochondria'), SEARCH_URL + 'mitochondria')
  assert.equal(toUrl('e.g. this'), SEARCH_URL + 'e.g.%20this')
  assert.equal(toUrl('   '), null)
})

test('dangerous schemes are never loaded', () => {
  for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,hi', 'chrome://settings', 'veyra-file://x']) {
    assert.equal(isAllowedUrl(bad), false, bad)
    assert.ok(toUrl(bad)!.startsWith(SEARCH_URL), bad)
  }
  assert.equal(isAllowedUrl('about:blank'), true)
})

test('addresses are shown short', () => {
  assert.equal(displayUrl('https://www.example.com/'), 'example.com')
  assert.equal(displayUrl('https://example.com/a?b=1'), 'example.com/a?b=1')
  assert.equal(displayUrl('http://localhost:5173/'), 'http://localhost:5173')
  assert.equal(displayUrl('orbit://settings'), 'orbit://settings')
})

test('custom search engines build search URLs without breaking URL detection', () => {
  const ddg = 'https://duckduckgo.com/?q='
  assert.equal(buildSearchUrl('cell division', ddg), 'https://duckduckgo.com/?q=cell%20division')
  assert.equal(toUrl('cell division', ddg), 'https://duckduckgo.com/?q=cell%20division')
  assert.equal(toUrl('example.com', ddg), 'https://example.com')
  assert.equal(toUrl('orbit://settings', ddg), 'orbit://settings')
  assert.equal(isInternalUrl('orbit://settings'), true)
  assert.equal(isAllowedUrl('orbit://settings'), false)
})

test('only blank start-page tabs auto-focus the address bar on activation', () => {
  assert.equal(shouldFocusOmniboxOnActivate({ url: '' }), true)
  assert.equal(shouldFocusOmniboxOnActivate({ url: 'orbit://settings' }), false)
  assert.equal(shouldFocusOmniboxOnActivate({ url: 'orbit://history' }), false)
  assert.equal(shouldFocusOmniboxOnActivate({ url: 'orbit://bookmarks' }), false)
  assert.equal(shouldFocusOmniboxOnActivate({ url: 'https://example.com' }), false)
  assert.equal(shouldFocusOmniboxOnActivate({ url: '', error: { code: -105 } }), false)
})

test('resolveOmniboxSync updates text and exits editing when switching tabs, including to internal pages', () => {
  // Switching from a web tab to orbit://settings while editing was active must reset editing and show orbit://settings
  assert.deepEqual(
    resolveOmniboxSync({ prevTabId: 1, nextTabId: 2, url: 'orbit://settings', editing: true }),
    { resetEditing: true, nextText: 'orbit://settings' }
  )
  // Switching to orbit://history while not editing shows orbit://history
  assert.deepEqual(
    resolveOmniboxSync({ prevTabId: 1, nextTabId: 3, url: 'orbit://history', editing: false }),
    { resetEditing: true, nextText: 'orbit://history' }
  )
  // Same-tab URL update while actively typing must not overwrite user input
  assert.deepEqual(
    resolveOmniboxSync({ prevTabId: 1, nextTabId: 1, url: 'https://example.com/redirect', editing: true }),
    { resetEditing: false, nextText: null }
  )
  // Same-tab URL update while not editing updates displayed URL
  assert.deepEqual(
    resolveOmniboxSync({ prevTabId: 1, nextTabId: 1, url: 'https://www.example.com/', editing: false }),
    { resetEditing: false, nextText: 'example.com' }
  )
})
