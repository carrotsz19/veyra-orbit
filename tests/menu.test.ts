import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_BOOKMARK_MENU_ITEMS,
  MAX_HISTORY_MENU_ITEMS,
  MENU_ORDER,
  buildCollapsedRootMenu,
  buildMenus,
  clampPopupBounds,
  firstSelectableIndex,
  recentHistoryItems,
  reduceMenuKey,
  shouldCollapseMenus,
  stepSelectableIndex,
  type MenuBuildContext,
  type MenuEntry,
  type MenuItemEntry
} from '../src/shared/menu.ts'

function baseCtx(overrides: Partial<MenuBuildContext> = {}): MenuBuildContext {
  return {
    activeTab: {
      id: 1,
      url: 'https://example.com/article',
      canGoBack: true,
      canGoForward: false,
      zoom: 125,
      bookmarked: false,
      hasError: false
    },
    workspaces: [
      { id: 'personal', name: 'Personal' },
      { id: 'study', name: 'Biology' }
    ],
    activeWorkspaceId: 'study',
    compactMode: true,
    isFullscreen: false,
    canReopenClosed: true,
    history: [
      { url: 'https://a.example/', title: 'Site A' },
      { url: 'https://b.example/', title: '' },
      { url: 'https://a.example/', title: 'Site A duplicate' }
    ],
    bookmarks: [
      { url: 'https://khanacademy.org/', title: 'Khan Academy' },
      { url: 'https://en.wikipedia.org/', title: '' }
    ],
    appVersion: '26.11.2',
    isDev: false,
    ...overrides
  }
}

function itemsOnly(entries: readonly MenuEntry[]): MenuItemEntry[] {
  return entries.filter((e): e is MenuItemEntry => e.kind === 'item')
}

test('buildMenus produces all seven Orbit menus with shortcuts and checked/disabled states', () => {
  const sections = buildMenus(baseCtx())
  assert.deepEqual(
    sections.map((s) => s.id),
    [...MENU_ORDER]
  )

  const byId = new Map(sections.map((s) => [s.id, itemsOnly(s.items)]))

  // File menu
  const file = byId.get('file')!
  assert.equal(file.find((i) => i.id === 'file:new-tab')?.keys, 'Ctrl+T')
  assert.equal(file.find((i) => i.id === 'file:reopen-closed')?.disabled, false)
  assert.equal(file.find((i) => i.id === 'file:print')?.disabled, false)
  assert.equal(file.find((i) => i.id === 'file:quit')?.keys, 'Ctrl+Q')

  // Edit menu
  const edit = byId.get('edit')!
  assert.deepEqual(
    edit.map((i) => i.id),
    ['edit:undo', 'edit:redo', 'edit:cut', 'edit:copy', 'edit:paste', 'edit:select-all', 'edit:find']
  )
  assert.equal(edit.find((i) => i.id === 'edit:find')?.disabled, false)

  // View menu
  const view = byId.get('view')!
  assert.equal(view.find((i) => i.id === 'view:palette')?.keys, 'Ctrl+K')
  assert.equal(view.find((i) => i.id === 'view:compact')?.checked, true)
  assert.equal(view.find((i) => i.id === 'view:split')?.keys, 'Ctrl+Shift+\\')
  assert.equal(view.find((i) => i.id === 'view:zoom-reset')?.disabled, false)
  assert.equal(view.find((i) => i.id === 'view:fullscreen')?.checked, false)
  assert.equal(view.find((i) => i.id === 'view:devtools')?.keys, 'F12')
  assert.equal(view.find((i) => i.id === 'view:downloads')?.keys, 'Ctrl+J')

  // History menu deduplicates recent pages and falls back to displayUrl when title is empty
  const history = byId.get('history')!
  assert.equal(history.find((i) => i.id === 'history:back')?.disabled, false)
  assert.equal(history.find((i) => i.id === 'history:forward')?.disabled, true)
  const openedHistory = history.filter((i) => i.id.startsWith('history:open:'))
  assert.deepEqual(
    openedHistory.map((i) => i.label),
    ['Site A', 'b.example']
  )

  // Bookmarks menu
  const bookmarks = byId.get('bookmarks')!
  assert.equal(bookmarks.find((i) => i.id === 'bookmarks:toggle')?.label, 'Bookmark this page')
  assert.equal(bookmarks.find((i) => i.id === 'bookmarks:toggle')?.checked, false)
  const openedBookmarks = bookmarks.filter((i) => i.id.startsWith('bookmarks:open:'))
  assert.deepEqual(
    openedBookmarks.map((i) => i.label),
    ['Khan Academy', 'en.wikipedia.org']
  )

  // Workspaces menu marks the active workspace and assigns Ctrl+Alt+1..9
  const workspaces = byId.get('workspaces')!
  assert.equal(workspaces.find((i) => i.id === 'workspaces:switch:personal')?.checked, false)
  assert.equal(workspaces.find((i) => i.id === 'workspaces:switch:personal')?.keys, 'Ctrl+Alt+1')
  assert.equal(workspaces.find((i) => i.id === 'workspaces:switch:study')?.checked, true)
  assert.equal(workspaces.find((i) => i.id === 'workspaces:switch:study')?.keys, 'Ctrl+Alt+2')
  assert.ok(workspaces.some((i) => i.id === 'workspaces:new'))

  // Help menu
  const help = byId.get('help')!
  assert.deepEqual(
    help.map((i) => i.id),
    ['help:check-updates', 'help:whats-new', 'help:report-bug', 'help:about']
  )
  assert.equal(help.find((i) => i.id === 'help:about')?.label, 'About Veyra Orbit 26.11.2')
})

