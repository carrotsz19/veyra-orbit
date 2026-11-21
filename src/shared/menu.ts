/*
 * Pure title-bar menu model, keyboard navigation reducer, narrow-window collapse rule,
 * and floating popup bounds clamping. Shared between main, renderer, and node:test unit tests.
 */

import type { WindowButtonsStyle } from './settings.ts'
import { displayUrl, isInternalUrl } from './url.ts'

export type MenuId = 'file' | 'edit' | 'view' | 'history' | 'bookmarks' | 'workspaces' | 'help'

export const MENU_ORDER: readonly MenuId[] = ['file', 'edit', 'view', 'history', 'bookmarks', 'workspaces', 'help']

export const ORBIT_RELEASES_URL = 'https://github.com/carrotsz19/veyra-orbit/releases'
export const ORBIT_NEW_ISSUE_URL = 'https://github.com/carrotsz19/veyra-orbit/issues/new'
export const MAX_HISTORY_MENU_ITEMS = 8
export const MAX_BOOKMARK_MENU_ITEMS = 12

export interface MenuSeparatorEntry {
  kind: 'separator'
}

export interface MenuItemEntry {
  kind: 'item'
  id: string
  label: string
  keys?: string
  checked?: boolean
  disabled?: boolean
  hasSubmenu?: boolean
}

export type MenuEntry = MenuSeparatorEntry | MenuItemEntry

export interface MenuSection {
  id: MenuId
  label: string
  items: MenuEntry[]
}

export interface MenuPopupHeader {
  label: string
  backId: string
}

export interface MenuPopupSpec {
  /** Anchor X in CSS pixels relative to the main window content area. */
  x: number
  /** Anchor Y in CSS pixels relative to the main window content area. */
  y: number
  dark: boolean
  accent: string
  items: MenuEntry[]
  /** Initial highlighted item index (-1 for none, 0+ for keyboard-opened menus). */
  initialActive?: number
  /** Optional drill-down header shown when inside a collapsed-menu category. */
  header?: MenuPopupHeader
}

export interface MenuTabContext {
  id: number
  url: string
  canGoBack: boolean
  canGoForward: boolean
  zoom: number
  bookmarked: boolean
  hasError: boolean
}

export interface MenuWorkspaceContext {
  id: string
  name: string
}

export interface MenuHistoryContext {
  url: string
  title: string
}

export interface MenuBookmarkContext {
  url: string
  title: string
}

export interface MenuBuildContext {
  activeTab: MenuTabContext | null
  workspaces: readonly MenuWorkspaceContext[]
  activeWorkspaceId: string
  compactMode: boolean
  isFullscreen: boolean
  canReopenClosed: boolean
  history: readonly MenuHistoryContext[]
  bookmarks: readonly MenuBookmarkContext[]
  appVersion: string
  isDev: boolean
}

const SEP: MenuSeparatorEntry = { kind: 'separator' }

function isWebPage(tab: MenuTabContext | null): boolean {
  return !!tab && !!tab.url && !tab.hasError && !isInternalUrl(tab.url)
}

function canBookmarkTab(tab: MenuTabContext | null): boolean {
  return !!tab && /^https?:/.test(tab.url) && !tab.hasError
}

function pageLabel(title: string, url: string): string {
  const clean = title.trim()
  if (clean) return clean
  return displayUrl(url) || url
}

/**
 * Deduplicates recent visits by URL (keeping the most recent visit first) and caps at 8 items.
 */
export function recentHistoryItems(history: readonly MenuHistoryContext[], limit = MAX_HISTORY_MENU_ITEMS): MenuHistoryContext[] {
  const out: MenuHistoryContext[] = []
  const seen = new Set<string>()
  for (const h of history) {
    if (!h.url || seen.has(h.url)) continue
    seen.add(h.url)
    out.push(h)
    if (out.length >= limit) break
  }
  return out
}

