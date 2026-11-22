import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SHORTCUT_REGISTRY,
  acceleratorFromKeyEvent,
  findShortcutConflict,
  formatShortcutLabel,
  matchShortcut,
  mergeShortcutOverrides,
  resolveShortcuts,
  sanitizeShortcutOverrides,
  toElectronAccelerator,
  validateAccelerator
} from '../src/shared/shortcuts.ts'
import { buildMenus } from '../src/shared/menu.ts'

test('every registry shortcut has a valid, unique default accelerator', () => {
  const seen = new Set<string>()
  for (const def of SHORTCUT_REGISTRY) {
    const res = validateAccelerator(def.defaultAccelerator)
    assert.equal(res.ok, true, `Default shortcut ${def.id} (${def.defaultAccelerator}) must be valid: ${res.reason}`)
    assert.equal(res.accelerator, def.defaultAccelerator)
    assert.equal(seen.has(def.defaultAccelerator), false, `Duplicate default accelerator: ${def.defaultAccelerator}`)
    seen.add(def.defaultAccelerator)
  }
})

test('validateAccelerator rejects bare keys, Shift+letter, and reserved OS/editing shortcuts', () => {
  assert.equal(validateAccelerator('a').ok, false)
  assert.equal(validateAccelerator('K').ok, false)
  assert.equal(validateAccelerator('Shift+A').ok, false)
  assert.equal(validateAccelerator('Shift+2').ok, false)
  assert.equal(validateAccelerator('Escape').ok, false)
  assert.equal(validateAccelerator('Space').ok, false)
  assert.equal(validateAccelerator('Alt+F4').ok, false)
  assert.equal(validateAccelerator('Ctrl+Alt+Delete').ok, false)
  assert.equal(validateAccelerator('Ctrl+C').ok, false)
  assert.equal(validateAccelerator('Ctrl+V').ok, false)
  assert.equal(validateAccelerator('Ctrl+1').ok, false)
  assert.equal(validateAccelerator('Ctrl+Alt+3').ok, false)

  // Valid combinations normalize cleanly
  assert.deepEqual(validateAccelerator('ctrl+shift+s'), { ok: true, accelerator: 'Ctrl+Shift+S' })
  assert.deepEqual(validateAccelerator('alt+arrowleft'), { ok: true, accelerator: 'Alt+Left' })
  assert.deepEqual(validateAccelerator('f11'), { ok: true, accelerator: 'F11' })
  assert.deepEqual(validateAccelerator('shift+f3'), { ok: true, accelerator: 'Shift+F3' })
  assert.deepEqual(validateAccelerator('Ctrl+Shift+2'), { ok: true, accelerator: 'Ctrl+Shift+2' })
})

test('acceleratorFromKeyEvent uses physical key codes so Shift+2 and Shift+Backslash normalize reliably', () => {
  assert.equal(
    acceleratorFromKeyEvent({ key: '@', code: 'Digit2', control: true, shift: true, alt: false }),
    'Ctrl+Shift+2'
  )
  assert.equal(
    acceleratorFromKeyEvent({ key: '|', code: 'Backslash', control: true, shift: true, alt: false }),
    'Ctrl+Shift+\\'
  )
  assert.equal(
    acceleratorFromKeyEvent({ key: 'Control', code: 'ControlLeft', control: true }),
    null
  )
})

test('sanitizeShortcutOverrides and mergeShortcutOverrides drop invalid entries and persist overrides + disabled', () => {
  const cleaned = sanitizeShortcutOverrides({
    'new-tab': 'ctrl+shift+e',
    'close-tab': '',
    'reload': 'Ctrl+R', // same as default -> dropped
    'find': 'Alt+F4', // forbidden -> dropped
    'history': 'h', // bare letter -> dropped
    'nonexistent': 'Ctrl+M' // unknown id -> dropped
  })
  assert.deepEqual(cleaned, {
    'new-tab': 'Ctrl+Shift+E',
    'close-tab': ''
  })

  const merged = mergeShortcutOverrides(cleaned, {
    'new-tab': null, // reset to default
    'downloads': 'Ctrl+Shift+J'
  })
  assert.deepEqual(merged, {
    'close-tab': '',
    'downloads': 'Ctrl+Shift+J'
  })
})

test('findShortcutConflict detects clashes against defaults and custom overrides, ignoring disabled ones', () => {
  const clash = findShortcutConflict({}, 'new-tab', 'Ctrl+W')
  assert.equal(clash?.id, 'close-tab')

  // If close-tab is disabled, Ctrl+W is free.
  assert.equal(findShortcutConflict({ 'close-tab': '' }, 'new-tab', 'Ctrl+W'), null)

  // Rebinding self to its own current key is not a conflict.
  assert.equal(findShortcutConflict({}, 'new-tab', 'Ctrl+T'), null)
})

test('matchShortcut respects rebound and disabled shortcuts and updates menu labels', () => {
  const overrides = { 'new-tab': 'Ctrl+Shift+E', 'close-tab': '' }
  const resolved = resolveShortcuts(overrides)

  // Old Ctrl+T no longer matches new-tab; Ctrl+Shift+E does
  assert.equal(matchShortcut({ key: 't', code: 'KeyT', control: true }, resolved), null)
  assert.equal(matchShortcut({ key: 'E', code: 'KeyE', control: true, shift: true }, resolved), 'new-tab')
  // Disabled close-tab does not match Ctrl+W
  assert.equal(matchShortcut({ key: 'w', code: 'KeyW', control: true }, resolved), null)

  // Menu items display updated accelerators and omit disabled ones
  const menus = buildMenus({
    activeTab: { id: 1, url: 'https://example.com', canGoBack: false, canGoForward: false, zoom: 100, bookmarked: false, hasError: false },
    workspaces: [{ id: 'personal', name: 'Personal' }],
    activeWorkspaceId: 'personal',
    compactMode: false,
    isFullscreen: false,
    canReopenClosed: false,
    history: [],
    bookmarks: [],
    appVersion: '26.11.8',
    isDev: false,
    shortcuts: overrides
  })
  const file = menus.find((m) => m.id === 'file')!.items
  const newTabItem = file.find((i) => i.kind === 'item' && i.id === 'file:new-tab')
  const closeTabItem = file.find((i) => i.kind === 'item' && i.id === 'file:close-tab')
  assert.equal(newTabItem?.kind === 'item' ? newTabItem.keys : undefined, 'Ctrl+Shift+E')
  assert.equal(closeTabItem?.kind === 'item' ? closeTabItem.keys : undefined, undefined)

  assert.equal(formatShortcutLabel('Ctrl+-'), 'Ctrl+−')
  assert.equal(toElectronAccelerator('Ctrl+Shift+T'), 'CmdOrCtrl+Shift+T')
})
