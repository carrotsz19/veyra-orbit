/** One tab as the browser UI sees it. The page itself lives in the main process. */
export interface TabInfo {
  id: number
  workspaceId: string
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
  /** Playing sound right now, and whether the tab's sound is off. */
  audible: boolean
  muted: boolean
  /** Discarded to free memory; wakes and reloads when activated. */
  sleeping: boolean
  /** Whether this page's address is bookmarked (the star in the address bar). */
  bookmarked: boolean
  /** Set when the last load failed; the UI shows it in place of the page. */
  error?: { code: number; description: string; url: string }
}

export interface BrowserState {
  tabs: TabInfo[]
  activeId: number | null
  /** Split groups in the active workspace (each has 2..4 tab IDs). */
  splits: import('./split').SplitGroup[]
  workspaces: import('./workspaces').WorkspaceInfo[]
  activeWorkspaceId: string
  tabCounts: Record<string, number>
  /** Direction hint for workspace switch transition: -1 (left), 0 (none), 1 (right). */
  workspaceSwitchDir: -1 | 0 | 1
  /** True when at least one closed tab can be reopened (Ctrl+Shift+T). */
  canReopenClosed: boolean
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

/** A page asking to launch an external app (mailto:, zoommtg:, ...). Opens only after the user clicks Open. */
export interface ExternalAppAsk {
  id: number
  tabId: number | null
  origin: string
  scheme: string
  appName: string
  url: string
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
  /** Folder name for grouping on the bookmark bar, or '' for top-level bar items. */
  folder?: string
  /** Display order position on the bookmark bar. */
  position?: number
  /** Optional cached favicon URL supplied by main when listing bookmarks. */
  favicon?: string
}

export type { Suggestion } from './suggest'
export type {
  AppearancePatch,
  AppearanceSettings,
  NewTabBehavior,
  SearchEngineId,
  Settings,
  SettingsPatch,
  SettingsView,
  SleepMinutes,
  StartPagePatch,
  StartPageSettings,
  StartupBehavior,
  ThemeSource,
  UpdateMode,
  WindowButtonsStyle
} from './settings'
export type {
  ClockFormat,
  DailyQuote,
  QuickLink,
  QuickLinkSize,
  StartBackgroundMode,
  StartLayout,
  StartWidgetConfig,
  StartWidgetId
} from './startpage'
export type {
  AddressBarAlign,
  BookmarkBarMode,
  MenuBarStyle,
  MotionMode,
  ResolvedAppearance,
  SidebarSide,
  TabCloseButtonsMode,
  ThemePresetId,
  UiDensity
} from './appearance'
export type { JustUpdatedNotice, UpdateState, UpdateStatus } from './updates'
export type { WorkspaceAccentId, WorkspaceCreateInput, WorkspaceIconId, WorkspaceInfo, WorkspaceUpdateInput } from './workspaces'
export type { CompactRevealState } from './compact'
export type { MenuEntry, MenuId, MenuItemEntry, MenuPopupHeader, MenuPopupSpec, MenuSection } from './menu'
export type { SplitGroup, SplitOrientation, SplitPlacement } from './split'
export type { PaletteItem, PaletteMode, PaletteOpenState, PaletteResultsPayload } from './palette'
export type { PeekAction, PeekState } from './peek'
export type { InternalUrl } from './url'
export type { MemoryTabItem, MemoryUsageSnapshot } from './memory'
export type { ImportBrowserId, ImportProfile, ImportRequest, ImportResult, ImportStatus } from './importer'
export type {
  ExtensionActionView,
  ExtensionInstallAsk,
  ExtensionPermissionDetail,
  ExtensionSource,
  ExtensionSummary,
  ExtensionsState
} from './extensions'

export type CompactPinKind = 'omnibox' | 'sidebar'
export type CompactEdgeKind = 'sidebar' | 'toolbar'

export type WinCmd =
  | 'minimize'
  | 'maximize'
  | 'close'
  | 'fullscreen'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'

export interface WindowState {
  focused: boolean
  maximized: boolean
  fullscreen: boolean
}

export interface MenuBridgeApi {
  open(spec: import('./menu').MenuPopupSpec): void
  close(): void
  onPicked(cb: (id: string) => void): () => void
  onClosed(cb: () => void): () => void
  onStep(cb: (by: -1 | 1) => void): () => void
}

/** Minimal preload bridge exposed ONLY to the floating menu BrowserWindow. */
export interface VeyraMenuWindowApi {
  ready(): void
  onRender(cb: (spec: import('./menu').MenuPopupSpec) => void): () => void
  onAppearance(cb: (tokens: import('./appearance').ResolvedAppearance) => void): () => void
  size(width: number, height: number): void
  pick(id: string): void
  step(by: -1 | 1): void
  dismiss(): void
}

/** Minimal bridge exposed ONLY to the floating Ctrl+K command palette BrowserWindow. */
export interface VeyraPaletteWindowApi {
  ready(): void
  onOpen(cb: (init: import('./palette').PaletteOpenState) => void): () => void
  onResults(cb: (payload: import('./palette').PaletteResultsPayload) => void): () => void
  onAppearance(cb: (tokens: import('./appearance').ResolvedAppearance) => void): () => void
  query(text: string): void
  pick(id: string, openInNewTab: boolean): void
  submitText(text: string, openInNewTab: boolean): void
  size(height: number): void
  dismiss(): void
}

/** Minimal bridge exposed ONLY to the floating Link Preview ("Peek") toolbar BrowserWindow. */
export interface VeyraPeekWindowApi {
  ready(): void
  onState(cb: (state: import('./peek').PeekState) => void): () => void
  onAppearance(cb: (tokens: import('./appearance').ResolvedAppearance) => void): () => void
  action(act: import('./peek').PeekAction): void
}

export interface CompactTabDragState {
  active: boolean
  tabId: number | null
  placement: import('./split').SplitPlacement | null
  shots?: Record<number, string> | null
}

/** Minimal bridge exposed ONLY to the floating compact-mode sidebar / titlebar windows. */
export interface VeyraCompactPanelApi {
  ready(): void
  onVisible(cb: (visible: boolean) => void): () => void
  onNewWorkspace(cb: () => void): () => void
  requestNewWorkspace(): void
  openSettingsSection(sectionId: string): void
  setOmniboxOpen(open: boolean): void
  startWindowDrag(): void
  moveWindowDrag(): void
  endWindowDrag(): void
  startTabDrag(tabId: number): void
  endTabDrag(): void
}

export type ClearDataRange = 'hour' | 'day' | 'all'

export interface ClearDataRequest {
  range: ClearDataRange
  history: boolean
  siteData: boolean
  cache: boolean
}

export interface StartPageSiteItem {
  url: string
  title: string
  favicon?: string
  time?: number
}

export interface StartPageData {
  topSites: StartPageSiteItem[]
  recentlyClosed: StartPageSiteItem[]
  recentHistory: StartPageSiteItem[]
  bookmarks: (Bookmark & { favicon?: string })[]
}

export interface VeyraApi {
  onState(cb: (s: BrowserState) => void): () => void
  onFocusOmnibox(cb: () => void): () => void
  onPermission(cb: (asks: PermissionAsk[]) => void): () => void
  onExternalApps(cb: (asks: ExternalAppAsk[]) => void): () => void
  onSettings(cb: (s: import('./settings').SettingsView) => void): () => void
  onAppearance(cb: (tokens: import('./appearance').ResolvedAppearance) => void): () => void
  onSavedPermissions(cb: (list: SitePermission[]) => void): () => void
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
  answerPermission(id: number, allow: boolean, remember?: boolean): void
  answerExternalApp(id: number, open: boolean): void
  find(text: string, opts?: { forward?: boolean; findNext?: boolean }): void
  stopFind(): void
  toggleMute(id: number): void
  sleepTab(id: number): void
  /** Opens the right-click menu for a tab in the sidebar. */
  tabMenu(id: number): void
  /** Splits `anchorTabId` with `otherTabId` (or adds `otherTabId` to `anchorTabId`'s split group). */
  splitWith(anchorTabId: number, otherTabId: number, placement?: import('./split').SplitPlacement): void
  /** Drops a dragged tab (including the active tab) onto an edge of the page to split. */
  splitDrop(draggedTabId: number, placement: import('./split').SplitPlacement): void
  /** Splits the active tab with the next tab in the workspace, or unsplits if already split. */
  splitWithNext(orientation?: import('./split').SplitOrientation): void
  /** Rotates a 2-pane split between left/right and top/bottom (or creates a stacked split if unsplit). */
  rotateSplit(groupId?: string): void
  /** Dissolves the split group containing `tabId` (or the active tab if omitted). */
  unsplit(tabId?: number): void
  /** Updates a split group's column or row divider ratio (0.2..0.8). */
  setSplitRatio(groupId: string, kind: 'col' | 'row', ratio: number): void
  /** Swaps panes in a split group. */
  swapSplit(groupId: string): void
  onCompactTabDrag(cb: (drag: CompactTabDragState) => void): () => void
  switchWorkspace(id: string): void
  createWorkspace(input: import('./workspaces').WorkspaceCreateInput): Promise<import('./workspaces').WorkspaceInfo | null>
  createPrivateWorkspace(): Promise<import('./workspaces').WorkspaceInfo | null>
  updateWorkspace(id: string, patch: import('./workspaces').WorkspaceUpdateInput): Promise<import('./workspaces').WorkspaceInfo | null>
  deleteWorkspace(id: string): Promise<boolean>
  onCompactState(cb: (s: import('./compact').CompactRevealState) => void): () => void
  setCompactPin(kind: CompactPinKind, pinned: boolean): void
  setCompactHover(edge: CompactEdgeKind, hovering: boolean): void
  toggleCompactMode(): void
  /** A page went full screen (true) or came back (false): the browser's UI hides meanwhile. */
  onPageFullscreen(cb: (on: boolean) => void): () => void
  pauseDownload(id: number): void
  resumeDownload(id: number): void
  cancelDownload(id: number): void
  openDownload(id: number): void
  showDownload(id: number): void
  removeDownload(id: number): void
  dragDownload(id: number): void
  clearFinishedDownloads(): void
  getSettings(): Promise<import('./settings').SettingsView | null>
  updateSettings(patch: import('./settings').SettingsPatch): Promise<import('./settings').SettingsView | null>
  chooseDownloadsDir(): Promise<import('./settings').SettingsView | null>
  exportAppearanceTheme(): Promise<{ ok: boolean; canceled?: boolean; error?: string }>
  importAppearanceTheme(): Promise<{ ok: boolean; canceled?: boolean; settings?: import('./settings').SettingsView; error?: string }>
  getStartPageData(): Promise<StartPageData>
  getStartBackground(): Promise<string | null>
  chooseStartBackground(): Promise<{ ok: boolean; canceled?: boolean; dataUrl?: string; settings?: import('./settings').SettingsView; error?: string }>
  removeStartBackground(): Promise<import('./settings').SettingsView | null>
  savedPermissions(): Promise<SitePermission[]>
  setSavedPermission(origin: string, permission: string, allow: boolean): Promise<boolean>
  removeSavedPermission(origin: string, permission: string): Promise<void>
  clearBrowsingData(req: ClearDataRequest): Promise<void>
  /** Address bar suggestions for what's typed. */
  suggest(input: string): Promise<import('./suggest').Suggestion[]>
  /**
   * Floating UI (the suggestions list or tab-drag drop zone) has to sit above the page, which is a native view.
   * Opening takes visible page views out and returns a map of tabId -> JPEG screenshot to show in their place.
   */
  overlay(open: boolean): Promise<Record<number, string> | null>
  history(query: string, before: number | null): Promise<HistoryEntry[]>
  deleteHistory(id: number): void
  /** Clears history from this many ms ago up to now; 0 clears it all. */
  clearHistory(sinceMsAgo: number): Promise<void>
  bookmarks(): Promise<Bookmark[]>
  toggleBookmark(): void
  toggleBookmarkBar(): void
  addBookmark(url: string, title: string, folder?: string): Promise<boolean>
  removeBookmark(url: string): Promise<void>
  renameBookmark(url: string, title: string, folder?: string): Promise<void>
  reorderBookmarks(order: { url: string; position: number }[]): Promise<void>
  onDataChanged(cb: () => void): () => void
  /** Sent once the UI shows the page's picture, so the real page can be taken out without a flash. */
  hidePageForOverlay(): void
  onUpdateState(cb: (s: import('./updates').UpdateState) => void): () => void
  getUpdateState(): Promise<import('./updates').UpdateState | null>
  checkForUpdates(): Promise<import('./updates').UpdateState | null>
  downloadUpdate(): Promise<import('./updates').UpdateState | null>
  installUpdate(): void
  dismissJustUpdated(): void
  reopenClosedTab(): void
  print(): void
  zoomIn(): void
  zoomOut(): void
  toggleDevTools(): void
  toggleDownloads(): void
  openFind(): void
  openPalette(mode?: import('./palette').PaletteMode): void
  openInternal(url: import('./url').InternalUrl): void
  winCmd(cmd: WinCmd): void
  relaunch(): void
  onWinState(cb: (s: WindowState) => void): () => void
  onFocusMenuBar(cb: () => void): () => void
  onOpenSettingsSection(cb: (sectionId: string) => void): () => void
  onNewWorkspaceRequest(cb: () => void): () => void
  menu: MenuBridgeApi
  getImportStatus(): Promise<import('./importer').ImportStatus>
  runImport(req: import('./importer').ImportRequest): Promise<import('./importer').ImportResult>
  dismissImportPrompt(): Promise<void>
  getMemoryUsage(): Promise<import('./memory').MemoryUsageSnapshot>
  extensions: ExtensionsApi
}

export interface ExtensionsApi {
  onState(cb: (state: import('./extensions').ExtensionsState) => void): () => void
  onActions(cb: (actions: import('./extensions').ExtensionActionView[]) => void): () => void
  onInstallAsk(cb: (asks: import('./extensions').ExtensionInstallAsk[]) => void): () => void
  getState(): Promise<import('./extensions').ExtensionsState>
  getActions(): Promise<import('./extensions').ExtensionActionView[]>
  setEnabled(id: string, enabled: boolean): Promise<boolean>
  setPinned(id: string, pinned: boolean): Promise<boolean>
  installFromStore(idOrUrl: string): Promise<{ ok: boolean; error?: string }>
  installUnpacked(): Promise<{ ok: boolean; error?: string; canceled?: boolean }>
  uninstall(id: string): Promise<boolean>
  openOptions(id: string): void
  setDeveloperMode(enabled: boolean): Promise<boolean>
  clickAction(id: string, anchorRect: Rect): void
  contextMenuAction(id: string, anchorRect: Rect): void
  answerInstall(requestId: string, allow: boolean): void
}