/** Builds all seven Orbit title-bar menus from the current browser snapshot. */
export function buildMenus(ctx: MenuBuildContext): MenuSection[] {
  const tab = ctx.activeTab
  const webPage = isWebPage(tab)
  const canBookmark = canBookmarkTab(tab)
  const recent = recentHistoryItems(ctx.history, MAX_HISTORY_MENU_ITEMS)
  const marks = ctx.bookmarks.slice(0, MAX_BOOKMARK_MENU_ITEMS)
  const appLabel = ctx.isDev ? 'Veyra Orbit Dev' : 'Veyra Orbit'

  const fileItems: MenuEntry[] = [
    { kind: 'item', id: 'file:new-tab', label: 'New tab', keys: 'Ctrl+T' },
    { kind: 'item', id: 'file:new-workspace', label: 'New workspace' },
    { kind: 'item', id: 'file:reopen-closed', label: 'Reopen closed tab', keys: 'Ctrl+Shift+T', disabled: !ctx.canReopenClosed },
    SEP,
    { kind: 'item', id: 'file:print', label: 'Print…', keys: 'Ctrl+P', disabled: !webPage },
    { kind: 'item', id: 'file:settings', label: 'Settings', keys: 'Ctrl+,' },
    SEP,
    { kind: 'item', id: 'file:close-tab', label: 'Close tab', keys: 'Ctrl+W', disabled: !tab },
    { kind: 'item', id: 'file:quit', label: 'Quit', keys: 'Ctrl+Q' }
  ]

  const editItems: MenuEntry[] = [
    { kind: 'item', id: 'edit:undo', label: 'Undo', keys: 'Ctrl+Z' },
    { kind: 'item', id: 'edit:redo', label: 'Redo', keys: 'Ctrl+Y' },
    SEP,
    { kind: 'item', id: 'edit:cut', label: 'Cut', keys: 'Ctrl+X' },
    { kind: 'item', id: 'edit:copy', label: 'Copy', keys: 'Ctrl+C' },
    { kind: 'item', id: 'edit:paste', label: 'Paste', keys: 'Ctrl+V' },
    { kind: 'item', id: 'edit:select-all', label: 'Select all', keys: 'Ctrl+A' },
    SEP,
    { kind: 'item', id: 'edit:find', label: 'Find in page…', keys: 'Ctrl+F', disabled: !webPage }
  ]

  const viewItems: MenuEntry[] = [
    { kind: 'item', id: 'view:compact', label: 'Compact mode', keys: 'Ctrl+Shift+S', checked: ctx.compactMode },
    SEP,
    { kind: 'item', id: 'view:zoom-in', label: 'Zoom in', keys: 'Ctrl+=', disabled: !webPage },
    { kind: 'item', id: 'view:zoom-out', label: 'Zoom out', keys: 'Ctrl+−', disabled: !webPage },
    { kind: 'item', id: 'view:zoom-reset', label: 'Reset zoom', keys: 'Ctrl+0', disabled: !webPage || (tab?.zoom ?? 100) === 100 },
    SEP,
    { kind: 'item', id: 'view:fullscreen', label: 'Full screen', keys: 'F11', checked: ctx.isFullscreen },
    { kind: 'item', id: 'view:reload', label: 'Reload', keys: 'Ctrl+R', disabled: !tab?.url || isInternalUrl(tab.url) },
    SEP,
    { kind: 'item', id: 'view:devtools', label: 'Developer tools', keys: 'F12', disabled: !webPage },
    { kind: 'item', id: 'view:downloads', label: 'Show downloads', keys: 'Ctrl+J' }
  ]

  const historyItems: MenuEntry[] = [
    { kind: 'item', id: 'history:back', label: 'Back', keys: 'Alt+Left', disabled: !tab?.canGoBack },
    { kind: 'item', id: 'history:forward', label: 'Forward', keys: 'Alt+Right', disabled: !tab?.canGoForward },
    { kind: 'item', id: 'history:all', label: 'Show all history', keys: 'Ctrl+H' },
    SEP,
    ...(recent.length > 0
      ? recent.map(
          (entry, i): MenuItemEntry => ({
            kind: 'item',
            id: `history:open:${i}`,
            label: pageLabel(entry.title, entry.url)
          })
        )
      : [{ kind: 'item', id: 'history:empty', label: 'No recent pages', disabled: true } as MenuItemEntry])
  ]

  const bookmarkItems: MenuEntry[] = [
    {
      kind: 'item',
      id: 'bookmarks:toggle',
      label: tab?.bookmarked ? 'Remove bookmark' : 'Bookmark this page',
      keys: 'Ctrl+D',
      checked: canBookmark ? !!tab?.bookmarked : undefined,
      disabled: !canBookmark
    },
    { kind: 'item', id: 'bookmarks:all', label: 'Show all bookmarks', keys: 'Ctrl+Shift+O' },
    SEP,
    ...(marks.length > 0
      ? marks.map(
          (b, i): MenuItemEntry => ({
            kind: 'item',
            id: `bookmarks:open:${i}`,
            label: pageLabel(b.title, b.url)
          })
        )
      : [{ kind: 'item', id: 'bookmarks:empty', label: 'No bookmarks yet', disabled: true } as MenuItemEntry])
  ]

  const workspaceItems: MenuEntry[] = [
    ...ctx.workspaces.map(
      (ws, i): MenuItemEntry => ({
        kind: 'item',
        id: `workspaces:switch:${ws.id}`,
        label: ws.name,
        checked: ws.id === ctx.activeWorkspaceId,
        keys: i < 9 ? `Ctrl+Alt+${i + 1}` : undefined
      })
    ),
    ...(ctx.workspaces.length > 0 ? [SEP] : []),
    { kind: 'item', id: 'workspaces:new', label: 'New workspace' }
  ]

  const helpItems: MenuEntry[] = [
    { kind: 'item', id: 'help:check-updates', label: 'Check for updates' },
    { kind: 'item', id: 'help:whats-new', label: 'What’s new' },
    { kind: 'item', id: 'help:report-bug', label: 'Report a bug' },
    SEP,
    { kind: 'item', id: 'help:about', label: ctx.appVersion ? `About ${appLabel} ${ctx.appVersion}` : `About ${appLabel}` }
  ]

  return [
    { id: 'file', label: 'File', items: fileItems },
    { id: 'edit', label: 'Edit', items: editItems },
    { id: 'view', label: 'View', items: viewItems },
    { id: 'history', label: 'History', items: historyItems },
    { id: 'bookmarks', label: 'Bookmarks', items: bookmarkItems },
    { id: 'workspaces', label: 'Workspaces', items: workspaceItems },
    { id: 'help', label: 'Help', items: helpItems }
  ]
}

