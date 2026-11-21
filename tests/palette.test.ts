import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPaletteResults,
  computePaletteBounds,
  resolveTypedPaletteText,
  validatePalettePick,
  type PaletteContext
} from '../src/shared/palette.ts'
import { scoreCommand } from '../src/shared/suggest.ts'

const NOW = Date.UTC(2026, 10, 21)

function baseCtx(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    mode: 'command',
    tabs: [
      {
        id: 1,
        workspaceId: 'personal',
        workspaceName: 'Personal',
        url: 'https://example.com/start',
        title: 'Example Home',
        bookmarked: false,
        pinned: false,
        muted: false,
        active: true
      },
      {
        id: 2,
        workspaceId: 'study',
        workspaceName: 'Biology',
        url: 'https://en.wikipedia.org/wiki/Mitosis',
        title: 'Mitosis - Wikipedia',
        bookmarked: true,
        pinned: false,
        muted: false,
        active: false
      }
    ],
    candidates: [
      {
        url: 'https://khanacademy.org/science/biology',
        title: 'Biology | Khan Academy',
        visits: 12,
        typed: 3,
        last: NOW - 3600_000,
        bookmarked: true
      },
      {
        url: 'https://docs.python.org/3/',
        title: 'Python Documentation',
        visits: 4,
        typed: 1,
        last: NOW - 86_400_000,
        bookmarked: false
      }
    ],
    workspaces: [
      { id: 'personal', name: 'Personal', active: true },
      { id: 'study', name: 'Biology', active: false }
    ],
    activeTab: {
      id: 1,
      url: 'https://example.com/start',
      hasError: false,
      pinned: false,
      muted: false,
      bookmarked: false,
      zoom: 100
    },
    isSplit: false,
    compactMode: false,
    isFullscreen: false,
    canReopenClosed: true,
    theme: 'system',
    now: NOW,
    ...overrides
  }
}

test('scoreCommand ranks exact and prefix matches higher than keyword-only matches', () => {
  const exact = scoreCommand('New tab', 'create open', 'new tab')
  const prefix = scoreCommand('New tab', 'create open', 'new')
  const keywordOnly = scoreCommand('New tab', 'create open', 'create')
  const miss = scoreCommand('New tab', 'create open', 'zebra')
  assert.ok(exact > prefix)
  assert.ok(prefix > keywordOnly)
  assert.equal(miss, 0)
})

test('buildPaletteResults ranks matching commands, open tabs across workspaces, and bookmarks', () => {
  // Strong command match ranks #1 with Search still offered
  const compact = buildPaletteResults('compact', baseCtx())
  assert.equal(compact.items[0].id, 'cmd:toggle-compact')
  assert.ok(compact.items.some((i) => i.id === 'search:web'))

  // Open tab in another workspace is found and carries workspace badge
  const mitosis = buildPaletteResults('mitosis', baseCtx())
  assert.equal(mitosis.items[0].id, 'tab:2')
  assert.equal(mitosis.items[0].badge, 'Biology')

  // Direct URL puts Go to <address> first
  const direct = buildPaletteResults('wikipedia.org', baseCtx())
  assert.equal(direct.items[0].id, 'url:direct')
  assert.deepEqual(validatePalettePick(direct.actions, 'url:direct'), {
    type: 'navigate',
    url: 'https://wikipedia.org'
  })

  // Plain search query with no strong match puts Search first
  const query = buildPaletteResults('what is cellular respiration', baseCtx())
  assert.equal(query.items[0].id, 'search:web')

  // Workspace switch command shows up when searching workspace name
  const ws = buildPaletteResults('biology', baseCtx())
  assert.ok(ws.items.some((i) => i.id === 'ws:study'))
})

test('validatePalettePick only accepts IDs present in the rendered action map', () => {
  const res = buildPaletteResults('compact', baseCtx())
  assert.deepEqual(validatePalettePick(res.actions, 'cmd:toggle-compact'), {
    type: 'command',
    cmd: 'toggle-compact'
  })
  // Spoofed/unshown IDs, raw URLs, or prototype keys are rejected
  assert.equal(validatePalettePick(res.actions, 'cmd:clear-history-day'), null)
  assert.equal(validatePalettePick(res.actions, 'javascript:alert(1)'), null)
  assert.equal(validatePalettePick(res.actions, 'file:///etc/passwd'), null)
  assert.equal(validatePalettePick(res.actions, 'toString'), null)
  assert.equal(validatePalettePick(res.actions, ''), null)
  assert.equal(validatePalettePick(res.actions, 123), null)
})

test('resolveTypedPaletteText enforces allowed URL schemes and internal Orbit pages', () => {
  assert.equal(resolveTypedPaletteText('example.com'), 'https://example.com')
  assert.equal(resolveTypedPaletteText('orbit://settings'), 'orbit://settings')
  assert.ok(resolveTypedPaletteText('hello world')?.startsWith('https://www.google.com/search?q='))
  // Dangerous schemes become a search query (never raw javascript:/file:/data:)
  const js = resolveTypedPaletteText('javascript:alert(1)')
  assert.ok(js && !js.startsWith('javascript:'))
  assert.equal(resolveTypedPaletteText('   '), null)
  assert.equal(resolveTypedPaletteText(null), null)
})

test('computePaletteBounds centres palette near top of parent and clamps to workArea', () => {
  const bounds = computePaletteBounds(
    { x: 100, y: 50, width: 1200, height: 800 },
    { x: 0, y: 0, width: 1920, height: 1040 },
    320
  )
  assert.equal(bounds.width, 620)
  assert.equal(bounds.height, 320)
  assert.equal(bounds.x, 100 + Math.round((1200 - 620) / 2))
  assert.equal(bounds.y, 50 + 72)
})
