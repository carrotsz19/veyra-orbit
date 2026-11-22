/*
 * Behaviour options: external links, new-tab insertion position, post-close tab selection,
 * multi-tab window close confirmation, and startup session filtering (all vs pinned only).
 * Pure module (zero Electron/Node deps) shared across main, renderer, and unit tests.
 */

import { isAllowedUrl } from './url.ts'

export type ExternalLinkBehavior = 'new-tab' | 'current-tab'
export type NewTabPosition = 'end' | 'after-current'
export type CloseTabSelection = 'right' | 'left' | 'last-used'

export const MIN_CLOSE_CONFIRM_THRESHOLD = 2
export const MAX_CLOSE_CONFIRM_THRESHOLD = 100
export const DEFAULT_CLOSE_CONFIRM_THRESHOLD = 5

const EXTERNAL_LINK_SET = new Set<string>(['new-tab', 'current-tab'])
const NEW_TAB_POS_SET = new Set<string>(['end', 'after-current'])
const CLOSE_SEL_SET = new Set<string>(['right', 'left', 'last-used'])

export function isExternalLinkBehavior(v: unknown): v is ExternalLinkBehavior {
  return typeof v === 'string' && EXTERNAL_LINK_SET.has(v)
}

export function isNewTabPosition(v: unknown): v is NewTabPosition {
  return typeof v === 'string' && NEW_TAB_POS_SET.has(v)
}

export function isCloseTabSelection(v: unknown): v is CloseTabSelection {
  return typeof v === 'string' && CLOSE_SEL_SET.has(v)
}

export function sanitizeCloseTabThreshold(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_CLOSE_CONFIRM_THRESHOLD
  const rounded = Math.round(v)
  return Math.max(MIN_CLOSE_CONFIRM_THRESHOLD, Math.min(MAX_CLOSE_CONFIRM_THRESHOLD, rounded))
}

/**
 * Extracts the first safe http(s) URL passed via OS command-line arguments (default browser /
 * second-instance launch). Never accepts file:, javascript:, data:, or flag arguments.
 */
export function extractExternalUrlFromArgv(argv: readonly string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const raw = argv[i]
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('-') || trimmed.length > 4096) continue
    if (!/^https?:\/\//i.test(trimmed)) continue
    if (!isAllowedUrl(trimmed)) continue
    try {
      return new URL(trimmed).toString()
    } catch {
      continue
    }
  }
  return null
}

/**
 * Computes the insertion index in the flat `tabs` array for a newly created tab.
 * Explicit `afterId` (e.g. duplicate tab, link opened next to parent) wins when present.
 */
export function resolveNewTabInsertIndex(
  tabs: readonly { id: number; workspaceId: string }[],
  workspaceId: string,
  activeId: number | null,
  position: NewTabPosition,
  explicitAfterId?: number
): number {
  if (explicitAfterId !== undefined) {
    const idx = tabs.findIndex((t) => t.id === explicitAfterId)
    return idx >= 0 ? idx + 1 : tabs.length
  }
  if (position === 'after-current' && activeId !== null) {
    const idx = tabs.findIndex((t) => t.id === activeId && t.workspaceId === workspaceId)
    if (idx >= 0) return idx + 1
  }
  return tabs.length
}

/**
 * Picks which remaining tab in the workspace should become active after closing a tab.
 * Split-pane siblings still take priority when closing one pane of a visible split group.
 */
export function pickNextTabAfterClose<T extends { id: number; lastActiveSeq: number }>(
  wsAfter: readonly T[],
  closedIndex: number,
  selection: CloseTabSelection,
  siblingInGroupId?: number
): T | undefined {
  if (siblingInGroupId !== undefined) {
    const sibling = wsAfter.find((t) => t.id === siblingInGroupId)
    if (sibling) return sibling
  }
  if (wsAfter.length === 0) return undefined
  if (selection === 'left') {
    return wsAfter[closedIndex - 1] ?? wsAfter[closedIndex] ?? wsAfter[0]
  }
  if (selection === 'last-used') {
    let best: T | undefined
    for (const tab of wsAfter) {
      if (!best || tab.lastActiveSeq > best.lastActiveSeq) {
        best = tab
      }
    }
    if (best && best.lastActiveSeq > 0) return best
  }
  return wsAfter[closedIndex] ?? wsAfter[closedIndex - 1] ?? wsAfter[0]
}

/** True when closing the browser window should ask for confirmation first. */
export function shouldConfirmWindowClose(openTabCount: number, confirmEnabled: boolean, threshold: number): boolean {
  if (!confirmEnabled) return false
  return openTabCount >= sanitizeCloseTabThreshold(threshold)
}

/** Filters saved workspace tabs according to the user's startup restore preference. */
export function filterTabsForStartup<T extends { pinned: boolean }>(
  tabs: readonly T[],
  startup: 'restore' | 'restore-pinned' | 'new-tab'
): T[] {
  if (startup === 'new-tab') return []
  if (startup === 'restore-pinned') return tabs.filter((t) => t.pinned)
  return [...tabs]
}
