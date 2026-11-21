import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toUrl, isAllowedUrl, displayUrl, SEARCH_URL } from '../src/shared/url.ts'

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
})
