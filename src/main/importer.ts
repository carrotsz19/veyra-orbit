/*
 * Read-only Chromium browser importer (Google Chrome, Microsoft Edge, Brave).
 * Discovers profiles under %LOCALAPPDATA% (or VEYRA_IMPORT_ROOT for tests), copies locked History
 * SQLite files to a temp directory before opening read-only via node:sqlite, and never modifies
 * the source browser's files.
 */

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  IMPORT_HISTORY_DAYS,
  filterChromeHistoryRows,
  parseChromeBookmarks,
  unixMsToChromeTimeUs,
  type ImportBrowserId,
  type ImportProfile,
  type ImportRequest,
  type ImportResult,
  type ImportStatus,
  type ImportedBookmark,
  type ImportedVisit,
  type RawChromeHistoryRow
} from '../shared/importer.ts'
import type { Store } from './store.ts'

interface BrowserSpec {
  id: ImportBrowserId
  name: string
  winRel: readonly string[]
  darwinRel: readonly string[]
  linuxRel: readonly string[]
}

const BROWSERS: readonly BrowserSpec[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    winRel: ['Google', 'Chrome', 'User Data'],
    darwinRel: ['Library', 'Application Support', 'Google', 'Chrome'],
    linuxRel: ['.config', 'google-chrome']
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    winRel: ['Microsoft', 'Edge', 'User Data'],
    darwinRel: ['Library', 'Application Support', 'Microsoft Edge'],
    linuxRel: ['.config', 'microsoft-edge']
  },
  {
    id: 'brave',
    name: 'Brave',
    winRel: ['BraveSoftware', 'Brave-Browser', 'User Data'],
    darwinRel: ['Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'],
    linuxRel: ['.config', 'BraveSoftware', 'Brave-Browser']
  }
]

const SKIP_DIRS = new Set([
  'System Profile',
  'Guest Profile',
  'Snapshots',
  'Crashpad',
  'GrShaderCache',
  'ShaderCache',
  'GraphiteDawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'WidevineCdm',
  'Safe Browsing',
  'component_crx_cache',
  'extensions_crx_cache'
])

export interface DiscoveredProfile extends ImportProfile {
  bookmarksPath: string | null
  historyPath: string | null
}

function isReadableFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
}

function readProfileNameMap(userDataDir: string): Map<string, string> {
  const names = new Map<string, string>()
  const raw = readJsonFile(join(userDataDir, 'Local State'))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return names
  const profile = (raw as Record<string, unknown>).profile
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return names
  const cache = (profile as Record<string, unknown>).info_cache
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return names

  for (const [dirName, meta] of Object.entries(cache as Record<string, unknown>)) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue
    const rec = meta as Record<string, unknown>
    const label = [rec.name, rec.shortcut_name, rec.gaia_name].find(
      (v): v is string => typeof v === 'string' && v.trim().length > 0
    )
    if (label) names.set(dirName, label.trim())
  }
  return names
}

function readPreferencesProfileName(profileDir: string): string | null {
  const raw = readJsonFile(join(profileDir, 'Preferences'))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const profile = (raw as Record<string, unknown>).profile
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null
  const name = (profile as Record<string, unknown>).name
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : null
}

function isSafeProfileDirName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !/[/\\:\0]/.test(name) && !SKIP_DIRS.has(name)
}

function scanUserDataDir(browser: BrowserSpec, userDataDir: string): DiscoveredProfile[] {
  if (!isDirectory(userDataDir)) return []
  const infoCache = readProfileNameMap(userDataDir)
  const candidateNames = new Set<string>(infoCache.keys())

  try {
    for (const entry of readdirSync(userDataDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name === 'Default' || /^Profile \d+$/i.test(entry.name)) {
        candidateNames.add(entry.name)
      }
    }
  } catch {
    return []
  }

  const profiles: DiscoveredProfile[] = []
  for (const dirName of candidateNames) {
    if (!isSafeProfileDirName(dirName)) continue
    const fullDir = join(userDataDir, dirName)
    if (!isDirectory(fullDir)) continue
    const bookmarksCandidate = join(fullDir, 'Bookmarks')
    const historyCandidate = join(fullDir, 'History')
    const bookmarksPath = isReadableFile(bookmarksCandidate) ? bookmarksCandidate : null
    const historyPath = isReadableFile(historyCandidate) ? historyCandidate : null
    if (!bookmarksPath && !historyPath) continue

    const profileName = infoCache.get(dirName) ?? readPreferencesProfileName(fullDir) ?? dirName
    profiles.push({
      id: `${browser.id}:${dirName}`,
      browser: browser.id,
      browserName: browser.name,
      profileDir: dirName,
      profileName,
      hasBookmarks: !!bookmarksPath,
      hasHistory: !!historyPath,
      bookmarksPath,
      historyPath
    })
  }

  profiles.sort((a, b) => {
    if (a.profileDir === 'Default' && b.profileDir !== 'Default') return -1
    if (b.profileDir === 'Default' && a.profileDir !== 'Default') return 1
    return a.profileName.localeCompare(b.profileName)
  })
  return profiles
}

