/*
 * History and bookmarks, in one SQLite file in the profile (orbit.db).
 * Only http(s) pages are recorded; nothing here ever leaves the computer.
 */
import { DatabaseSync } from 'node:sqlite'
import type { Bookmark, HistoryEntry, SitePermission } from '../shared/types'
import type { Candidate } from '../shared/suggest'
import { isAskablePermission, normalizePermissionOrigin } from '../shared/permissions.ts'
import { isAllowedUrl } from '../shared/url.ts'

const MAX_URL = 4096
const MAX_TITLE = 512

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s)
const recordable = (url: string): boolean => url.length <= MAX_URL && /^https?:/i.test(url) && isAllowedUrl(url)

export class Store {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS urls (
        url TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        visits INTEGER NOT NULL DEFAULT 0,
        typed INTEGER NOT NULL DEFAULT 0,
        last INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS visits (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL,
        time INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS visits_time ON visits(time);
      CREATE INDEX IF NOT EXISTS visits_url ON visits(url);
      CREATE TABLE IF NOT EXISTS bookmarks (
        url TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS permissions (
        origin TEXT NOT NULL,
        permission TEXT NOT NULL,
        allow INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        PRIMARY KEY (origin, permission)
      );
    `)
  }

  close(): void {
    this.db.close()
  }

  // ---- history ---------------------------------------------------------------

  /** A page was opened. Visits to the same address within a few seconds (reloads, redirects) count once. */
  visit(url: string, title: string, typed: boolean, now = Date.now()): void {
    if (!recordable(url)) return
    const last = this.db.prepare('SELECT time FROM visits WHERE url = ? ORDER BY time DESC LIMIT 1').get(url) as { time: number } | undefined
    if (last && now - last.time < 5000) return
    this.db.prepare('INSERT INTO visits (url, time) VALUES (?, ?)').run(url, now)
    this.db
      .prepare(
        `INSERT INTO urls (url, title, visits, typed, last) VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(url) DO UPDATE SET visits = visits + 1, typed = typed + excluded.typed, last = excluded.last,
           title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END`
      )
      .run(url, clip(title, MAX_TITLE), typed ? 1 : 0, now)
  }

  title(url: string, title: string): void {
    if (!recordable(url) || !title) return
    this.db.prepare('UPDATE urls SET title = ? WHERE url = ?').run(clip(title, MAX_TITLE), url)
    this.db.prepare('UPDATE bookmarks SET title = ? WHERE url = ? AND title = \'\'').run(clip(title, MAX_TITLE), url)
  }

  /** Newest first. `query` matches address or title; `before` pages back through time. */
  history(query: string, before: number | null, limit = 100): HistoryEntry[] {
    const q = query.trim().toLowerCase()
    return this.db
      .prepare(
        `SELECT v.id, v.url, v.time, COALESCE(u.title, '') AS title FROM visits v LEFT JOIN urls u ON u.url = v.url
         WHERE v.time < ? AND (? = '' OR instr(lower(v.url), ?) > 0 OR instr(lower(u.title), ?) > 0)
         ORDER BY v.time DESC LIMIT ?`
      )
      .all(before ?? Number.MAX_SAFE_INTEGER, q, q, q, Math.min(Math.max(1, limit), 500)) as unknown as HistoryEntry[]
  }

  deleteVisit(id: number): void {
    const row = this.db.prepare('SELECT url FROM visits WHERE id = ?').get(id) as { url: string } | undefined
    if (!row) return
    this.db.prepare('DELETE FROM visits WHERE id = ?').run(id)
    this.tidy(row.url)
  }

  /** Forgets one address entirely: every visit to it. */
  deleteUrl(url: string): void {
    this.db.prepare('DELETE FROM visits WHERE url = ?').run(url)
    this.db.prepare('DELETE FROM urls WHERE url = ?').run(url)
  }

  /** Clears history from `since` (ms) up to now; 0 clears all of it. Bookmarks stay. */
  clear(since: number): void {
    if (since <= 0) {
      this.db.exec('DELETE FROM visits; DELETE FROM urls;')
      return
    }
    const urls = this.db.prepare('SELECT DISTINCT url FROM visits WHERE time >= ?').all(since) as { url: string }[]
    this.db.prepare('DELETE FROM visits WHERE time >= ?').run(since)
    for (const { url } of urls) this.tidy(url)
  }

  /** Brings an address's totals back in line with the visits left (or removes it). */
  private tidy(url: string): void {
    const left = this.db.prepare('SELECT COUNT(*) AS n, MAX(time) AS last FROM visits WHERE url = ?').get(url) as { n: number; last: number | null }
    if (!left.n) this.db.prepare('DELETE FROM urls WHERE url = ?').run(url)
    else this.db.prepare('UPDATE urls SET visits = ?, typed = MIN(typed, ?), last = ? WHERE url = ?').run(left.n, left.n, left.last ?? 0, url)
  }

  /** History and bookmarks that could match what's typed, for the address bar to rank. */
  candidates(input: string, limit = 300): Candidate[] {
    const first = input.trim().toLowerCase().split(/\s+/)[0] ?? ''
    if (!first) return []
    const rows = this.db
      .prepare(
        `SELECT url, title, visits, typed, last, EXISTS(SELECT 1 FROM bookmarks b WHERE b.url = u.url) AS bm FROM urls u
         WHERE instr(lower(url), ?) > 0 OR instr(lower(title), ?) > 0
         UNION ALL
         SELECT b.url, b.title, 0, 0, 0, 1 FROM bookmarks b
         WHERE NOT EXISTS(SELECT 1 FROM urls u WHERE u.url = b.url) AND (instr(lower(b.url), ?) > 0 OR instr(lower(b.title), ?) > 0)
         ORDER BY 5 DESC LIMIT ?`
      )
      .all(first, first, first, first, limit) as { url: string; title: string; visits: number; typed: number; last: number; bm: number }[]
    return rows.map((r) => ({ url: r.url, title: r.title, visits: r.visits, typed: r.typed, last: r.last, bookmarked: !!r.bm }))
  }

  // ---- bookmarks ---------------------------------------------------------------

  bookmarks(): Bookmark[] {
    return this.db.prepare('SELECT url, title, created FROM bookmarks ORDER BY created DESC').all() as unknown as Bookmark[]
  }

  isBookmarked(url: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM bookmarks WHERE url = ?').get(url)
  }

  /** Adds or removes the bookmark. Returns whether it's bookmarked now. */
  toggleBookmark(url: string, title: string): boolean {
    if (!recordable(url)) return false
    if (this.isBookmarked(url)) {
      this.removeBookmark(url)
      return false
    }
    this.db.prepare('INSERT INTO bookmarks (url, title, created) VALUES (?, ?, ?)').run(url, clip(title, MAX_TITLE), Date.now())
    return true
  }

  removeBookmark(url: string): void {
    this.db.prepare('DELETE FROM bookmarks WHERE url = ?').run(url)
  }

  renameBookmark(url: string, title: string): void {
    this.db.prepare('UPDATE bookmarks SET title = ? WHERE url = ?').run(clip(title.trim(), MAX_TITLE), url)
  }

  // ---- site permissions --------------------------------------------------------

  permissions(): SitePermission[] {
    const rows = this.db
      .prepare('SELECT origin, permission, allow, updated FROM permissions ORDER BY origin ASC, permission ASC')
      .all() as { origin: string; permission: string; allow: number; updated: number }[]
    return rows.map((r) => ({ origin: r.origin, permission: r.permission, allow: !!r.allow, updated: r.updated }))
  }

  setPermission(origin: string, permission: string, allow: boolean, now = Date.now()): boolean {
    const norm = normalizePermissionOrigin(origin)
    if (!norm || !isAskablePermission(permission)) return false
    this.db
      .prepare(
        `INSERT INTO permissions (origin, permission, allow, updated) VALUES (?, ?, ?, ?)
         ON CONFLICT(origin, permission) DO UPDATE SET allow = excluded.allow, updated = excluded.updated`
      )
      .run(norm, permission, allow ? 1 : 0, now)
    return true
  }

  removePermission(origin: string, permission: string): void {
    const norm = normalizePermissionOrigin(origin)
    if (!norm) return
    this.db.prepare('DELETE FROM permissions WHERE origin = ? AND permission = ?').run(norm, permission)
  }
}