test('buildMenus disables page-only commands on internal pages and caps recent history/bookmarks', () => {
  const manyHistory = Array.from({ length: 15 }, (_, i) => ({ url: `https://h${i}.example/`, title: `Page ${i}` }))
  const manyBookmarks = Array.from({ length: 20 }, (_, i) => ({ url: `https://b${i}.example/`, title: `Mark ${i}` }))
  const sections = buildMenus(
    baseCtx({
      activeTab: {
        id: 2,
        url: 'orbit://settings',
        canGoBack: false,
        canGoForward: false,
        zoom: 100,
        bookmarked: false,
        hasError: false
      },
      canReopenClosed: false,
      history: manyHistory,
      bookmarks: manyBookmarks,
      isDev: true
    })
  )
  const byId = new Map(sections.map((s) => [s.id, itemsOnly(s.items)]))
  assert.equal(byId.get('file')!.find((i) => i.id === 'file:reopen-closed')?.disabled, true)
  assert.equal(byId.get('file')!.find((i) => i.id === 'file:print')?.disabled, true)
  assert.equal(byId.get('edit')!.find((i) => i.id === 'edit:find')?.disabled, true)
  assert.equal(byId.get('view')!.find((i) => i.id === 'view:zoom-in')?.disabled, true)
  assert.equal(byId.get('view')!.find((i) => i.id === 'view:devtools')?.disabled, true)
  assert.equal(byId.get('bookmarks')!.find((i) => i.id === 'bookmarks:toggle')?.disabled, true)
  assert.equal(byId.get('history')!.filter((i) => i.id.startsWith('history:open:')).length, MAX_HISTORY_MENU_ITEMS)
  assert.equal(byId.get('bookmarks')!.filter((i) => i.id.startsWith('bookmarks:open:')).length, MAX_BOOKMARK_MENU_ITEMS)
  assert.equal(byId.get('help')!.find((i) => i.id === 'help:about')?.label, 'About Veyra Orbit Dev 26.11.2')
})

test('recentHistoryItems deduplicates and respects limit', () => {
  const list = recentHistoryItems(
    [
      { url: 'https://one.test', title: 'One' },
      { url: 'https://one.test', title: 'One again' },
      { url: 'https://two.test', title: 'Two' },
      { url: 'https://three.test', title: 'Three' }
    ],
    2
  )
  assert.deepEqual(
    list.map((x) => x.url),
    ['https://one.test', 'https://two.test']
  )
})

test('buildCollapsedRootMenu creates submenu entries for every menu section', () => {
  const sections = buildMenus(baseCtx())
  const root = itemsOnly(buildCollapsedRootMenu(sections))
  assert.equal(root.length, MENU_ORDER.length)
  assert.ok(root.every((item) => item.hasSubmenu === true))
  assert.equal(root[0].id, 'submenu:file')
})

