import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampZoomLevel, zoomPercent } from '../src/shared/format.ts'

test('zoom levels map to rounded percentages', () => {
  assert.equal(zoomPercent(0), 100)
  assert.equal(zoomPercent(0.5), 110)
  assert.equal(zoomPercent(1), 120)
  assert.equal(zoomPercent(-0.5), 91)
  assert.equal(zoomPercent(-1), 83)
})

test('zoom levels clamp to Chromium bounds', () => {
  assert.equal(clampZoomLevel(0), 0)
  assert.equal(clampZoomLevel(-20), -7.5)
  assert.equal(clampZoomLevel(20), 8.5)
})
