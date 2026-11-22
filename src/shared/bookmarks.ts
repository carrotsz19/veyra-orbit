/*
 * Pure bookmark bar helpers: folder grouping, drag-to-reorder persistence, dropped link/icon
 * parsing, and visibility / Ctrl+Shift+B toggle rules.
 *
 * Schema choice (documented for orbit.db migration):
 * Existing Orbit bookmarks were flat (url, title, created). We extend the table additively with
 * `folder TEXT NOT NULL DEFAULT ''` and `position INTEGER NOT NULL DEFAULT 0`. Existing rows stay
 * intact at the top level of the bookmark bar (folder = '') in their original newest-first order.
 * Bookmarks with a non-empty `folder` name appear grouped under a folder dropdown on the bar.
 */

import type { BookmarkBarMode } from './appearance.ts'
import type { Bookmark } from './types.ts'
import { displayUrl, isAllowedUrl } from './url.ts'

export type BookmarkBarEntry =
  | { kind: 'bookmark'; key: string; bookmark: Bookmark; position: number }
  | { kind: 'folder'; key: string; name: string; items: Bookmark[]; position: number }

export function normalizeBookmarkFolder(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\r\n\t\0]+/g, ' ').trim().slice(0, 80)
}

/**
 * Groups bookmarks into ordered top-level bookmark bar entries:
 * unfoldered bookmarks appear directly; bookmarks sharing a non-empty `folder` name
 * are grouped into a folder dropdown positioned at the earliest member's position.
 */
export function buildBookmarkBarEntries(bookmarks: readonly Bookmark[]): BookmarkBarEntry[] {
  const sorted = [...bookmarks].sort((a, b) => {
    const pa = typeof a.position === 'number' && Number.isFinite(a.position) ? a.position : Number.MAX_SAFE_INTEGER
    const pb = typeof b.position === 'number' && Number.isFinite(b.position) ? b.position : Number.MAX_SAFE_INTEGER
    if (pa !== pb) return pa - pb
    return b.created - a.created
  })

  const entries: BookmarkBarEntry[] = []
  const folders = new Map<string, { kind: 'folder'; key: string; name: string; items: Bookmark[]; position: number }>()

  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i]
    const pos = typeof b.position === 'number' && Number.isFinite(b.position) ? b.position : i
    const folderName = normalizeBookmarkFolder(b.folder)
    if (!folderName) {
      entries.push({ kind: 'bookmark', key: `bm:${b.url}`, bookmark: b, position: pos })
    } else {
      const existing = folders.get(folderName)
      if (existing) {
        existing.items.push(b)
      } else {
        const folderEntry: { kind: 'folder'; key: string; name: string; items: Bookmark[]; position: number } = {
          kind: 'folder',
          key: `folder:${folderName}`,
          name: folderName,
          items: [b],
          position: pos
        }
        folders.set(folderName, folderEntry)
        entries.push(folderEntry)
      }
    }
  }

  return entries
}

/**
 * Computes updated sequential `position` values for all bookmarks after dragging
 * `draggedKey` onto `targetKey` on the bookmark bar.
 */
export function reorderBookmarkBarEntries(
  bookmarks: readonly Bookmark[],
  draggedKey: string,
  targetKey: string
): { url: string; position: number }[] | null {
  if (!draggedKey || !targetKey || draggedKey === targetKey) return null
  const entries = buildBookmarkBarEntries(bookmarks)
  const fromIdx = entries.findIndex((e) => e.key === draggedKey)
  const toIdx = entries.findIndex((e) => e.key === targetKey)
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return null

  const reordered = [...entries]
  const [moved] = reordered.splice(fromIdx, 1)
  reordered.splice(toIdx, 0, moved)

  const updates: { url: string; position: number }[] = []
  let pos = 0
  for (const entry of reordered) {
    if (entry.kind === 'bookmark') {
      updates.push({ url: entry.bookmark.url, position: pos++ })
    } else {
      for (const item of entry.items) {
        updates.push({ url: item.url, position: pos++ })
      }
    }
  }
  return updates
}

export interface DroppedBookmarkPayload {
  customJson?: string
  uriList?: string
  html?: string
  plain?: string
}

/**
 * Safely parses a dropped link or address-bar site icon payload into an allowed http(s) bookmark.
 * Rejects dangerous schemes (javascript:, file:, data:, orbit:, etc.).
 */
export function extractDroppedBookmark(data: DroppedBookmarkPayload): { url: string; title: string } | null {
  if (data.customJson) {
    try {
      const parsed = JSON.parse(data.customJson) as { url?: unknown; title?: unknown }
      if (typeof parsed?.url === 'string' && /^https?:/i.test(parsed.url) && isAllowedUrl(parsed.url)) {
        const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : displayUrl(parsed.url)
        return { url: parsed.url, title: title.slice(0, 512) }
      }
    } catch {
      /* fall through to standard drop formats */
    }
  }

  let url = ''
  let title = ''

  if (data.uriList) {
    const lines = data.uriList
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
    if (lines[0]) url = lines[0]
  }

  if (data.html) {
    const hrefMatch = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(data.html)
    if (hrefMatch) {
      if (!url) url = hrefMatch[1].trim()
      const text = hrefMatch[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      if (text) title = text
    }
  }

  if (!url && data.plain) {
    const trimmed = data.plain.trim()
    if (/^https?:\/\/\S+$/i.test(trimmed)) url = trimmed
  }

  if (!url || !/^https?:/i.test(url) || !isAllowedUrl(url)) return null
  return { url, title: (title || displayUrl(url)).slice(0, 512) }
}

/** Determines whether the bookmark bar should be shown given the user's mode and current tab state. */
export function shouldShowBookmarkBar(mode: BookmarkBarMode, isStartPage: boolean, isFullscreen: boolean): boolean {
  if (isFullscreen) return false
  if (mode === 'always') return true
  if (mode === 'never') return false
  return isStartPage
}

/** Toggles bookmark bar visibility for Ctrl+Shift+B and the View menu item. */
export function toggleBookmarkBarMode(current: BookmarkBarMode, isStartPage: boolean): BookmarkBarMode {
  const visible = shouldShowBookmarkBar(current, isStartPage, false)
  return visible ? 'never' : 'always'
}