/** Builds the top-level category list shown when the title bar collapses menus into ☰. */
export function buildCollapsedRootMenu(sections: readonly MenuSection[]): MenuEntry[] {
  return sections.map((s) => ({
    kind: 'item',
    id: `submenu:${s.id}`,
    label: s.label,
    hasSubmenu: true
  }))
}

// ---- keyboard navigation reducer -------------------------------------------

export function isSelectable(entry: MenuEntry | undefined): entry is MenuItemEntry {
  return !!entry && entry.kind === 'item' && !entry.disabled
}

export function firstSelectableIndex(items: readonly MenuEntry[]): number {
  for (let i = 0; i < items.length; i++) {
    if (isSelectable(items[i])) return i
  }
  return -1
}

export function lastSelectableIndex(items: readonly MenuEntry[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (isSelectable(items[i])) return i
  }
  return -1
}

export function stepSelectableIndex(items: readonly MenuEntry[], current: number, delta: 1 | -1): number {
  const len = items.length
  if (len === 0) return -1
  let idx = current < 0 || current >= len ? (delta === 1 ? -1 : len) : current
  for (let n = 0; n < len; n++) {
    idx = (idx + delta + len) % len
    if (isSelectable(items[idx])) return idx
  }
  return -1
}

export interface MenuNavState {
  items: readonly MenuEntry[]
  activeIndex: number
  /** True when the popup is showing a drilled-in submenu inside the collapsed ☰ menu. */
  inSubmenu: boolean
  /** True when the popup is showing the collapsed ☰ root category list. */
  isCollapsedRoot: boolean
}

export type MenuNavEffect =
  | { type: 'none' }
  | { type: 'pick'; id: string }
  | { type: 'step-menu'; delta: -1 | 1 }
  | { type: 'leave-submenu' }
  | { type: 'dismiss' }

