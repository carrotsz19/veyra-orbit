import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CLOSE_CONFIRM_THRESHOLD,
  extractExternalUrlFromArgv,
  filterTabsForStartup,
  pickNextTabAfterClose,
  resolveNewTabInsertIndex,
  sanitizeCloseTabThreshold,
  shouldConfirmWindowClose
} from '../src/shared/behavior.ts'
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings } from '../src/shared/settings.ts'

test('extractExternalUrlFromArgv extracts safe http(s) URLs and rejects flags or unsafe schemes', () => {
  assert.equal(
    extractExternalUrlFromArgv(['orbit.exe', '--remote-debugging-port=9333', 'https://example.com/path?a=1']),
    'https://example.com/path?a=1'
  )
  assert.equal(
    extractExternalUrlFromArgv(['orbit.exe', 'http://localhost:3000/test']),
    'http://localhost:3000/test'
  )
  assert.equal(extractExternalUrlFromArgv(['orbit.exe', '.']), null)
  assert.equal(extractExternalUrlFromArgv(['orbit.exe', 'file:///C:/Windows/win.ini']), null)
  assert.equal(extractExternalUrlFromArgv(['orbit.exe', 'javascript:alert(1)']), null)
  assert.equal(extractExternalUrlFromArgv(['orbit.exe', 'data:text/html,hi']), null)
})

test('resolveNewTabInsertIndex honours end vs after-current and explicit afterId', () => {
  const tabs = [
    { id: 1, workspaceId: 'personal' },
    { id: 2, workspaceId: 'personal' },
    { id: 3, workspaceId: 'personal' }
  ]
  assert.equal(resolveNewTabInsertIndex(tabs, 'personal', 1, 'end'), 3)
  assert.equal(resolveNewTabInsertIndex(tabs, 'personal', 1, 'after-current'), 1)
  assert.equal(resolveNewTabInsertIndex(tabs, 'personal', 2, 'after-current'), 2)
  assert.equal(resolveNewTabInsertIndex(tabs, 'other', 1, 'after-current'), 3)
  // Explicit afterId wins regardless of 'end'
  assert.equal(resolveNewTabInsertIndex(tabs, 'personal', 3, 'end', 1), 1)
})

test('pickNextTabAfterClose selects right, left, last-used, or split sibling cleanly', () => {
  const remaining = [
    { id: 1, lastActiveSeq: 10 },
    { id: 2, lastActiveSeq: 50 },
    { id: 4, lastActiveSeq: 20 }
  ]
  // Closed tab was at index 2 (between id 2 and id 4)
  assert.equal(pickNextTabAfterClose(remaining, 2, 'right')?.id, 4)
  assert.equal(pickNextTabAfterClose(remaining, 2, 'left')?.id, 2)
  assert.equal(pickNextTabAfterClose(remaining, 2, 'last-used')?.id, 2)

  // Closing the last tab falls back to left even when 'right' is selected
  assert.equal(pickNextTabAfterClose(remaining, 3, 'right')?.id, 4)
  // Closing the first tab falls back to right even when 'left' is selected
  assert.equal(pickNextTabAfterClose(remaining, 0, 'left')?.id, 1)
  // Split sibling takes precedence
  assert.equal(pickNextTabAfterClose(remaining, 2, 'last-used', 4)?.id, 4)
  assert.equal(pickNextTabAfterClose([], 0, 'right'), undefined)
})

test('shouldConfirmWindowClose and sanitizeCloseTabThreshold clamp threshold and respect toggle', () => {
  assert.equal(sanitizeCloseTabThreshold(undefined), DEFAULT_CLOSE_CONFIRM_THRESHOLD)
  assert.equal(sanitizeCloseTabThreshold(1), 2)
  assert.equal(sanitizeCloseTabThreshold(999), 100)
  assert.equal(sanitizeCloseTabThreshold(7.6), 8)
  assert.equal(sanitizeCloseTabThreshold(Number.NaN), DEFAULT_CLOSE_CONFIRM_THRESHOLD)

  assert.equal(shouldConfirmWindowClose(10, false, 5), false)
  assert.equal(shouldConfirmWindowClose(4, true, 5), false)
  assert.equal(shouldConfirmWindowClose(5, true, 5), true)
  assert.equal(shouldConfirmWindowClose(12, true, 5), true)
})

test('filterTabsForStartup supports restore all, restore pinned only, and new-tab', () => {
  const saved = [
    { url: 'https://mail.example', pinned: true },
    { url: 'https://docs.example', pinned: false },
    { url: 'https://cal.example', pinned: true }
  ]
  assert.equal(filterTabsForStartup(saved, 'restore').length, 3)
  assert.deepEqual(
    filterTabsForStartup(saved, 'restore-pinned').map((t) => t.url),
    ['https://mail.example', 'https://cal.example']
  )
  assert.deepEqual(filterTabsForStartup(saved, 'new-tab'), [])
})

test('behaviour settings sanitize and merge safely in Settings', () => {
  const cleaned = sanitizeSettings({
    startup: 'restore-pinned',
    externalLinks: 'current-tab',
    newTabPosition: 'after-current',
    closeTabSelection: 'last-used',
    confirmCloseWindow: true,
    confirmCloseThreshold: 12
  })
  assert.equal(cleaned.startup, 'restore-pinned')
  assert.equal(cleaned.externalLinks, 'current-tab')
  assert.equal(cleaned.newTabPosition, 'after-current')
  assert.equal(cleaned.closeTabSelection, 'last-used')
  assert.equal(cleaned.confirmCloseWindow, true)
  assert.equal(cleaned.confirmCloseThreshold, 12)

  // Invalid values fall back to safe defaults
  const bad = sanitizeSettings({
    externalLinks: 'popup',
    newTabPosition: 'middle',
    closeTabSelection: 'random',
    confirmCloseWindow: 'yes',
    confirmCloseThreshold: -5
  })
  assert.equal(bad.externalLinks, DEFAULT_SETTINGS.externalLinks)
  assert.equal(bad.newTabPosition, DEFAULT_SETTINGS.newTabPosition)
  assert.equal(bad.closeTabSelection, DEFAULT_SETTINGS.closeTabSelection)
  assert.equal(bad.confirmCloseWindow, DEFAULT_SETTINGS.confirmCloseWindow)
  assert.equal(bad.confirmCloseThreshold, 2)

  const merged = mergeSettings(DEFAULT_SETTINGS, {
    startup: 'restore-pinned',
    closeTabSelection: 'left',
    confirmCloseWindow: true,
    confirmCloseThreshold: 8
  })
  assert.equal(merged.startup, 'restore-pinned')
  assert.equal(merged.closeTabSelection, 'left')
  assert.equal(merged.confirmCloseWindow, true)
  assert.equal(merged.confirmCloseThreshold, 8)
})
