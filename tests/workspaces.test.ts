import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WEB_PARTITION,
  PRIVATE_WORKSPACE_ICON,
  WORKSPACE_ACCENTS,
  buildSavedSession,
  createDefaultWorkspace,
  createPrivateWorkspaceEntry,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  isPrivatePartition,
  nextWorkspaceId,
  parseSavedSession,
  updateWorkspaceEntry,
  workspaceAtShortcut,
  workspacePartition
} from '../src/shared/workspaces.ts'

test('workspacePartition shares persist:web by default and isolates persist:ws-<id> when requested', () => {
  const shared = createDefaultWorkspace()
  assert.equal(workspacePartition(shared), DEFAULT_WEB_PARTITION)
  assert.equal(workspacePartition({ id: 'study', isolated: false }), DEFAULT_WEB_PARTITION)
  assert.equal(workspacePartition({ id: 'study', isolated: true }), 'persist:ws-study')
  assert.equal(workspacePartition({ id: 'bad/id..', isolated: true }), DEFAULT_WEB_PARTITION)
})

test('createWorkspaceEntry generates unique slugs, sanitizes icons/names, and defaults accents', () => {
  const initial = [createDefaultWorkspace()]
  const r1 = createWorkspaceEntry(initial, { name: '  Biology\nLab  ', icon: '🧪', accent: 'sage', isolated: true })
  assert.equal(r1.created.id, 'biology-lab')
  assert.equal(r1.created.name, 'Biology Lab')
  assert.equal(r1.created.icon, '🧪')
  assert.equal(r1.created.accent, 'sage')
  assert.equal(r1.created.isolated, true)
  assert.equal(r1.workspaces.length, 2)

  // Duplicate name gets a numbered slug; invalid icon falls back to compass
  const r2 = createWorkspaceEntry(r1.workspaces, { name: 'Biology Lab', icon: 'not-a-valid-icon-id' })
  assert.equal(r2.created.id, 'biology-lab-2')
  assert.equal(r2.created.icon, 'compass')
  assert.equal(r2.created.isolated, false)
  assert.ok(WORKSPACE_ACCENTS.some((a) => a.id === r2.created.accent))
})

test('updateWorkspaceEntry renames, recolours, re-icons, and flags isolation changes', () => {
  const base = [createDefaultWorkspace()]
  const r1 = updateWorkspaceEntry(base, 'personal', { name: 'Daily', accent: 'sky', icon: 'sparkles' })
  assert.equal(r1.isolationChanged, false)
  assert.equal(r1.updated?.name, 'Daily')
  assert.equal(r1.updated?.accent, 'sky')
  assert.equal(r1.updated?.icon, 'sparkles')

  const r2 = updateWorkspaceEntry(r1.workspaces, 'personal', { isolated: true })
  assert.equal(r2.isolationChanged, true)
  assert.equal(r2.updated?.isolated, true)

  const missing = updateWorkspaceEntry(r2.workspaces, 'nope', { name: 'X' })
  assert.equal(missing.updated, null)
  assert.equal(missing.isolationChanged, false)
})

test('deleteWorkspaceEntry deletes a workspace, updates active fallback, and refuses deleting the last one', () => {
  const ws0 = createDefaultWorkspace()
  const { workspaces: w2, created: study } = createWorkspaceEntry([ws0], { name: 'Study', accent: 'sage' })
  const { workspaces: w3, created: work } = createWorkspaceEntry(w2, { name: 'Work', accent: 'sky' })

  // Deleting active middle workspace falls back cleanly to neighbour
  const d1 = deleteWorkspaceEntry(w3, study.id, study.id)
  assert.equal(d1.deleted, true)
  assert.equal(d1.workspaces.length, 2)
  assert.equal(d1.nextActiveId, work.id)

  // Deleting inactive workspace keeps current active
  const d2 = deleteWorkspaceEntry(d1.workspaces, ws0.id, work.id)
  assert.equal(d2.deleted, true)
  assert.equal(d2.workspaces.length, 1)
  assert.equal(d2.nextActiveId, work.id)

  // Cannot delete last remaining workspace
  const d3 = deleteWorkspaceEntry(d2.workspaces, work.id, work.id)
  assert.equal(d3.deleted, false)
  assert.equal(d3.workspaces.length, 1)
  assert.equal(d3.nextActiveId, work.id)
})

