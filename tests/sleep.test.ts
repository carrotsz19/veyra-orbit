import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canSleepTab, resolveSleepTimeoutMs, type SleepCandidate, type SleepPolicy } from '../src/shared/sleep.ts'

const NOW = 1_000_000_000
const MIN = 60_000

function baseTab(overrides: Partial<SleepCandidate> = {}): SleepCandidate {
  return {
    isActive: false,
    sleeping: false,
    hasLoadedWebView: true,
    url: 'https://example.com',
    hasError: false,
    audible: false,
    pinned: false,
    hasPendingPermission: false,
    hasActiveFind: false,
    isFullscreen: false,
    lastActiveAt: NOW - 45 * MIN,
    ...overrides
  }
}

const DEFAULT_POLICY: SleepPolicy = { timeoutMs: 30 * MIN, sleepPinnedTabs: false }

test('canSleepTab sleeps idle background web tabs past the timeout', () => {
  assert.equal(canSleepTab(baseTab(), DEFAULT_POLICY, NOW), true)
  // Exactly at boundary
  assert.equal(canSleepTab(baseTab({ lastActiveAt: NOW - 30 * MIN }), DEFAULT_POLICY, NOW), true)
  // Not idle long enough yet
  assert.equal(canSleepTab(baseTab({ lastActiveAt: NOW - 29 * MIN }), DEFAULT_POLICY, NOW), false)
  // Auto-sleep disabled (Off = 0)
  assert.equal(canSleepTab(baseTab(), { timeoutMs: 0, sleepPinnedTabs: true }, NOW), false)
})

test('canSleepTab protects active, audible, permission, find, fullscreen, internal, error, and already-sleeping tabs', () => {
  assert.equal(canSleepTab(baseTab({ isActive: true }), DEFAULT_POLICY, NOW), false)
  assert.equal(canSleepTab(baseTab({ audible: true }), DEFAULT_POLICY, NOW), false)
  assert.equal(canSleepTab(baseTab({ hasPendingPermission: true }), DEFAULT_POLICY, NOW), false)
  assert.equal(canSleepTab(baseTab({ hasActiveFind: true }), DEFAULT_POLICY, NOW), false)
  assert.equal(canSleepTab(baseTab({ isFullscreen: true }), DEFAULT_POLICY, NOW), false)
  assert.equal(canSleepTab(baseTab({ sleeping: true }), DEFAULT_POLICY, NOW), false)
  assert.equal(canSleepTab(baseTab({ hasLoadedWebView: false }), DEFAULT_POLICY, NOW), false)
  assert.equal(canSleepTab(baseTab({ url: '' }), DEFAULT_POLICY, NOW), false)
  assert.equal(canSleepTab(baseTab({ url: 'orbit://settings' }), DEFAULT_POLICY, NOW), false)
  assert.equal(canSleepTab(baseTab({ hasError: true }), DEFAULT_POLICY, NOW), false)
})

test('canSleepTab respects sleepPinnedTabs option for automatic sleep', () => {
  const pinned = baseTab({ pinned: true })
  assert.equal(canSleepTab(pinned, { timeoutMs: 30 * MIN, sleepPinnedTabs: false }, NOW), false)
  assert.equal(canSleepTab(pinned, { timeoutMs: 30 * MIN, sleepPinnedTabs: true }, NOW), true)
})

test('manual sleep bypasses idle timer and pinned policy but still protects active, audio, permission, find and fullscreen', () => {
  const recent = baseTab({ lastActiveAt: NOW - 1000, pinned: true })
  assert.equal(canSleepTab(recent, { timeoutMs: 0, sleepPinnedTabs: false }, NOW, true), true)
  assert.equal(canSleepTab(baseTab({ isActive: true }), DEFAULT_POLICY, NOW, true), false)
  assert.equal(canSleepTab(baseTab({ audible: true }), DEFAULT_POLICY, NOW, true), false)
  assert.equal(canSleepTab(baseTab({ hasPendingPermission: true }), DEFAULT_POLICY, NOW, true), false)
  assert.equal(canSleepTab(baseTab({ hasActiveFind: true }), DEFAULT_POLICY, NOW, true), false)
  assert.equal(canSleepTab(baseTab({ isFullscreen: true }), DEFAULT_POLICY, NOW, true), false)
})

test('resolveSleepTimeoutMs honours VEYRA_SLEEP_TEST_MINUTES only when unpackaged', () => {
  assert.equal(resolveSleepTimeoutMs(30, undefined, false), 30 * MIN)
  assert.equal(resolveSleepTimeoutMs(0, undefined, false), 0)
  assert.equal(resolveSleepTimeoutMs(30, '0.05', false), 3000)
  assert.equal(resolveSleepTimeoutMs(30, '0.05', true), 30 * MIN)
  assert.equal(resolveSleepTimeoutMs(30, 'not-a-number', false), 30 * MIN)
})