/**
 * Discovers installed Chrome, Edge, and Brave profiles.
 * When `importRoot` (from VEYRA_IMPORT_ROOT) is set, ONLY that directory is inspected so tests
 * never touch the user's real browser profiles.
 */
export function discoverBrowserProfiles(opts?: {
  importRoot?: string
  localAppData?: string
  platform?: NodeJS.Platform
}): DiscoveredProfile[] {
  const importRoot = (opts?.importRoot ?? process.env.VEYRA_IMPORT_ROOT ?? '').trim()
  const platform = opts?.platform ?? process.platform
  const found: DiscoveredProfile[] = []

  if (importRoot) {
    if (!isDirectory(importRoot)) return []
    // Mirror %LOCALAPPDATA% layout under VEYRA_IMPORT_ROOT (Google/Chrome/User Data, Microsoft/Edge/User Data, ...).
    for (const browser of BROWSERS) {
      found.push(...scanUserDataDir(browser, join(importRoot, ...browser.winRel)))
    }
    if (found.length > 0) return found

    // Convenience fallback: VEYRA_IMPORT_ROOT points directly at a Chromium User Data folder.
    found.push(...scanUserDataDir(BROWSERS[0], importRoot))
    if (found.length > 0) return found

    // Convenience fallback: VEYRA_IMPORT_ROOT points directly at a single fixture profile folder.
    const bookmarksCandidate = join(importRoot, 'Bookmarks')
    const historyCandidate = join(importRoot, 'History')
    const bookmarksPath = isReadableFile(bookmarksCandidate) ? bookmarksCandidate : null
    const historyPath = isReadableFile(historyCandidate) ? historyCandidate : null
    if (bookmarksPath || historyPath) {
      found.push({
        id: 'chrome:Default',
        browser: 'chrome',
        browserName: 'Google Chrome',
        profileDir: 'Default',
        profileName: readPreferencesProfileName(importRoot) ?? 'Default',
        hasBookmarks: !!bookmarksPath,
        hasHistory: !!historyPath,
        bookmarksPath,
        historyPath
      })
    }
    return found
  }

  if (platform === 'win32') {
    const base = (opts?.localAppData ?? process.env.LOCALAPPDATA ?? '').trim()
    if (!base) return []
    for (const browser of BROWSERS) {
      found.push(...scanUserDataDir(browser, join(base, ...browser.winRel)))
    }
    return found
  }

  const home = homedir()
  if (!home) return []
  for (const browser of BROWSERS) {
    const rel = platform === 'darwin' ? browser.darwinRel : browser.linuxRel
    found.push(...scanUserDataDir(browser, join(home, ...rel)))
  }
  return found
}

export function readChromeBookmarksFromFile(bookmarksPath: string, now = Date.now()): ImportedBookmark[] {
  const raw = readJsonFile(bookmarksPath)
  return parseChromeBookmarks(raw, now)
}

function openReadOnlySqlite(tempPath: string): DatabaseSync {
  try {
    return new DatabaseSync(tempPath, { readOnly: true, readBigInts: true })
  } catch {
    // Fallback for WAL-mode copies opened without a writable -shm file.
    const normalized = tempPath.replace(/\\/g, '/')
    const uri = `file:${encodeURI(normalized).replace(/\?/g, '%3F').replace(/#/g, '%23')}?immutable=1`
    return new DatabaseSync(uri, { readOnly: true, readBigInts: true })
  }
}

/**
 * Copies a Chromium `History` SQLite database to a fresh temp folder (because Chrome/Edge lock it
 * while running), reads visits from the last `days` days in read-only mode, and deletes the copy.
 */
