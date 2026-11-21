/** One tab as the browser UI sees it. The page itself lives in the main process. */
export interface TabInfo {
  id: number
  /** '' for a new tab that hasn't gone anywhere yet (the UI shows its start page). */
  url: string
  title: string
  favicon?: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  pinned: boolean
  /** Page zoom percentage, e.g. 100 for normal size. */
  zoom: number
  /** Whether this page's address is bookmarked (the star in the address bar). */
  bookmarked: boolean
  /** Set when the last load failed; the UI shows it in place of the page. */
  error?: { code: number; description: string; url: string }
}

export interface BrowserState {
  tabs: TabInfo[]
  activeId: number | null
}

/** A site asking for something (camera, notifications, ...). Denied unless the person allows it. */
export interface PermissionAsk {
  id: number
  tabId: number | null
  origin: string
  permission: string
}

/** A remembered Allow / Block decision for one site and permission. */
export interface SitePermission {
  origin: string
  permission: string
  allow: boolean
  /** ms since 1970 */
  updated: number
}

/** Where the active page sits inside the window, in CSS pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Match counts reported by Chromium's find-in-page for the active tab. */
export interface FindState {
  activeMatch: number
  matches: number
  finalUpdate: boolean
}

export type DownloadState = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

export interface DownloadInfo {
  id: number
  filename: string
  savePath: string
  url: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number
  speed: number
  canResume: boolean
  startedAt: number
}

export interface HistoryEntry {
  id: number
  url: string
  title: string
  /** ms since 1970 */
  time: number
}

export interface Bookmark {
  url: string
  title: string
  created: number
}

export type { Suggestion } from './suggest'

export interface VeyraApi {
  onState(cb: (s: BrowserState) => void): () => void
  onFocusOmnibox(cb: () => void): () => void
  onPermission(cb: (asks: PermissionAsk[]) => void): () => void
  onDownloads(cb: (items: DownloadInfo[]) => void): () => void
  onToggleDownloads(cb: () => void): () => void
  onFindOpen(cb: () => void): () => void
  onFindClose(cb: () => void): () => void
  onFindResult(cb: (r: FindState) => void): () => void
  ready(): void
  newTab(input?: string): void
  closeTab(id: number): void
  activate(id: number): void
  navigate(id: number, input: string): void
  back(): void
  forward(): void
  reload(): void
  stop(): void
  resetZoom(): void
  togglePin(id: number): void
  move(id: number, toIndex: number): void
  setBounds(r: Rect | null): void
  answerPermission(id: number, allow: boolean): void
  find(text: string, opts?: { forward?: boolean; findNext?: boolean }): void
  stopFind(): void
  pauseDownload(id: number): void
  resumeDownload(id: number): void
  cancelDownload(id: number): void
  openDownload(id: number): void
  showDownload(id: number): void
  clearFinishedDownloads(): void
  /** Address bar suggestions for what's typed. */
  suggest(input: string): Promise<import('./suggest').Suggestion[]>
  /**
   * Floating UI (the suggestions list) has to sit above the page, which is a native view.
   * Opening takes the page out and returns a picture of it to show in its place; closing puts it back.
   */
  overlay(open: boolean): Promise<string | null>
  history(query: string, before: number | null): Promise<HistoryEntry[]>
  deleteHistory(id: number): void
  /** Clears history from this many ms ago up to now; 0 clears it all. */
  clearHistory(sinceMsAgo: number): Promise<void>
  bookmarks(): Promise<Bookmark[]>
  toggleBookmark(): void
  removeBookmark(url: string): Promise<void>
  renameBookmark(url: string, title: string): Promise<void>
  onDataChanged(cb: () => void): () => void
  /** Sent once the UI shows the page's picture, so the real page can be taken out without a flash. */
  hidePageForOverlay(): void
}
