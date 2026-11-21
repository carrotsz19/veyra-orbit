import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SPLIT_RATIO,
  MAX_SPLIT_PANES,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  SPLIT_GAP,
  SPLIT_RING_INSET,
  clampSplitRatio,
  computeSplitLayout,
  dissolveSplitGroup,
  joinSplitGroup,
  keepSplitGroupsContiguous,
  ratioFromPointer,
  removeTabFromSplit,
  updateSplitGroupRatio,
  type SplitGroup
} from '../src/shared/split.ts'

test('computeSplitLayout produces single full-bleed pane with no dividers', () => {
  const box = { x: 256, y: 40, width: 1000, height: 800 }
  const layout = computeSplitLayout(box, 1)
  assert.equal(layout.panes.length, 1)
  assert.equal(layout.dividers.length, 0)
  assert.deepEqual(layout.panes[0].frame, box)
  assert.deepEqual(layout.panes[0].view, box)
})

test('computeSplitLayout places 2 panes side by side with gap, divider, and focus-ring inset', () => {
  const box = { x: 200, y: 40, width: 1008, height: 800 }
  const layout = computeSplitLayout(box, 2, { colRatio: 0.5 })
  assert.equal(layout.panes.length, 2)
  assert.equal(layout.dividers.length, 1)

  const [p0, p1] = layout.panes
  const [div] = layout.dividers
  // Usable width is 1008 - 8 = 1000 -> 500 + 500
  assert.deepEqual(p0.frame, { x: 200, y: 40, width: 500, height: 800 })
  assert.deepEqual(p1.frame, { x: 708, y: 40, width: 500, height: 800 })
  // Divider sits cleanly in the gap between panes, never overlapping either pane
  assert.equal(div.orientation, 'vertical')
  assert.deepEqual(div.rect, { x: 700, y: 40, width: SPLIT_GAP, height: 800 })
  assert.equal(div.rect.x, p0.frame.x + p0.frame.width)
  assert.equal(div.rect.x + div.rect.width, p1.frame.x)
  // WebContentsView rects are inset by SPLIT_RING_INSET so the focus ring stays visible
  assert.deepEqual(p0.view, {
    x: 200 + SPLIT_RING_INSET,
    y: 40 + SPLIT_RING_INSET,
    width: 500 - SPLIT_RING_INSET * 2,
    height: 800 - SPLIT_RING_INSET * 2
  })
  assert.deepEqual(p1.view, {
    x: 708 + SPLIT_RING_INSET,
    y: 40 + SPLIT_RING_INSET,
    width: 500 - SPLIT_RING_INSET * 2,
    height: 800 - SPLIT_RING_INSET * 2
  })
})

test('computeSplitLayout supports 3-pane and 4-pane 2x2 grids with non-overlapping dividers', () => {
  const box = { x: 0, y: 0, width: 1008, height: 608 }

  const three = computeSplitLayout(box, 3, { colRatio: 0.4, rowRatio: 0.5 })
  assert.equal(three.panes.length, 3)
  assert.equal(three.dividers.length, 2)
  assert.deepEqual(three.panes[0].frame, { x: 0, y: 0, width: 400, height: 608 })
  assert.deepEqual(three.panes[1].frame, { x: 408, y: 0, width: 600, height: 300 })
  assert.deepEqual(three.panes[2].frame, { x: 408, y: 308, width: 600, height: 300 })
  // Horizontal divider only spans the right column in 3-pane layout
  assert.deepEqual(three.dividers[1].rect, { x: 408, y: 300, width: 600, height: SPLIT_GAP })

  const four = computeSplitLayout(box, 4, { colRatio: 0.5, rowRatio: 0.5 })
  assert.equal(four.panes.length, 4)
  assert.equal(four.dividers.length, 2)
  assert.deepEqual(four.panes[0].frame, { x: 0, y: 0, width: 500, height: 300 })
  assert.deepEqual(four.panes[1].frame, { x: 508, y: 0, width: 500, height: 300 })
  assert.deepEqual(four.panes[2].frame, { x: 0, y: 308, width: 500, height: 300 })
  assert.deepEqual(four.panes[3].frame, { x: 508, y: 308, width: 500, height: 300 })
  assert.deepEqual(four.dividers[1].rect, { x: 0, y: 300, width: 1008, height: SPLIT_GAP })
})

test('clampSplitRatio and ratioFromPointer enforce min/max bounds safely', () => {
  assert.equal(clampSplitRatio(NaN), DEFAULT_SPLIT_RATIO)
  assert.equal(clampSplitRatio(0.01), MIN_SPLIT_RATIO)
  assert.equal(clampSplitRatio(0.99), MAX_SPLIT_RATIO)
  assert.equal(clampSplitRatio(0.35), 0.35)

  assert.equal(ratioFromPointer(504, 0, 1008, 8), 0.5)
  assert.equal(ratioFromPointer(20, 0, 1008, 8), MIN_SPLIT_RATIO)
  assert.equal(ratioFromPointer(990, 0, 1008, 8), MAX_SPLIT_RATIO)
})

test('joinSplitGroup, removeTabFromSplit, dissolveSplitGroup, and updateSplitGroupRatio maintain invariants', () => {
  const r1 = joinSplitGroup([], 1, 2, 'right', () => 'g1')
  assert.equal(r1.groups.length, 1)
  assert.deepEqual(r1.group?.tabIds, [1, 2])

  // Joining with placement=left puts the new tab first
  const r2 = joinSplitGroup([], 1, 2, 'left', () => 'g1')
  assert.deepEqual(r2.group?.tabIds, [2, 1])

  // Adding up to MAX_SPLIT_PANES succeeds; a 5th tab is refused
  const r3 = joinSplitGroup(r1.groups, 1, 3, 'right')
  const r4 = joinSplitGroup(r3.groups, 1, 4, 'right')
  assert.deepEqual(r4.group?.tabIds, [1, 2, 3, 4])
  assert.equal(r4.group?.tabIds.length, MAX_SPLIT_PANES)
  const r5 = joinSplitGroup(r4.groups, 1, 5, 'right')
  assert.deepEqual(r5.group?.tabIds, [1, 2, 3, 4])

  // Updating ratios clamps cleanly
  const resized = updateSplitGroupRatio(r4.groups, 'g1', 'col', 0.65)
  assert.equal(resized[0].colRatio, 0.65)
  assert.equal(resized[0].rowRatio, DEFAULT_SPLIT_RATIO)

  // Removing a tab shrinks the group; dissolving when <2 remain
  const afterRemove3 = removeTabFromSplit(removeTabFromSplit(resized, 4), 3)
  assert.deepEqual(afterRemove3[0].tabIds, [1, 2])
  const afterRemove2 = removeTabFromSplit(afterRemove3, 2)
  assert.equal(afterRemove2.length, 0)

  // Dissolving removes the entire group
  assert.equal(dissolveSplitGroup(resized, 'g1').length, 0)
})

test('keepSplitGroupsContiguous groups split tabs adjacent to each other', () => {
  const tabs = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  const groups: SplitGroup[] = [{ id: 'g1', tabIds: [1, 3], colRatio: 0.5, rowRatio: 0.5 }]
  const ordered = keepSplitGroupsContiguous(tabs, (t) => t.id, groups)
  assert.deepEqual(
    ordered.map((t) => t.id),
    [1, 3, 2, 4]
  )
})