export function readChromeHistoryFromFile(
  historyPath: string,
  now = Date.now(),
  days = IMPORT_HISTORY_DAYS
): ImportedVisit[] {
  const tempDir = mkdtempSync(join(tmpdir(), 'orbit-import-'))
  const tempCopy = join(tempDir, 'History')
  let db: DatabaseSync | null = null
  try {
    copyFileSync(historyPath, tempCopy)
    db = openReadOnlySqlite(tempCopy)
    // Chrome timestamps (~1.34e16 us) exceed Number.MAX_SAFE_INTEGER, so bind and read as BigInt.
    const cutoffUs = unixMsToChromeTimeUs(now - Math.max(1, days) * 24 * 60 * 60 * 1000)

    let rows: RawChromeHistoryRow[]
    try {
      rows = db
        .prepare(
          `SELECT u.url AS url, u.title AS title, v.visit_time AS visit_time, u.typed_count AS typed_count
           FROM visits v
           JOIN urls u ON u.id = v.url
           WHERE v.visit_time >= ?
           ORDER BY v.visit_time ASC`
        )
        .all(cutoffUs) as unknown as RawChromeHistoryRow[]
    } catch {
      // Minimal fixtures or legacy History files that only expose the urls table.
      rows = db
        .prepare(
          `SELECT url, title, last_visit_time AS visit_time, typed_count
           FROM urls
           WHERE last_visit_time >= ?
           ORDER BY last_visit_time ASC`
        )
        .all(cutoffUs) as unknown as RawChromeHistoryRow[]
    }
    return filterChromeHistoryRows(rows, now, days)
  } finally {
    if (db) {
      try {
        db.close()
      } catch {
        /* ignore close errors */
      }
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
}

interface ImportStateFile {
  promptDismissed: boolean
}

export class BrowserImporter {
  private readonly stateFile: string
  private readonly opts?: { importRoot?: string; localAppData?: string }
  private dismissed: boolean

  constructor(stateFile: string, opts?: { importRoot?: string; localAppData?: string }) {
    this.stateFile = stateFile
    this.opts = opts
    this.dismissed = this.loadDismissed()
  }

  private loadDismissed(): boolean {
    const raw = readJsonFile(this.stateFile)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
    return (raw as Partial<ImportStateFile>).promptDismissed === true
  }

  private saveDismissed(): void {
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true })
      const data: ImportStateFile = { promptDismissed: this.dismissed }
      writeFileSync(this.stateFile, JSON.stringify(data, null, 2) + '\n', 'utf8')
    } catch {
      /* not fatal */
    }
  }

  status(): ImportStatus {
    const profiles = discoverBrowserProfiles(this.opts).map(({ bookmarksPath: _b, historyPath: _h, ...pub }) => pub)
    return {
      profiles,
      showFirstRunPrompt: !this.dismissed && profiles.length > 0
    }
  }

  dismissPrompt(): void {
    if (this.dismissed) return
    this.dismissed = true
    this.saveDismissed()
  }

  runImport(req: ImportRequest, store: Store, now = Date.now()): ImportResult {
    const discovered = discoverBrowserProfiles(this.opts)
    const profile = discovered.find((p) => p.id === req.profileId)
    if (!profile) {
      return {
        ok: false,
        browserName: '',
        profileName: '',
        bookmarksImported: 0,
        bookmarksSkipped: 0,
        historyImported: 0,
        historySkipped: 0,
        error: 'Selected browser profile was not found.'
      }
    }

    let bookmarksImported = 0
    let bookmarksSkipped = 0
    let historyImported = 0
    let historySkipped = 0

    try {
      if (req.bookmarks && profile.bookmarksPath) {
        const parsed = readChromeBookmarksFromFile(profile.bookmarksPath, now)
        const res = store.importBookmarks(parsed)
        bookmarksImported = res.imported
        bookmarksSkipped = res.skipped
      }
      if (req.history && profile.historyPath) {
        const visits = readChromeHistoryFromFile(profile.historyPath, now, IMPORT_HISTORY_DAYS)
        const res = store.importHistory(visits)
        historyImported = res.imported
        historySkipped = res.skipped
      }
    } catch (err) {
      return {
        ok: false,
        browserName: profile.browserName,
        profileName: profile.profileName,
        bookmarksImported,
        bookmarksSkipped,
        historyImported,
        historySkipped,
        error: err instanceof Error ? err.message : 'Could not read data from the selected browser.'
      }
    }

    this.dismissPrompt()
    return {
      ok: true,
      browserName: profile.browserName,
      profileName: profile.profileName,
      bookmarksImported,
      bookmarksSkipped,
      historyImported,
      historySkipped
    }
  }
}
