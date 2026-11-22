import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMemorySnapshot } from '../src/shared/memory.ts'

test('computeMemorySnapshot splits shared tab PIDs, attributes extensions and UI without double-counting', () => {
  const metrics = [
    { pid: 100, workingSetKB: 102_400 }, // Browser main (100 MB)
    { pid: 101, workingSetKB: 51_200 }, // GPU (50 MB)
    { pid: 102, workingSetKB: 61_440 }, // Orbit UI renderer (60 MB)
    { pid: 200, workingSetKB: 81_920 }, // Shared renderer for two tabs (80 MB -> 40 MB each)
    { pid: 201, workingSetKB: 122_880 }, // Dedicated renderer for one tab (120 MB)
    { pid: 300, workingSetKB: 30_720 } // Extension service worker (30 MB)
  ]
  const tabs = [
    { id: 1, title: 'Docs A', pid: 200, sleeping: false, canSleep: true },
    { id: 2, title: 'Docs B', pid: 200, sleeping: false, canSleep: true },
    { id: 3, title: 'Heavy Page', pid: 201, sleeping: false, canSleep: false },
    { id: 4, title: 'Sleeping Tab', pid: null, sleeping: true, canSleep: false },
    { id: 5, title: 'New tab', pid: null, sleeping: false, canSleep: false }
  ]

  const snap = computeMemorySnapshot(metrics, tabs, [300], 1)
  assert.equal(snap.totalMB, 440)
  assert.equal(snap.uiMB, 210)
  assert.equal(snap.extensionsMB, 30)
  assert.equal(snap.extensionCount, 1)

  // Sorted: Heavy Page (120), Docs A (40), Docs B (40), New tab (null), Sleeping Tab (sleeping)
  assert.deepEqual(
    snap.tabs.map((t) => ({ id: t.id, memoryMB: t.memoryMB, sleeping: t.sleeping })),
    [
      { id: 3, memoryMB: 120, sleeping: false },
      { id: 1, memoryMB: 40, sleeping: false },
      { id: 2, memoryMB: 40, sleeping: false },
      { id: 5, memoryMB: null, sleeping: false },
      { id: 4, memoryMB: null, sleeping: true }
    ]
  )
  // Ensure no raw PIDs leak onto the snapshot shape
  for (const t of snap.tabs) {
    assert.equal('pid' in t, false)
  }
})

test('computeMemorySnapshot prefers privateKB, falls back to workingSetKB, and avoids double-counting shared tab/ext PIDs', () => {
  const snap = computeMemorySnapshot(
    [
      { pid: 10, workingSetKB: 0, privateKB: 20_480 }, // 20 MB UI
      { pid: 20, workingSetKB: 40_960 } // 40 MB tab
    ],
    [{ id: 1, title: 'Extension Options', pid: 20, sleeping: false, canSleep: false }],
    [20, 20], // duplicate PID that is also a tab
    1
  )
  assert.equal(snap.totalMB, 60)
  assert.equal(snap.uiMB, 20)
  assert.equal(snap.extensionsMB, 0)
  assert.equal(snap.tabs[0].memoryMB, 40)
})

test('computeMemorySnapshot uses privateKB over a larger workingSetKB', () => {
  const snap = computeMemorySnapshot([{ pid: 10, workingSetKB: 102_400, privateKB: 30_720 }], [], [], 0)
  assert.equal(snap.totalMB, 30)
})