export interface MenuNavResult {
  activeIndex: number
  effect: MenuNavEffect
  handled: boolean
}

/**
 * Pure keyboard reducer for an open menu popup.
 * Handles ArrowDown/Up, Home/End, Enter/Space, Escape, Backspace, and ArrowLeft/Right.
 */
export function reduceMenuKey(state: MenuNavState, key: string): MenuNavResult {
  const { items, activeIndex, inSubmenu, isCollapsedRoot } = state

  if (key === 'ArrowDown') {
    return { activeIndex: stepSelectableIndex(items, activeIndex, 1), effect: { type: 'none' }, handled: true }
  }
  if (key === 'ArrowUp') {
    return { activeIndex: stepSelectableIndex(items, activeIndex, -1), effect: { type: 'none' }, handled: true }
  }
  if (key === 'Home') {
    return { activeIndex: firstSelectableIndex(items), effect: { type: 'none' }, handled: true }
  }
  if (key === 'End') {
    return { activeIndex: lastSelectableIndex(items), effect: { type: 'none' }, handled: true }
  }
  if (key === 'Escape') {
    return { activeIndex, effect: { type: 'dismiss' }, handled: true }
  }
  if (key === 'Enter' || key === ' ') {
    const item = items[activeIndex]
    if (isSelectable(item)) {
      return { activeIndex, effect: { type: 'pick', id: item.id }, handled: true }
    }
    return { activeIndex, effect: { type: 'none' }, handled: true }
  }
  if (key === 'ArrowRight') {
    const item = items[activeIndex]
    if (isSelectable(item) && item.hasSubmenu) {
      return { activeIndex, effect: { type: 'pick', id: item.id }, handled: true }
    }
    if (!inSubmenu && !isCollapsedRoot) {
      return { activeIndex, effect: { type: 'step-menu', delta: 1 }, handled: true }
    }
    return { activeIndex, effect: { type: 'none' }, handled: true }
  }
  if (key === 'ArrowLeft') {
    if (inSubmenu) {
      return { activeIndex, effect: { type: 'leave-submenu' }, handled: true }
    }
    if (!isCollapsedRoot) {
      return { activeIndex, effect: { type: 'step-menu', delta: -1 }, handled: true }
    }
    return { activeIndex, effect: { type: 'none' }, handled: true }
  }
  if (key === 'Backspace' && inSubmenu) {
    return { activeIndex, effect: { type: 'leave-submenu' }, handled: true }
  }

  return { activeIndex, effect: { type: 'none' }, handled: false }
}

// ---- narrow-window collapse & popup clamping -------------------------------

/**
 * Decides whether the 7 top-level menus collapse into a single "☰" button
 * so the address bar keeps enough horizontal breathing room on narrow windows.
 */
export function shouldCollapseMenus(
  windowWidth: number,
  opts: { windowButtons?: WindowButtonsStyle; isDev?: boolean } = {}
): boolean {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return false
  const buttonsExtra = opts.windowButtons === 'dots' ? 0 : 72
  const devExtra = opts.isDev ? 32 : 0
  const threshold = 980 + buttonsExtra + devExtra
  return windowWidth < threshold
}

export interface BoundsRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Places a floating popup at (anchor.x, anchor.y) with (size.width, size.height),
 * clamping it inside the display workArea so menus never clip off screen edges.
 */
export function clampPopupBounds(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  workArea: BoundsRect,
  margin = 6
): BoundsRect {
  const maxW = Math.max(80, workArea.width - margin * 2)
  const maxH = Math.max(40, workArea.height - margin * 2)
  const width = Math.min(Math.max(80, Math.ceil(size.width)), maxW)
  const height = Math.min(Math.max(32, Math.ceil(size.height)), maxH)

  const minX = workArea.x + margin
  const maxX = workArea.x + workArea.width - width - margin
  const minY = workArea.y + margin
  const maxY = workArea.y + workArea.height - height - margin

  const x = Math.round(Math.min(Math.max(anchor.x, minX), Math.max(minX, maxX)))
  const y = Math.round(Math.min(Math.max(anchor.y, minY), Math.max(minY, maxY)))
  return { x, y, width, height }
}
