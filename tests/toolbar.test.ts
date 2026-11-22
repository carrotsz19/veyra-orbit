import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TOOLBAR_ITEMS,
  TOOLBAR_BUTTON_IDS,
  addToolbarButton,
  availableToolbarButtons,
  deriveLegacyToolbarFlags,
  migrateLegacyToolbarButtons,
  moveToolbarItem,
  removeToolbarButton,
  sanitizeToolbarItems
} from '../src/shared/toolbar.ts'
import { exportAppearanceJson, mergeAppearance, parseImportedAppearanceJson, sanitizeAppearance } from '../src/shared/appearance.ts'

test('sanitizeToolbarItems removes duplicates/unknown IDs and always guarantees address-bar is present', () => {
  assert.deepEqual(sanitizeToolbarItems(null), [...DEFAULT_TOOLBAR_ITEMS])
  assert.deepEqual(sanitizeToolbarItems(['back', 'unknown', 'back', 'settings']), [
    'back',
    'address-bar',
    'settings'
  ])
  assert.deepEqual(sanitizeToolbarItems(['home', 'address-bar', 'address-bar', 'downloads']), [
    'home',
    'address-bar',
    'downloads'
  ])
})

test('migrateLegacyToolbarButtons converts old boolean flags into ordered toolbarItems', () => {
  const allOff = migrateLegacyToolbarButtons({
    showNavButtons: false,
    showBookmarkStar: false,
    showExtensions: false
  })
  assert.deepEqual(allOff, ['address-bar', 'screenshot'])
  assert.deepEqual(deriveLegacyToolbarFlags(allOff), {
    showNavButtons: false,
    showBookmarkStar: false,
    showExtensions: false
  })

  // sanitizeAppearance migrates legacy settings.json payloads lacking toolbarItems
  const migrated = sanitizeAppearance({
    showNavButtons: false,
    showBookmarkStar: true,
    showExtensions: false
  })
  assert.deepEqual(migrated.toolbarItems, ['address-bar', 'bookmark-star', 'screenshot'])
  assert.equal(migrated.showNavButtons, false)
  assert.equal(migrated.showBookmarkStar, true)
  assert.equal(migrated.showExtensions, false)
})

test('addToolbarButton, removeToolbarButton, moveToolbarItem, and availableToolbarButtons manage all 12 buttons', () => {
  let items = [...DEFAULT_TOOLBAR_ITEMS]
  const avail = availableToolbarButtons(items).map((b) => b.id)
  assert.ok(avail.includes('home'))
  assert.ok(avail.includes('downloads'))
  assert.ok(avail.includes('split'))
  assert.ok(avail.includes('sidebar-toggle'))
  assert.ok(avail.includes('workspaces'))
  assert.ok(avail.includes('settings'))
  assert.equal(avail.length + items.filter((i) => i !== 'address-bar').length, TOOLBAR_BUTTON_IDS.length)

  items = addToolbarButton(items, 'home')
  assert.ok(items.indexOf('home') < items.indexOf('address-bar'))

  items = addToolbarButton(items, 'settings')
  assert.ok(items.indexOf('settings') > items.indexOf('address-bar'))

  items = moveToolbarItem(items, 'settings', 0)
  assert.equal(items[0], 'settings')

  items = removeToolbarButton(items, 'back')
  assert.equal(items.includes('back'), false)
  assert.equal(items.includes('address-bar'), true)
})

test('toolbarItems merges cleanly and round-trips through theme export/import', () => {
  const custom = mergeAppearance(sanitizeAppearance(null), {
    toolbarItems: ['sidebar-toggle', 'back', 'forward', 'address-bar', 'downloads', 'settings']
  })
  assert.deepEqual(custom.toolbarItems, ['sidebar-toggle', 'back', 'forward', 'address-bar', 'downloads', 'settings'])
  assert.equal(custom.showNavButtons, true)
  assert.equal(custom.showBookmarkStar, false)
  assert.equal(custom.showExtensions, false)

  const exported = exportAppearanceJson('light', custom)
  const imported = parseImportedAppearanceJson(exported)
  assert.equal(imported.ok, true)
  if (imported.ok) {
    assert.deepEqual(imported.appearance.toolbarItems, custom.toolbarItems)
  }
})