test('nextWorkspaceId and workspaceAtShortcut navigate workspaces with wraparound', () => {
  const ws0 = createDefaultWorkspace()
  const { workspaces: w2, created: ws1 } = createWorkspaceEntry([ws0], { name: 'Study' })
  const { workspaces: w3, created: ws2 } = createWorkspaceEntry(w2, { name: 'Work' })

  assert.equal(nextWorkspaceId(w3, ws0.id, 1), ws1.id)
  assert.equal(nextWorkspaceId(w3, ws2.id, 1), ws0.id)
  assert.equal(nextWorkspaceId(w3, ws0.id, -1), ws2.id)
  assert.equal(nextWorkspaceId([ws0], ws0.id, 1), null)

  assert.equal(workspaceAtShortcut(w3, 1)?.id, ws0.id)
  assert.equal(workspaceAtShortcut(w3, 2)?.id, ws1.id)
  assert.equal(workspaceAtShortcut(w3, 3)?.id, ws2.id)
  assert.equal(workspaceAtShortcut(w3, 4), null)
  assert.equal(workspaceAtShortcut(w3, 0), null)
})

test('parseSavedSession migrates legacy V1 flat tab list into default Personal workspace', () => {
  const legacy = {
    tabs: [
      { url: 'https://example.com', title: 'Example', pinned: true },
      { url: 'javascript:alert(1)', title: 'Bad', pinned: false },
      { url: 'file:///etc/passwd', title: 'Bad file', pinned: false },
      { url: 'orbit://settings', title: 'Settings', pinned: false }
    ],
    active: 1
  }
  const migrated = parseSavedSession(legacy)
  assert.equal(migrated.version, 2)
  assert.equal(migrated.activeWorkspaceId, 'personal')
  assert.equal(migrated.workspaces.length, 1)
  assert.equal(migrated.workspaces[0].name, 'Personal')
  assert.equal(migrated.workspaces[0].isolated, false)
  assert.deepEqual(migrated.workspaces[0].tabs, [
    { url: 'https://example.com', title: 'Example', pinned: true },
    { url: 'orbit://settings', title: 'Settings', pinned: false }
  ])
  assert.equal(migrated.workspaces[0].active, 1)
})

test('parseSavedSession preserves valid V2 workspaces and recovers safely from corrupt data', () => {
  const v2 = {
    version: 2,
    activeWorkspaceId: 'study',
    workspaces: [
      {
        id: 'personal',
        name: 'Personal',
        icon: 'home',
        accent: 'clay',
        isolated: false,
        tabs: [{ url: 'https://news.ycombinator.com', title: 'HN', pinned: false }],
        active: 0
      },
      {
        id: 'study',
        name: 'Study',
        icon: '📚',
        accent: 'sage',
        isolated: true,
        tabs: [
          { url: 'https://wikipedia.org', title: 'Wiki', pinned: true },
          { url: 'https://khanacademy.org', title: 'Khan', pinned: false }
        ],
        active: 99
      }
    ]
  }
  const parsed = parseSavedSession(v2)
  assert.equal(parsed.activeWorkspaceId, 'study')
  assert.equal(parsed.workspaces.length, 2)
  assert.equal(parsed.workspaces[1].icon, '📚')
  assert.equal(parsed.workspaces[1].isolated, true)
  assert.equal(parsed.workspaces[1].active, 1)

  const corrupt = parseSavedSession('not-json-object')
  assert.equal(corrupt.version, 2)
  assert.equal(corrupt.workspaces.length, 1)
  assert.equal(corrupt.workspaces[0].id, 'personal')
})

test('parseSavedSession preserves valid per-workspace split groups and drops invalid or pinned ones', () => {
  const v2 = {
    version: 2,
    activeWorkspaceId: 'personal',
    workspaces: [
      {
        id: 'personal',
        name: 'Personal',
        icon: 'home',
        accent: 'clay',
        isolated: false,
        tabs: [
          { url: 'https://pinned.example', title: 'Pinned', pinned: true },
          { url: 'https://a.example', title: 'A', pinned: false },
          { url: 'https://b.example', title: 'B', pinned: false },
          { url: 'https://c.example', title: 'C', pinned: false }
        ],
        active: 1,
        splits: [
          { tabs: [1, 2], colRatio: 0.62, rowRatio: 0.5 },
          // Overlaps tab 2 and includes pinned tab 0 and out-of-range 99 -> leaves <2 valid tabs -> dropped
          { tabs: [0, 2, 99], colRatio: 0.5, rowRatio: 0.5 },
          // Out-of-bounds ratio clamps
          { tabs: [3], colRatio: 0.1, rowRatio: 0.9 }
        ]
      }
    ]
  }
  const parsed = parseSavedSession(v2)
  assert.deepEqual(parsed.workspaces[0].splits, [{ tabs: [1, 2], colRatio: 0.62, rowRatio: 0.5 }])
})

