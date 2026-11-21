/*
 * Pure browser import types, Chrome/Edge/Brave Bookmarks JSON parser,
 * Chrome timestamp conversion, history row filtering, and summary formatting.
 * Shared between main, renderer, and node:test unit tests.
 */

import { isAllowedUrl } from './url.ts'

export type ImportBrowserId = 'chrome' | 'edge' | 'brave'

export interface ImportProfile {
  /** Stable opaque id resolved by the main process, e.g. "chrome:Default". */
  id: string
  browser: ImportBrowserId
  browserName: string
  /** Directory name under User Data, e.g. "Default" or "Profile 1". */
  profileDir: string
  /** Human-readable profile name from Local State / Preferences, or directory name. */
  profileName: string
  hasBookmarks: boolean
  hasHistory: boolean
}

export interface ImportStatus {
  profiles: ImportProfile[]
  /** Offered once on first run when at least one browser profile is detected. */
  showFirstRunPrompt: boolean
}

export interface ImportRequest {
  profileId: string
  bookmarks: boolean
  history: boolean
}

export interface ImportResult {
  ok: boolean
  browserName: string
  profileName: string
  bookmarksImported: number
  bookmarksSkipped: number
  historyImported: number
  historySkipped: number
  error?: string
}

export interface ImportedBookmark {
  url: string
  title: string
  created: number
}

export interface ImportedVisit {
  url: string
  title: string
  time: number
  typed: boolean
}

export interface RawChromeHistoryRow {
  url: unknown
  title: unknown
  visit_time: unknown
  typed_count?: unknown
}

export const IMPORT_HISTORY_DAYS = 90
export const IMPORT_HISTORY_WINDOW_MS = IMPORT_HISTORY_DAYS * 24 * 60 * 60 * 1000

/** Milliseconds between 1601-01-01T00:00:00Z (Chrome/WebKit epoch) and 1970-01-01T00:00:00Z (Unix epoch). */
export const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000
const CHROME_EPOCH_OFFSET_MS_BIGINT = 11_644_473_600_000n

const MIN_VALID_UNIX_MS = Date.UTC(1990, 0, 1)
const MAX_VALID_UNIX_MS = Date.UTC(2100, 0, 1)
const MAX_IMPORT_URL_LENGTH = 4096
const MAX_IMPORT_TITLE_LENGTH = 512
const MAX_BOOKMARK_DEPTH = 32

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function cleanText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return ''
  const cleaned = raw.replace(/[\r\n\t\0]+/g, ' ').trim()
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned
}

/**
 * Converts a Chrome/WebKit timestamp (microseconds since 1601-01-01 UTC) into Unix epoch milliseconds.
 * Accepts bigint, number, or numeric string (as found in Chrome's Bookmarks JSON).
 * Returns null for zero, negative, non-numeric, or out-of-range values.
 */
export function chromeTimeToUnixMs(raw: unknown): number | null {
  let ms: number
  if (typeof raw === 'bigint') {
    if (raw <= 0n) return null
    const converted = raw / 1000n - CHROME_EPOCH_OFFSET_MS_BIGINT
    if (converted < BigInt(MIN_VALID_UNIX_MS) || converted > BigInt(MAX_VALID_UNIX_MS)) return null
    ms = Number(converted)
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) return null
    try {
      const us = BigInt(trimmed)
      if (us <= 0n) return null
      const converted = us / 1000n - CHROME_EPOCH_OFFSET_MS_BIGINT
      if (converted < BigInt(MIN_VALID_UNIX_MS) || converted > BigInt(MAX_VALID_UNIX_MS)) return null
      ms = Number(converted)
    } catch {
      return null
    }
  } else if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null
    ms = Math.floor(raw / 1000) - CHROME_EPOCH_OFFSET_MS
  } else {
    return null
  }

  if (!Number.isFinite(ms) || ms < MIN_VALID_UNIX_MS || ms > MAX_VALID_UNIX_MS) return null
  return ms
}

/** Converts Unix epoch milliseconds into a Chrome/WebKit timestamp in microseconds (as bigint). */
export function unixMsToChromeTimeUs(unixMs: number): bigint {
  return (BigInt(Math.floor(unixMs)) + CHROME_EPOCH_OFFSET_MS_BIGINT) * 1000n
}

/** Only http(s) URLs passing Orbit's scheme allowlist and length cap may be imported. */
export function isImportableUrl(url: unknown): url is string {
  return typeof url === 'string' && url.length > 0 && url.length <= MAX_IMPORT_URL_LENGTH && /^https?:/i.test(url) && isAllowedUrl(url)
}

