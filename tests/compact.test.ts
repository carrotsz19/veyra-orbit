import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeCompactWindowDrag,
  computeCompactZones,
  computeEdgeSnap,
  computeRestoreDragBounds,
  pickActiveSection,
  shouldRestoreParentFocusOnCompactHide
} from '../src/shared/compact.ts'

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

test('computeCompactZones supports right-aligned sidebar trigger and keep-open zones', () => {
  const closed = computeCompactZones({
    rx: 1196,
    ry: 300,
    contentWidth: 1200,
    contentHeight: 800,
    sidebarOpen: false,
    toolbarOpen: false,
    sidebarSide: 'right',
    sidebarWidth: 280
  })
  assert.equal(closed.wantSidebar, true)

  const leftEdgeIgnored = computeCompactZones({
    rx: 4,
    ry: 300,
    contentWidth: 1200,
    contentHeight: 800,
    sidebarOpen: false,
    toolbarOpen: false,
    sidebarSide: 'right',
    sidebarWidth: 280
  })
  assert.equal(leftEdgeIgnored.wantSidebar, false)

  const openKeep = computeCompactZones({
    rx: 930,
    ry: 300,
    contentWidth: 1200,
    contentHeight: 800,
    sidebarOpen: true,
    toolbarOpen: false,
    sidebarSide: 'right',
    sidebarWidth: 280
  })
  assert.equal(openKeep.wantSidebar, true)
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

test('computeCompactWindowDrag moves window by screen delta while preserving exact size', () => {
  const start = { x: 100, y: 80, width: 1280, height: 820 }
  assert.deepEqual(
    computeCompactWindowDrag(start, { x: 400, y: 100 }, { x: 560, y: 145 }),
    { x: 260, y: 125, width: 1280, height: 820 }
  )
  assert.deepEqual(
    computeCompactWindowDrag(start, { x: 400, y: 100 }, { x: 250, y: 50 }),
    { x: -50, y: 30, width: 1280, height: 820 }
  )
})

test('computeRestoreDragBounds centers restored window proportionally under cursor', () => {
  const maxBounds = { x: 0, y: 0, width: 1920, height: 1040 }
  const restored = computeRestoreDragBounds(maxBounds, { width: 1200, height: 800 }, { x: 960, y: 24 }, 20)
  assert.deepEqual(restored, { x: 360, y: 4, width: 1200, height: 800 })
})

test('computeEdgeSnap detects top maximize and left/right half-screen snaps', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 }
  assert.deepEqual(computeEdgeSnap({ x: 800, y: 2 }, wa), { kind: 'maximize' })
  assert.deepEqual(computeEdgeSnap({ x: 2, y: 400 }, wa), {
    kind: 'bounds',
    bounds: { x: 0, y: 0, width: 960, height: 1040 }
  })
  assert.deepEqual(computeEdgeSnap({ x: 1918, y: 400 }, wa), {
    kind: 'bounds',
    bounds: { x: 960, y: 0, width: 960, height: 1040 }
  })
  assert.deepEqual(computeEdgeSnap({ x: 900, y: 400 }, wa), { kind: 'none' })
})

test('shouldRestoreParentFocusOnCompactHide restores parent focus only when a focused compact panel hides over a visible window', () => {
  assert.equal(
    shouldRestoreParentFocusOnCompactHide({ panelFocused: true, parentVisible: true, parentMinimized: false }),
    true
  )
  // Another app took focus (panel already blurred): do not steal focus back
  assert.equal(
    shouldRestoreParentFocusOnCompactHide({ panelFocused: false, parentVisible: true, parentMinimized: false }),
    false
  )
  // Parent hidden or minimized: do not focus
  assert.equal(
    shouldRestoreParentFocusOnCompactHide({ panelFocused: true, parentVisible: false, parentMinimized: false }),
    false
  )
  assert.equal(
    shouldRestoreParentFocusOnCompactHide({ panelFocused: true, parentVisible: true, parentMinimized: true }),
    false
  )
})