test('private workspaces use unique non-persistent partitions and are excluded from session save and restore', () => {
  const personal = createDefaultWorkspace()
  const { workspaces: w2, created: p1 } = createPrivateWorkspaceEntry([personal], 'run1')
  const { workspaces: w3, created: p2 } = createPrivateWorkspaceEntry(w2, 'run2')

  assert.equal(p1.private, true)
  assert.equal(p1.name, 'Private')
  assert.equal(p1.icon, PRIVATE_WORKSPACE_ICON)
  assert.equal(p2.name, 'Private 2')
  assert.notEqual(p1.id, p2.id)

  const part1 = workspacePartition(p1)
  const part2 = workspacePartition(p2)
  assert.equal(part1.startsWith('persist:'), false)
  assert.equal(part2.startsWith('persist:'), false)
  assert.equal(isPrivatePartition(part1), true)
  assert.equal(isPrivatePartition(part2), true)
  assert.notEqual(part1, part2)

  // Cannot delete the last non-private workspace while only private workspaces remain.
  const keepNormal = deleteWorkspaceEntry(w2, personal.id, p1.id)
  assert.equal(keepNormal.deleted, false)

  // Closing a private workspace succeeds and returns to the non-private workspace.
  const closePriv = deleteWorkspaceEntry(w2, p1.id, p1.id)
  assert.equal(closePriv.deleted, true)
  assert.equal(closePriv.nextActiveId, personal.id)
  assert.deepEqual(closePriv.workspaces.map((w) => w.id), [personal.id])

  // buildSavedSession strips all private workspaces and falls back activeWorkspaceId when private was active.
  const saved = buildSavedSession(w3, p2.id, (wsId) => ({
    tabs: [{ url: `https://${wsId}.example/`, title: wsId, pinned: false }],
    active: 0
  }))
  assert.equal(saved.activeWorkspaceId, personal.id)
  assert.deepEqual(
    saved.workspaces.map((w) => w.id),
    [personal.id]
  )
  assert.equal(
    saved.workspaces.some((w) => w.id === p1.id || w.id === p2.id),
    false
  )

  // parseSavedSession also drops any private workspace entry defensively.
  const restored = parseSavedSession({
    version: 2,
    activeWorkspaceId: p1.id,
    workspaces: [
      { ...personal, tabs: [{ url: 'https://normal.example/', title: 'Normal', pinned: false }], active: 0 },
      { ...p1, tabs: [{ url: 'https://secret.example/', title: 'Secret', pinned: false }], active: 0 }
    ]
  })
  assert.equal(restored.activeWorkspaceId, personal.id)
  assert.deepEqual(
    restored.workspaces.map((w) => w.id),
    [personal.id]
  )
})

test('saving keeps split groups for normal workspaces and still drops private ones', () => {
  const personal = createDefaultWorkspace()
  const { workspaces, created: priv } = createPrivateWorkspaceEntry([personal], 'run-split')
  const saved = buildSavedSession(workspaces, personal.id, (wsId) => ({
    tabs: [
      { url: `https://${wsId}-a.example/`, title: 'A', pinned: false },
      { url: `https://${wsId}-b.example/`, title: 'B', pinned: false }
    ],
    active: 0,
    splits: [{ tabs: [0, 1], colRatio: 0.6, rowRatio: 0.5 }]
  }))
  assert.deepEqual(saved.workspaces.map((w) => w.id), [personal.id])
  assert.equal(saved.workspaces.some((w) => w.id === priv.id), false)
  assert.deepEqual(saved.workspaces[0].splits, [{ tabs: [0, 1], colRatio: 0.6, rowRatio: 0.5 }])
  // Round trip through the loader keeps the split.
  assert.deepEqual(parseSavedSession(saved).workspaces[0].splits, [{ tabs: [0, 1], colRatio: 0.6, rowRatio: 0.5 }])
})