function hostFallback(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Parses a Chromium `Bookmarks` JSON structure into flat Orbit bookmarks.
 *
 * Orbit's bookmark list is flat, so user-created folders are preserved as a breadcrumb prefix
 * ("Folder › Subfolder › Title"), while top-level Chrome roots ("Bookmarks bar", "Other bookmarks",
 * "Mobile bookmarks") are omitted to avoid prefixing every imported bookmark.
 */
export function parseChromeBookmarks(raw: unknown, now = Date.now()): ImportedBookmark[] {
  if (!isPlainObject(raw) || !isPlainObject(raw.roots)) return []
  const roots = raw.roots
  const out: ImportedBookmark[] = []
  const seen = new Set<string>()

  const walk = (node: unknown, folders: readonly string[], isRootContainer: boolean, depth: number): void => {
    if (depth > MAX_BOOKMARK_DEPTH || !isPlainObject(node)) return
    const type = typeof node.type === 'string' ? node.type : ''

    if (type === 'url') {
      if (!isImportableUrl(node.url) || seen.has(node.url)) return
      seen.add(node.url)
      const leafTitle = cleanText(node.name, MAX_IMPORT_TITLE_LENGTH)
      const label = leafTitle || (folders.length > 0 ? hostFallback(node.url) : '')
      const fullTitle = folders.length > 0 ? [...folders, ...(label ? [label] : [])].join(' › ') : label
      const created = chromeTimeToUnixMs(node.date_added) ?? now
      out.push({
        url: node.url,
        title: fullTitle.length > MAX_IMPORT_TITLE_LENGTH ? fullTitle.slice(0, MAX_IMPORT_TITLE_LENGTH) : fullTitle,
        created
      })
      return
    }

    if (Array.isArray(node.children)) {
      const folderName = isRootContainer ? '' : cleanText(node.name, 80)
      const nextFolders = folderName ? [...folders, folderName] : folders
      for (const child of node.children) {
        walk(child, nextFolders, false, depth + 1)
      }
    }
  }

  // Visit standard roots in a predictable order, then any extra folder roots.
  const orderedKeys = ['bookmark_bar', 'other', 'synced']
  const visitedKeys = new Set<string>()
  for (const key of orderedKeys) {
    if (Object.prototype.hasOwnProperty.call(roots, key)) {
      visitedKeys.add(key)
      walk(roots[key], [], true, 0)
    }
  }
  for (const key of Object.keys(roots)) {
    if (!visitedKeys.has(key)) {
      walk(roots[key], [], true, 0)
    }
  }

  return out
}

/**
 * Filters and normalizes raw rows read from a Chromium `History` SQLite database.
 * Keeps only http(s) URLs visited within the last `days` days (default 90),
 * converts Chrome timestamps to Unix ms, and deduplicates exact (url, time) pairs.
 */
export function filterChromeHistoryRows(
  rows: readonly RawChromeHistoryRow[],
  now = Date.now(),
  days = IMPORT_HISTORY_DAYS
): ImportedVisit[] {
  const windowMs = Math.max(1, days) * 24 * 60 * 60 * 1000
  const cutoffMs = now - windowMs
  const maxFutureMs = now + 24 * 60 * 60 * 1000
  const out: ImportedVisit[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!isImportableUrl(row.url)) continue
    const time = chromeTimeToUnixMs(row.visit_time)
    if (time === null || time < cutoffMs || time > maxFutureMs) continue
    const dedupeKey = `${row.url}\0${time}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const typed =
      typeof row.typed_count === 'bigint'
        ? row.typed_count > 0n
        : typeof row.typed_count === 'number'
          ? Number.isFinite(row.typed_count) && row.typed_count > 0
          : Number(row.typed_count ?? 0) > 0
    out.push({
      url: row.url,
      title: cleanText(row.title, MAX_IMPORT_TITLE_LENGTH),
      time,
      typed
    })
  }

  return out
}

function plural(n: number, singular: string, pluralWord: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : pluralWord}`
}

/** Builds a concise, human-readable import completion summary. */
export function formatImportSummary(
  result: Pick<ImportResult, 'bookmarksImported' | 'historyImported' | 'bookmarksSkipped' | 'historySkipped'>
): string {
  const parts: string[] = []
  if (result.bookmarksImported > 0) parts.push(plural(result.bookmarksImported, 'bookmark', 'bookmarks'))
  if (result.historyImported > 0) parts.push(plural(result.historyImported, 'history entry', 'history entries'))

  if (parts.length === 2) return `Imported ${parts[0]} and ${parts[1]}.`
  if (parts.length === 1) return `Imported ${parts[0]}.`

  if (result.bookmarksSkipped > 0 || result.historySkipped > 0) {
    return 'Everything selected is already in Veyra Orbit.'
  }
  return 'No new bookmarks or history entries found to import.'
}
