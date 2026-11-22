import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_FULLPAGE_CSS_HEIGHT,
  MAX_FULLPAGE_PIXELS,
  buildScreenshotFilename,
  computeChooserBounds,
  computeFullPageClip,
  computeToastBounds,
  isScreenshotMode,
  sanitizeAreaRect,
  scaleCropRect,
  screenshotSiteLabel
} from '../src/shared/screenshot.ts'

test('computeFullPageClip preserves full height within limits and caps tall / high-DPR pages', () => {
  const normal = computeFullPageClip(1280, 4200, 1.5)
  assert.equal(normal.width, 1280)
  assert.equal(normal.height, 4200)
  assert.equal(normal.truncated, false)
  assert.equal(normal.expectedPixelWidth, 1920)
  assert.equal(normal.expectedPixelHeight, 6300)

  // Exceeds 16384 CSS px limit
  const tall = computeFullPageClip(1000, 25_000, 1)
  assert.equal(tall.height, MAX_FULLPAGE_CSS_HEIGHT)
  assert.equal(tall.truncated, true)

  // Very wide at 3x DPR hits 120 MP pixel budget before 16384 CSS px
  const huge = computeFullPageClip(3000, 16_000, 3)
  assert.equal(huge.truncated, true)
  assert.ok(huge.expectedPixelWidth * huge.expectedPixelHeight <= MAX_FULLPAGE_PIXELS + huge.expectedPixelWidth * 3)
  assert.ok(huge.height < 16_000)
})

test('buildScreenshotFilename creates Windows-safe "Screenshot <site> <date time>.png" names', () => {
  const when = new Date(2026, 10, 23, 9, 5, 7)
  assert.equal(
    buildScreenshotFilename('https://en.wikipedia.org/wiki/Electron', 'Electron - Wikipedia', when),
    'Screenshot en.wikipedia.org 2026-11-23 09-05-07.png'
  )
  assert.equal(
    buildScreenshotFilename('https://www.github.com/org/repo', 'GitHub', when),
    'Screenshot github.com 2026-11-23 09-05-07.png'
  )
  assert.equal(
    buildScreenshotFilename('orbit://settings', 'Settings', when),
    'Screenshot orbit-settings 2026-11-23 09-05-07.png'
  )
  assert.equal(
    buildScreenshotFilename('', '', when),
    'Screenshot Start page 2026-11-23 09-05-07.png'
  )
  // Strips forbidden Windows filename chars
  assert.equal(screenshotSiteLabel('', 'Docs: <A/B>?*|"'), 'Docs- -A-B-----')
})

test('sanitizeAreaRect validates, normalizes, clamps, and rejects tiny/bad rects', () => {
  assert.deepEqual(sanitizeAreaRect({ x: 10, y: 20, width: 100, height: 80 }, 1000, 800), {
    x: 10,
    y: 20,
    width: 100,
    height: 80
  })
  // Negative drag direction normalizes cleanly
  assert.deepEqual(sanitizeAreaRect({ x: 150, y: 120, width: -50, height: -40 }, 1000, 800), {
    x: 100,
    y: 80,
    width: 50,
    height: 40
  })
  // Out-of-bounds rect clamps to page bounds
  assert.deepEqual(sanitizeAreaRect({ x: -20, y: 750, width: 200, height: 100 }, 1000, 800), {
    x: 0,
    y: 750,
    width: 180,
    height: 50
  })
  // Too small or invalid rejected
  assert.equal(sanitizeAreaRect({ x: 10, y: 10, width: 2, height: 2 }, 1000, 800), null)
  assert.equal(sanitizeAreaRect({ x: Number.NaN, y: 0, width: 50, height: 50 }, 1000, 800), null)
  assert.equal(sanitizeAreaRect(null, 1000, 800), null)
})

test('scaleCropRect maps CSS selection accurately to native DPR bitmap pixels', () => {
  assert.deepEqual(scaleCropRect({ x: 100, y: 50, width: 200, height: 100 }, 1000, 600, 1500, 900), {
    x: 150,
    y: 75,
    width: 300,
    height: 150
  })
  assert.equal(isScreenshotMode('visible'), true)
  assert.equal(isScreenshotMode('full'), true)
  assert.equal(isScreenshotMode('area'), true)
  assert.equal(isScreenshotMode('video'), false)
})

test('computeChooserBounds and computeToastBounds clamp cleanly inside display workArea', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
  const winBounds = { x: 100, y: 80, width: 1280, height: 820 }

  const chooser = computeChooserBounds({ x: 1900, y: 120 }, winBounds, workArea, 240, 176)
  assert.ok(chooser.x + chooser.width <= workArea.width)
  assert.ok(chooser.y >= workArea.y)

  const toast = computeToastBounds(winBounds, workArea, 328, 200)
  assert.ok(toast.x + toast.width <= workArea.width)
  assert.ok(toast.y + toast.height <= workArea.height)
})
