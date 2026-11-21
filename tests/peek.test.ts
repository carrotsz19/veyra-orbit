import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PEEK_PADDING,
  PEEK_TOOLBAR_HEIGHT,
  computePeekBounds,
  computePeekViewRect,
  isPeekAction,
  shouldPeekWindowOpen
} from '../src/shared/peek.ts'

test('computePeekBounds centres preview over parent window and clamps within workArea', () => {
  const b = computePeekBounds(
    { x: 100, y: 60, width: 1200, height: 800 },
    { x: 0, y: 0, width: 1920, height: 1040 }
  )
  assert.equal(b.width, 936)
  assert.equal(b.height, 656)
  assert.equal(b.x, 100 + Math.round((1200 - 936) / 2))
  assert.equal(b.y, 60 + Math.round((800 - 656) / 2))
})

test('computePeekViewRect leaves room for toolbar and inset padding', () => {
  const r = computePeekViewRect(900, 650)
  assert.deepEqual(r, {
    x: PEEK_PADDING,
    y: PEEK_TOOLBAR_HEIGHT,
    width: 900 - PEEK_PADDING * 2,
    height: 650 - PEEK_TOOLBAR_HEIGHT - PEEK_PADDING
  })
})

test('isPeekAction validates only the fixed toolbar action IDs', () => {
  for (const a of ['back', 'reload', 'open-tab', 'open-split', 'close']) {
    assert.equal(isPeekAction(a), true)
  }
  assert.equal(isPeekAction('navigate'), false)
  assert.equal(isPeekAction('https://evil.test'), false)
  assert.equal(isPeekAction(null), false)
})

test('shouldPeekWindowOpen intercepts Shift+click links without breaking sign-in popups with features', () => {
  // Shift+click on <a href> has disposition new-window and empty features -> peek
  assert.equal(shouldPeekWindowOpen('new-window', '', true), true)
  assert.equal(shouldPeekWindowOpen('new-window', '', false), true)
  // Real sign-in popup window.open(url, name, "width=500,height=600") has non-empty features -> NOT peek
  assert.equal(shouldPeekWindowOpen('new-window', 'width=500,height=600', false), false)
  assert.equal(shouldPeekWindowOpen('new-window', 'width=500,height=600', true), false)
  // Regular foreground/background tabs stay tabs
  assert.equal(shouldPeekWindowOpen('foreground-tab', '', false), false)
  assert.equal(shouldPeekWindowOpen('background-tab', '', false), false)
})
