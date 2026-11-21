import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeCompactZones, pickActiveSection } from '../src/shared/compact.ts'

test('computeCompactZones triggers sidebar at left edge and toolbar at top edge with hysteresis', () => {
  // Middle of page: nothing revealed
  assert.deepEqual(
    computeCompactZones({ rx: 400, ry: 300, contentWidth: 1200, contentHeight: 800, sidebarOpen: false, toolbarOpen: false }),
    { insideWindow: true, wantSidebar: false, wantToolbar: false }
  )

  // Left edge reveals sidebar
  assert.deepEqual(
    computeCompactZones({ rx: 4, ry: 300, contentWidth: 1200, contentHeight: 800, sidebarOpen: false, toolbarOpen: false }),
    { insideWindow: true, wantSidebar: true, wantToolbar: false }
  )

  // Top edge reveals toolbar
  assert.deepEqual(
    computeCompactZones({ rx: 400, ry: 3, contentWidth: 1200, contentHeight: 800, sidebarOpen: false, toolbarOpen: false }),
    { insideWindow: true, wantSidebar: false, wantToolbar: true }
  )

  // Once sidebar is open, stays open across full sidebar width + buffer, then releases past it
  assert.equal(
    computeCompactZones({ rx: 220, ry: 300, contentWidth: 1200, contentHeight: 800, sidebarOpen: true, toolbarOpen: false }).wantSidebar,
    true
  )
  assert.equal(
    computeCompactZones({ rx: 320, ry: 300, contentWidth: 1200, contentHeight: 800, sidebarOpen: true, toolbarOpen: false }).wantSidebar,
    false
  )

  // Outside window bounds
  assert.deepEqual(
    computeCompactZones({ rx: -5, ry: 300, contentWidth: 1200, contentHeight: 800, sidebarOpen: true, toolbarOpen: true }),
    { insideWindow: false, wantSidebar: false, wantToolbar: false }
  )
})

test('pickActiveSection picks section nearest top and picks last section when scrolled to bottom', () => {
  const sections = [
    { id: 'set-general', top: -600 },
    { id: 'set-appearance', top: -350 },
    { id: 'set-performance', top: -120 },
    { id: 'set-downloads', top: 20 },
    { id: 'set-privacy', top: 260 },
    { id: 'set-permissions', top: 520 },
    { id: 'set-updates', top: 680 }
  ]

  // Mid-scroll: Downloads is nearest the top anchor (top: 20 <= 56)
  assert.equal(pickActiveSection(sections, 620, 760, 2000, 56), 'set-downloads')

  // Scrolled all the way to bottom: must highlight last section (Updates) even though Downloads is near top
  assert.equal(pickActiveSection(sections, 1240, 760, 2000, 56), 'set-updates')

  // At very top
  const atTop = [
    { id: 'set-general', top: 72 },
    { id: 'set-appearance', top: 320 }
  ]
  assert.equal(pickActiveSection(atTop, 0, 760, 2000, 56), 'set-general')
})