test('keyboard navigation reducer skips separators and disabled items and wraps around', () => {
  const items: MenuEntry[] = [
    { kind: 'item', id: 'a', label: 'A' },
    { kind: 'separator' },
    { kind: 'item', id: 'b', label: 'B', disabled: true },
    { kind: 'item', id: 'c', label: 'C' }
  ]

  assert.equal(firstSelectableIndex(items), 0)
  assert.equal(stepSelectableIndex(items, -1, 1), 0)
  assert.equal(stepSelectableIndex(items, 0, 1), 3)
  assert.equal(stepSelectableIndex(items, 3, 1), 0)
  assert.equal(stepSelectableIndex(items, 0, -1), 3)
  assert.equal(stepSelectableIndex(items, -1, -1), 3)

  const down = reduceMenuKey({ items, activeIndex: 0, inSubmenu: false, isCollapsedRoot: false }, 'ArrowDown')
  assert.equal(down.activeIndex, 3)
  assert.equal(down.effect.type, 'none')

  const enter = reduceMenuKey({ items, activeIndex: 3, inSubmenu: false, isCollapsedRoot: false }, 'Enter')
  assert.deepEqual(enter.effect, { type: 'pick', id: 'c' })

  const enterDisabled = reduceMenuKey({ items, activeIndex: 2, inSubmenu: false, isCollapsedRoot: false }, 'Enter')
  assert.deepEqual(enterDisabled.effect, { type: 'none' })

  const stepRight = reduceMenuKey({ items, activeIndex: 0, inSubmenu: false, isCollapsedRoot: false }, 'ArrowRight')
  assert.deepEqual(stepRight.effect, { type: 'step-menu', delta: 1 })

  const stepLeft = reduceMenuKey({ items, activeIndex: 0, inSubmenu: false, isCollapsedRoot: false }, 'ArrowLeft')
  assert.deepEqual(stepLeft.effect, { type: 'step-menu', delta: -1 })

  const esc = reduceMenuKey({ items, activeIndex: 0, inSubmenu: false, isCollapsedRoot: false }, 'Escape')
  assert.deepEqual(esc.effect, { type: 'dismiss' })
})

test('keyboard navigation reducer handles collapsed root submenus and leaving submenu', () => {
  const rootItems = buildCollapsedRootMenu(buildMenus(baseCtx()))

  const openSub = reduceMenuKey({ items: rootItems, activeIndex: 0, inSubmenu: false, isCollapsedRoot: true }, 'ArrowRight')
  assert.deepEqual(openSub.effect, { type: 'pick', id: 'submenu:file' })

  const noStepLeftOnRoot = reduceMenuKey({ items: rootItems, activeIndex: 0, inSubmenu: false, isCollapsedRoot: true }, 'ArrowLeft')
  assert.deepEqual(noStepLeftOnRoot.effect, { type: 'none' })

  const subItems: MenuEntry[] = [{ kind: 'item', id: 'file:new-tab', label: 'New tab' }]
  const leaveLeft = reduceMenuKey({ items: subItems, activeIndex: 0, inSubmenu: true, isCollapsedRoot: false }, 'ArrowLeft')
  assert.deepEqual(leaveLeft.effect, { type: 'leave-submenu' })

  const leaveBackspace = reduceMenuKey({ items: subItems, activeIndex: 0, inSubmenu: true, isCollapsedRoot: false }, 'Backspace')
  assert.deepEqual(leaveBackspace.effect, { type: 'leave-submenu' })
})

test('shouldCollapseMenus collapses on narrow windows and adapts to window button style and dev badge', () => {
  assert.equal(shouldCollapseMenus(1360, { windowButtons: 'windows', isDev: false }), false)
  assert.equal(shouldCollapseMenus(900, { windowButtons: 'windows', isDev: false }), true)
  // At 1010px: Veyra dots leave enough room for menus, while native Windows caption buttons collapse them.
  assert.equal(shouldCollapseMenus(1010, { windowButtons: 'dots', isDev: false }), false)
  assert.equal(shouldCollapseMenus(1010, { windowButtons: 'windows', isDev: false }), true)
  // Dev badge needs slightly more width before uncollapsing.
  assert.equal(shouldCollapseMenus(1065, { windowButtons: 'windows', isDev: false }), false)
  assert.equal(shouldCollapseMenus(1065, { windowButtons: 'windows', isDev: true }), true)
})

test('clampPopupBounds keeps menus inside the display workArea', () => {
  const workArea = { x: 0, y: 0, width: 1280, height: 720 }
  assert.deepEqual(clampPopupBounds({ x: 100, y: 44 }, { width: 240, height: 300 }, workArea), {
    x: 100,
    y: 44,
    width: 240,
    height: 300
  })
  // Overflowing right and bottom edges clamps cleanly within margin=6.
  assert.deepEqual(clampPopupBounds({ x: 1180, y: 600 }, { width: 260, height: 300 }, workArea), {
    x: 1014,
    y: 414,
    width: 260,
    height: 300
  })
})
