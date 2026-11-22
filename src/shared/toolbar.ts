/*
 * Customizable toolbar item registry, legacy migration, sanitization, and drag/reorder helpers.
 * Pure module (zero Electron/Node deps) shared across main, renderers, and unit tests.
 */

export const TOOLBAR_BUTTON_IDS = [
  'back',
  'forward',
  'reload',
  'home',
  'bookmark-star',
  'downloads',
  'extensions',
  'split',
  'sidebar-toggle',
  'screenshot',
  'workspaces',
  'settings'
] as const

export type ToolbarButtonId = (typeof TOOLBAR_BUTTON_IDS)[number]
export type ToolbarItemId = ToolbarButtonId | 'address-bar'

export interface ToolbarButtonMeta {
  id: ToolbarButtonId
  label: string
  description: string
}

export const TOOLBAR_BUTTONS: readonly ToolbarButtonMeta[] = Object.freeze([
  { id: 'back', label: 'Back', description: 'Go back one page' },
  { id: 'forward', label: 'Forward', description: 'Go forward one page' },
  { id: 'reload', label: 'Reload', description: 'Reload or stop loading the current page' },
  { id: 'home', label: 'Home', description: 'Open the start page in the current tab' },
  { id: 'bookmark-star', label: 'Bookmark star', description: 'Save or remove the current page as a bookmark' },
  { id: 'downloads', label: 'Downloads', description: 'Open the downloads panel' },
  { id: 'extensions', label: 'Extensions', description: 'Pinned extension buttons and overflow menu' },
  { id: 'split', label: 'Split view', description: 'Split or unsplit the current tab' },
  { id: 'sidebar-toggle', label: 'Sidebar toggle', description: 'Show or hide the tab sidebar' },
  { id: 'screenshot', label: 'Screenshot', description: 'Capture visible area, full page, or a selection' },
  { id: 'workspaces', label: 'Workspaces', description: 'Switch or create workspaces from the toolbar' },
  { id: 'settings', label: 'Settings', description: 'Open Veyra Orbit settings' }
])

export const DEFAULT_TOOLBAR_ITEMS: readonly ToolbarItemId[] = Object.freeze([
  'back',
  'forward',
  'reload',
  'address-bar',
  'bookmark-star',
  'screenshot',
  'extensions'
])

const BUTTON_SET = new Set<string>(TOOLBAR_BUTTON_IDS)
const LEADING_HINTS = new Set<string>(['sidebar-toggle', 'back', 'forward', 'reload', 'home'])

export function isToolbarButtonId(v: unknown): v is ToolbarButtonId {
  return typeof v === 'string' && BUTTON_SET.has(v)
}

export function isToolbarItemId(v: unknown): v is ToolbarItemId {
  return v === 'address-bar' || isToolbarButtonId(v)
}

/**
 * Sanitizes an untrusted toolbar layout array:
 * - Drops unknown IDs and duplicates.
 * - Ensures 'address-bar' is always present exactly once.
 */
export function sanitizeToolbarItems(raw: unknown): ToolbarItemId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_TOOLBAR_ITEMS]
  const out: ToolbarItemId[] = []
  const seen = new Set<ToolbarItemId>()
  for (const item of raw) {
    if (!isToolbarItemId(item) || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  if (!seen.has('address-bar')) {
    // Insert address-bar right after any leading navigation items.
    let insertAt = 0
    while (insertAt < out.length && LEADING_HINTS.has(out[insertAt])) insertAt++
    out.splice(insertAt, 0, 'address-bar')
  }
  return out
}

/**
 * Migrates the legacy boolean visibility flags (showNavButtons, showBookmarkStar, showExtensions)
 * into a clean ordered toolbarItems array.
 */
export function migrateLegacyToolbarButtons(flags: {
  showNavButtons?: unknown
  showBookmarkStar?: unknown
  showExtensions?: unknown
}): ToolbarItemId[] {
  const showNav = typeof flags.showNavButtons === 'boolean' ? flags.showNavButtons : true
  const showStar = typeof flags.showBookmarkStar === 'boolean' ? flags.showBookmarkStar : true
  const showExt = typeof flags.showExtensions === 'boolean' ? flags.showExtensions : true
  const out: ToolbarItemId[] = []
  if (showNav) out.push('back', 'forward', 'reload')
  out.push('address-bar')
  if (showStar) out.push('bookmark-star')
  out.push('screenshot')
  if (showExt) out.push('extensions')
  return out
}

/** Derives legacy boolean flags from a toolbarItems list so backwards-compatible callers stay in sync. */
export function deriveLegacyToolbarFlags(items: readonly ToolbarItemId[]): {
  showNavButtons: boolean
  showBookmarkStar: boolean
  showExtensions: boolean
} {
  const set = new Set(items)
  return {
    showNavButtons: set.has('back') || set.has('forward') || set.has('reload'),
    showBookmarkStar: set.has('bookmark-star'),
    showExtensions: set.has('extensions')
  }
}

/** Returns the toolbar buttons NOT currently placed in the toolbar. */
export function availableToolbarButtons(items: readonly ToolbarItemId[]): ToolbarButtonMeta[] {
  const active = new Set<string>(items)
  return TOOLBAR_BUTTONS.filter((b) => !active.has(b.id))
}

/** Inserts or moves a toolbar item to `targetIndex` within the active toolbar list. */
export function moveToolbarItem(
  items: readonly ToolbarItemId[],
  itemId: ToolbarItemId,
  targetIndex: number
): ToolbarItemId[] {
  const clean = sanitizeToolbarItems(items)
  const existingIdx = clean.indexOf(itemId)
  const next = clean.filter((x) => x !== itemId)
  const adjustedTarget = existingIdx >= 0 && existingIdx < targetIndex ? targetIndex - 1 : targetIndex
  const clamped = Math.max(0, Math.min(next.length, adjustedTarget))
  next.splice(clamped, 0, itemId)
  return sanitizeToolbarItems(next)
}

/** Removes a button from the toolbar (never removes 'address-bar'). */
export function removeToolbarButton(items: readonly ToolbarItemId[], buttonId: ToolbarButtonId): ToolbarItemId[] {
  return sanitizeToolbarItems(items.filter((x) => x !== buttonId))
}

/** Adds an available button to the toolbar at a sensible default side of the address bar (or explicit index). */
export function addToolbarButton(
  items: readonly ToolbarItemId[],
  buttonId: ToolbarButtonId,
  atIndex?: number
): ToolbarItemId[] {
  const clean = sanitizeToolbarItems(items)
  if (clean.includes(buttonId)) return clean
  if (atIndex !== undefined) {
    return moveToolbarItem(clean, buttonId, atIndex)
  }
  const addrIdx = clean.indexOf('address-bar')
  if (LEADING_HINTS.has(buttonId) && addrIdx >= 0) {
    const next = [...clean]
    next.splice(addrIdx, 0, buttonId)
    return next
  }
  return [...clean, buttonId]
}
