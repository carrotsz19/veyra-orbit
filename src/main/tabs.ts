/*
 * The tabs and workspaces. Each loaded tab is its own WebContentsView (its own sandboxed Chromium
 * renderer). Only the active tab's view is in the window, placed where the UI says the page goes.
 * Restored tabs load only when opened, and idle background tabs can sleep to free memory.
 */
import { BrowserWindow, Menu, MenuItem, WebContentsView, clipboard, type Input, type WebContents } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BrowserState, Rect, TabInfo, WorkspaceCreateInput, WorkspaceInfo, WorkspaceUpdateInput } from '../shared/types'
import { INTERNAL_PAGES, buildSearchUrl, isAllowedUrl, isInternalUrl, shouldFocusOmniboxOnActivate, toUrl } from '../shared/url'
import { isSafeSubframeUrl, parseExternalAppUrl } from '../shared/external'
import { clampZoomLevel, zoomPercent } from '../shared/format'
import {
  buildSavedSession,
  createDefaultWorkspace,
  createPrivateWorkspaceEntry,
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  nextWorkspaceId,
  parseSavedSession,
  updateWorkspaceEntry,
  workspaceAtShortcut,
  workspacePartition,
  type SavedSplitGroup
} from '../shared/workspaces'
import {
  MAX_SPLIT_PANES,
  computeSplitLayout,
  dissolveSplitGroup,
  findSplitGroup,
  joinSplitGroup,
  keepSplitGroupsContiguous,
  removeTabFromSplit,
  updateSplitGroupRatio,
  type SplitGroup
} from '../shared/split'
import { canSleepTab, type SleepPolicy } from '../shared/sleep'
import { shouldPeekWindowOpen } from '../shared/peek'
import { attachPageCompat } from './compat'

interface Tab {
  info: TabInfo
  view: WebContentsView | null
  /** A restored or sleeping tab's address, loaded the next time the tab is opened. */
  pendingUrl?: string
  /** The next page this tab opens was typed in the address bar (for history ranking). */
  typed?: boolean
  /** Timestamp when this tab was last active in the window (for sleeping tabs). */
  lastActiveAt: number
  /** If set, this tab may navigate to chrome-extension://<allowedExtensionId>/... pages. */
  allowedExtensionId?: string
}

/** What the tabs tell the rest of the browser about, and ask it. */
export interface TabHooks {
  /** A page was opened in a tab. */
  visit(url: string, title: string, typed: boolean): void
  title(url: string, title: string): void
  isBookmarked(url: string): boolean
  toggleBookmark(url: string, title: string): void
  /** Current search engine URL prefix. */
  searchUrl(): string
  /** A page tried to open an allowlisted external app scheme (mailto:, zoommtg:, ...). */
  externalApp(tabId: number, pageUrl: string, targetUrl: string): void
  /** Ensures a session partition has the full security, compat and downloads setup. */
  ensureSession(partition: string): void
  /** Clears storage, cache and listeners when an ephemeral private workspace closes. */
  discardSession?(partition: string): void | Promise<void>
  /** True when a tab currently has an unanswered permission prompt. */
  hasPendingPermission(tabId: number): boolean
  /** Current sleeping-tabs policy. */
  sleepPolicy(): SleepPolicy
  /** Toggles Zen-style compact mode (Ctrl+Shift+S). */
  toggleCompactMode(): void
  /** Notifies compact mode when a native context menu opens or closes. */
  onMenuOpen?(open: boolean): void
  /** Notifies compact mode when the address bar is about to be focused. Returns true if handled externally. */
  onFocusOmnibox?(): boolean | void
  /** Focuses the title-bar menu bar when standalone Alt is pressed and released. */
  onFocusMenuBar?(): void
  /** Called whenever BrowserState is published, so floating UI panels receive the same state feed. */
  onState?(state: BrowserState): void
  /** Called when Downloads panel is toggled (Ctrl+J); returns true if handled by floating compact sidebar. */
  onToggleDownloads?(): boolean | void
  /** Called when a page enters or leaves HTML5 full screen. */
  onPageFullscreen?(on: boolean): void
  /** Opens or toggles the Ctrl+K command palette. */
  onTogglePalette?(mode: 'command' | 'new-tab'): void
  /** Called on Ctrl+T when no URL is given; returns true if handled (e.g. opening command bar in new-tab mode). */
  onNewTabShortcut?(): boolean
  /** Opens a link in the floating Peek preview window (Shift+click, Alt+click, or right-click "Peek link"). */
  openPeek?(url: string, sourceTabId: number, workspaceId: string, partition: string): void
  /** Extension lifecycle hooks. */
  onTabViewCreated?(wc: WebContents, tabId: number, partition: string): void
  onTabViewDestroyed?(wc: WebContents, tabId: number, partition: string): void
  onActiveTabChanged?(wc: WebContents | null, partition: string): void
  extensionContextMenuItems?(wc: WebContents, params: Electron.ContextMenuParams): Electron.MenuItem[]
  isLoadedExtension?(partition: string, extensionId: string): boolean
  /** Quits the application (Ctrl+Q). */
  quit?(): void
}

const ZOOM_STEP = 0.5

export class Tabs {
  private workspaces: WorkspaceInfo[] = [createDefaultWorkspace()]
  private activeWorkspaceId: string = this.workspaces[0].id
  private workspaceActiveTab = new Map<string, number>()
  private workspaceSwitchDir: -1 | 0 | 1 = 0
  private tabs: Tab[] = []
  /** Split groups per workspace ID (each group holds 2..4 tab IDs). */
  private splits = new Map<string, SplitGroup[]>()
  private nextSplitId = 1
  private activeId: number | null = null
  private nextId = 1
  private bounds: Rect | null = null
  /** The tab whose page asked for full screen (a video, a slideshow); its page fills the window. */
  private fullscreenTab: Tab | null = null
  /** True when Orbit put the window into full screen for the page (vs the user pressing F11 first). */
  private fullscreenByPage = false
  private attachedViews = new Set<WebContentsView>()
  private closed: { url: string; title: string; pinned: boolean; workspaceId: string }[] = []
  private emitQueued = false
  private saveTimer: NodeJS.Timeout | null = null
  private sleepTimer: NodeJS.Timeout | null = null
  private findOpen = false
  private findQuery = ''

  /** Called when a tab closes or leaves its page, so its open permission questions can be dropped. */
  onTabGone: (id: number) => void = () => {}
  /** While true, floating UI is open above the page, so the page view is taken out. */
  private overlayOpen = false
  /** Tracks whether the last focused target was the active web page or the browser UI (for Edit menu). */
  private lastFocusTarget: 'ui' | 'page' = 'ui'
  /** Tracks a standalone Alt key press so Alt-release focuses the menu bar without clashing with Alt+Left/Tab. */
  private altStandalone = false
  /** Tracks held Shift/Alt modifiers for Shift+click and Alt+click link preview ("peek"). */
  private shiftHeld = false
  private altHeld = false
  private lastAltAt = 0

  constructor(
    private win: BrowserWindow,
    private sessionFile: string,
    private hooks: TabHooks
  ) {
    this.refreshSleepPolicy()
    this.win.webContents.on('focus', () => {
      this.lastFocusTarget = 'ui'
    })
    this.win.on('blur', () => {
      this.altStandalone = false
      this.shiftHeld = false
      this.altHeld = false
    })
  }

  // ---- reading ------------------------------------------------------------

  state(): BrowserState {
    const wsTabs = this.workspaceTabs(this.activeWorkspaceId)
    const tabCounts: Record<string, number> = {}
    for (const ws of this.workspaces) tabCounts[ws.id] = 0
    for (const t of this.tabs) tabCounts[t.info.workspaceId] = (tabCounts[t.info.workspaceId] ?? 0) + 1
    return {
      tabs: wsTabs.map((t) => ({ ...t.info, bookmarked: !!t.info.url && this.hooks.isBookmarked(t.info.url) })),
      activeId: this.activeId,
      splits: this.workspaceSplits(this.activeWorkspaceId).map((g) => ({ ...g, tabIds: [...g.tabIds] })),
      workspaces: this.workspaces.map((w) => ({ ...w })),
      activeWorkspaceId: this.activeWorkspaceId,
      tabCounts,
      workspaceSwitchDir: this.workspaceSwitchDir,
      canReopenClosed: !this.isPrivateWorkspace(this.activeWorkspaceId) && this.closed.length > 0
    }
  }

  private workspaceSplits(wsId = this.activeWorkspaceId): SplitGroup[] {
    return this.splits.get(wsId) ?? []
  }

  private setWorkspaceSplits(wsId: string, groups: SplitGroup[]): void {
    if (groups.length) this.splits.set(wsId, groups)
    else this.splits.delete(wsId)
  }

  private splitGroupOf(tabId: number | null): SplitGroup | undefined {
    if (tabId === null) return undefined
    const tab = this.get(tabId)
    if (!tab) return undefined
    return findSplitGroup(this.workspaceSplits(tab.info.workspaceId), tabId)
  }

  /** Returns the currently visible tabs (1 for normal view, 2..4 when active tab is in a split group). */
  private visibleTabs(): Tab[] {
    const active = this.active
    if (!active) return []
    const group = this.splitGroupOf(active.info.id)
    if (!group) return [active]
    const panes = group.tabIds.map((id) => this.get(id)).filter((t): t is Tab => !!t && t.info.workspaceId === active.info.workspaceId)
    return panes.length >= 2 ? panes : [active]
  }

  private isVisibleTab(tabId: number): boolean {
    return this.visibleTabs().some((t) => t.info.id === tabId)
  }

  /** Returns the current bounds of all attached web views (useful for diagnostics/tests). */
  attachedViewBounds(): Rect[] {
    const out: Rect[] = []
    for (const v of this.attachedViews) {
      if (!v.webContents.isDestroyed()) out.push(v.getBounds())
    }
    return out
  }

  /** All tabs across all workspaces, for omnibox "Switch to tab" suggestions. */
  allTabs(): TabInfo[] {
    return this.tabs.map((t) => ({ ...t.info, bookmarked: !!t.info.url && this.hooks.isBookmarked(t.info.url) }))
  }

  /**
   * Tabs eligible for omnibox "Switch to tab" suggestions.
   * Private workspace tabs never leak into normal workspaces or other private workspaces.
   */
  suggestableTabs(): TabInfo[] {
    return this.tabs
      .filter((t) => !this.isPrivateWorkspace(t.info.workspaceId) || t.info.workspaceId === this.activeWorkspaceId)
      .map((t) => ({ ...t.info, bookmarked: !!t.info.url && this.hooks.isBookmarked(t.info.url) }))
  }

  isPrivateWorkspace(wsId: string): boolean {
    return !!this.workspaces.find((w) => w.id === wsId)?.private
  }

  isPrivateTab(tabId: number | null): boolean {
    if (tabId === null) return false
    const tab = this.get(tabId)
    return !!tab && this.isPrivateWorkspace(tab.info.workspaceId)
  }

  /** All session partitions currently configured by workspaces. */
  workspacePartitions(): string[] {
    const out = new Set<string>()
    for (const ws of this.workspaces) out.add(workspacePartition(ws))
    return [...out]
  }

  tabIdOf(wc: WebContents): number | null {
    return this.tabs.find((t) => t.view?.webContents === wc)?.info.id ?? null
  }

  activePartition(): string {
    return this.partitionFor(this.activeWorkspaceId)
  }

  activeWebContents(): WebContents | null {
    const tab = this.active
    if (!tab || !this.showsPage(tab) || !tab.view || tab.view.webContents.isDestroyed()) return null
    return tab.view.webContents
  }

  tabDetailsForWebContents(wc: WebContents): { pinned: boolean; index: number; discarded: boolean; active: boolean } | null {
    const tab = this.tabs.find((t) => t.view?.webContents === wc)
    if (!tab) return null
    const wsTabs = this.workspaceTabs(tab.info.workspaceId)
    return {
      pinned: tab.info.pinned,
      index: wsTabs.indexOf(tab),
      discarded: tab.info.sleeping,
      active: tab.info.id === this.activeId
    }
  }

  activateByWebContents(wc: WebContents): void {
    const tab = this.tabs.find((t) => t.view?.webContents === wc)
    if (tab) this.activate(tab.info.id)
  }

  closeByWebContents(wc: WebContents): void {
    const tab = this.tabs.find((t) => t.view?.webContents === wc)
    if (tab) this.close(tab.info.id)
  }

  authorizeExtensionTabNavigation(wc: WebContents, extensionId: string): void {
    const tab = this.tabs.find((t) => t.view?.webContents === wc)
    if (tab) tab.allowedExtensionId = extensionId
  }

  private isUrlAllowedForTab(tab: Tab, url: string): boolean {
    if (isAllowedUrl(url)) return true
    if (!tab.allowedExtensionId || !url.startsWith('chrome-extension://')) return false
    try {
      const u = new URL(url)
      if (u.hostname !== tab.allowedExtensionId) return false
      const partition = this.partitionFor(tab.info.workspaceId)
      return this.hooks.isLoadedExtension ? this.hooks.isLoadedExtension(partition, tab.allowedExtensionId) : true
    } catch {
      return false
    }
  }

  /** Creates a tab on behalf of a Chrome extension (supports http(s) and that extension's own chrome-extension:// pages). */
  createExtensionTab(
    url: string,
    opts: { activate?: boolean; partition: string; ownerExtensionId?: string }
  ): WebContents | null {
    const ws =
      this.workspaces.find((w) => workspacePartition(w) === opts.partition && w.id === this.activeWorkspaceId) ??
      this.workspaces.find((w) => workspacePartition(w) === opts.partition) ??
      this.workspaces.find((w) => w.id === this.activeWorkspaceId)
    if (!ws) return null
    const id = this.create('', { workspaceId: ws.id, activate: opts.activate !== false })
    const tab = this.get(id)
    if (!tab) return null
    if (opts.ownerExtensionId) tab.allowedExtensionId = opts.ownerExtensionId
    const view = this.ensureView(tab)
    if (url && this.isUrlAllowedForTab(tab, url)) {
      tab.info.url = url
      void view.webContents.loadURL(url).catch(() => {})
      this.layout()
      this.changed()
    }
    return view.webContents
  }

  private notifyActiveTab(): void {
    const partition = this.partitionFor(this.activeWorkspaceId)
    this.hooks.onActiveTabChanged?.(this.activeWebContents(), partition)
  }

  private get(id: number): Tab | undefined {
    return this.tabs.find((t) => t.info.id === id)
  }

  private get active(): Tab | undefined {
    return this.activeId === null ? undefined : this.get(this.activeId)
  }

  private workspaceTabs(wsId = this.activeWorkspaceId): Tab[] {
    return this.tabs.filter((t) => t.info.workspaceId === wsId)
  }

  private partitionFor(workspaceId: string): string {
    const ws = this.workspaces.find((w) => w.id === workspaceId)
    return ws ? workspacePartition(ws) : workspacePartition(createDefaultWorkspace())
  }

  // ---- view lifecycle -----------------------------------------------------

  private createView(tab: Tab): WebContentsView {
    const partition = this.partitionFor(tab.info.workspaceId)
    this.hooks.ensureSession(partition)
    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        safeDialogs: true,
        // Chromium's built-in PDF viewer.
        plugins: true
      }
    })
    view.setBackgroundColor('#ffffffff')
    this.radius(view, 10)
    if (tab.info.muted) view.webContents.setAudioMuted(true)
    attachPageCompat(view.webContents, tab.info.url || tab.pendingUrl)
    this.wire(tab, view)
    this.hooks.onTabViewCreated?.(view.webContents, tab.info.id, partition)
    return view
  }

  private ensureView(tab: Tab): WebContentsView {
    if (!tab.view || tab.view.webContents.isDestroyed()) {
      tab.view = this.createView(tab)
    }
    return tab.view
  }

  private destroyView(tab: Tab): void {
    const view = tab.view
    if (!view) return
    tab.view = null
    const partition = this.partitionFor(tab.info.workspaceId)
    if (!view.webContents.isDestroyed()) {
      this.hooks.onTabViewDestroyed?.(view.webContents, tab.info.id, partition)
    }
    if (this.attachedViews.has(view)) {
      if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view)
      this.attachedViews.delete(view)
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  // ---- workspaces ---------------------------------------------------------

  switchWorkspace(id: string, explicitDir?: -1 | 1): void {
    if (id === this.activeWorkspaceId) return
    const prevIdx = this.workspaces.findIndex((w) => w.id === this.activeWorkspaceId)
    const nextIdx = this.workspaces.findIndex((w) => w.id === id)
    if (nextIdx < 0) return

    const dir: -1 | 1 = explicitDir ?? (nextIdx > prevIdx ? 1 : -1)
    const now = Date.now()
    for (const vt of this.visibleTabs()) vt.lastActiveAt = now
    this.stopFind(true)
    if (this.fullscreenTab) this.exitPageFullscreen(true)

    this.activeWorkspaceId = id
    this.workspaceSwitchDir = dir
    this.hooks.ensureSession(this.partitionFor(id))

    const wsTabs = this.workspaceTabs(id)
    const remembered = this.workspaceActiveTab.get(id)
    const target = (remembered !== undefined ? wsTabs.find((t) => t.info.id === remembered) : undefined) ?? wsTabs[0]
    if (target) {
      this.activate(target.info.id, true)
    } else {
      this.activeId = null
      this.create('', { workspaceId: id, activate: true })
    }
  }

  createWorkspace(input: WorkspaceCreateInput): WorkspaceInfo {
    const { workspaces, created } = createWorkspaceEntry(this.workspaces, input)
    this.workspaces = workspaces
    this.hooks.ensureSession(workspacePartition(created))
    this.switchWorkspace(created.id, 1)
    return { ...created }
  }

  createPrivateWorkspace(): WorkspaceInfo {
    const { workspaces, created } = createPrivateWorkspaceEntry(this.workspaces)
    this.workspaces = workspaces
    this.hooks.ensureSession(workspacePartition(created))
    this.switchWorkspace(created.id, 1)
    return { ...created }
  }

  updateWorkspace(id: string, patch: WorkspaceUpdateInput): WorkspaceInfo | null {
    const { workspaces, updated, isolationChanged } = updateWorkspaceEntry(this.workspaces, id, patch)
    if (!updated) return null
    this.workspaces = workspaces
    this.workspaceSwitchDir = 0

    if (isolationChanged) {
      this.hooks.ensureSession(workspacePartition(updated))
      for (const tab of this.workspaceTabs(id)) {
        const currentUrl = tab.pendingUrl ?? (tab.info.error?.url || tab.info.url)
        if (tab.view) {
          this.onTabGone(tab.info.id)
          this.destroyView(tab)
        }
        if (currentUrl && isAllowedUrl(currentUrl) && !tab.info.error) {
          if (this.isVisibleTab(tab.info.id)) {
            tab.info.sleeping = false
            tab.pendingUrl = undefined
            const view = this.ensureView(tab)
            void view.webContents.loadURL(currentUrl).catch(() => {})
          } else {
            tab.pendingUrl = currentUrl
            tab.info.loading = false
            tab.info.audible = false
          }
        }
      }
      this.layout()
    }
    this.changed()
    return { ...updated }
  }

  deleteWorkspace(id: string): boolean {
    const existing = this.workspaces.find((w) => w.id === id)
    const { workspaces, deleted, nextActiveId } = deleteWorkspaceEntry(this.workspaces, id, this.activeWorkspaceId)
    if (!deleted) return false

    const wasActive = this.activeWorkspaceId === id
    if (wasActive) {
      this.stopFind(true)
      if (this.fullscreenTab && this.fullscreenTab.info.workspaceId === id) this.exitPageFullscreen(true)
    }

    const toClose = this.workspaceTabs(id)
    for (const tab of toClose) {
      if (this.fullscreenTab === tab) this.fullscreenTab = null
      this.onTabGone(tab.info.id)
      this.destroyView(tab)
    }
    this.tabs = this.tabs.filter((t) => t.info.workspaceId !== id)
    this.splits.delete(id)
    this.closed = this.closed.filter((c) => c.workspaceId !== id)
    this.workspaceActiveTab.delete(id)
    this.workspaces = workspaces
    if (existing?.private) {
      void this.hooks.discardSession?.(workspacePartition(existing))
    }

    if (wasActive) {
      this.activeWorkspaceId = nextActiveId
      this.workspaceSwitchDir = -1
      this.activeId = null
      const nextTabs = this.workspaceTabs(nextActiveId)
      const remembered = this.workspaceActiveTab.get(nextActiveId)
      const target = (remembered !== undefined ? nextTabs.find((t) => t.info.id === remembered) : undefined) ?? nextTabs[0]
      if (target) this.activate(target.info.id, true)
      else this.create('', { workspaceId: nextActiveId, activate: true })
    } else {
      this.workspaceSwitchDir = 0
      this.changed()
    }
    return true
  }

  // ---- making and closing tabs -------------------------------------------

  /** A new tab. With no URL it shows the start page. */
  create(
    url = '',
    opts: { activate?: boolean; after?: number; pinned?: boolean; lazy?: boolean; title?: string; workspaceId?: string } = {}
  ): number {
    const workspaceId =
      opts.workspaceId && this.workspaces.some((w) => w.id === opts.workspaceId) ? opts.workspaceId : this.activeWorkspaceId
    const id = this.nextId++
    const now = Date.now()
    const tab: Tab = {
      view: null,
      lastActiveAt: now,
      info: {
        id,
        workspaceId,
        url,
        title: opts.title ?? (isInternalUrl(url) ? INTERNAL_PAGES[url] : ''),
        loading: false,
        canGoBack: false,
        canGoForward: false,
        pinned: !!opts.pinned,
        bookmarked: false,
        zoom: 100,
        audible: false,
        muted: false,
        sleeping: false
      }
    }

    const at = opts.after !== undefined ? this.tabs.findIndex((t) => t.info.id === opts.after) + 1 : this.tabs.length
    this.tabs.splice(at > 0 ? at : this.tabs.length, 0, tab)
    this.sortPinned(workspaceId)

    if (url && isAllowedUrl(url)) {
      if (opts.lazy) {
        tab.pendingUrl = url
      } else {
        const view = this.ensureView(tab)
        void view.webContents.loadURL(url).catch(() => {})
      }
    }

    if (opts.activate !== false) {
      if (workspaceId !== this.activeWorkspaceId) {
        this.activeWorkspaceId = workspaceId
        this.workspaceSwitchDir = 0
      }
      this.activate(id)
    } else {
      this.changed()
    }
    return id
  }

  close(id: number): void {
    const tab = this.get(id)
    if (!tab) return
    const wsId = tab.info.workspaceId
    const wsBefore = this.workspaceTabs(wsId)
    const wsIndex = wsBefore.findIndex((t) => t.info.id === id)
    const prevGroup = this.splitGroupOf(id)
    const siblingInGroup = prevGroup ? prevGroup.tabIds.find((tid) => tid !== id) : undefined

    if (this.activeId === id) this.stopFind(true)
    if (this.fullscreenTab?.info.id === id) {
      const restoreWindow = this.fullscreenByPage
      this.fullscreenTab = null
      this.fullscreenByPage = false
      if (restoreWindow && this.win.isFullScreen()) this.win.setFullScreen(false)
      if (!this.win.isDestroyed()) this.win.webContents.send('page-fullscreen', false)
    }

    const globalIdx = this.tabs.indexOf(tab)
    if (globalIdx >= 0) this.tabs.splice(globalIdx, 1)
    if (prevGroup) {
      this.setWorkspaceSplits(wsId, removeTabFromSplit(this.workspaceSplits(wsId), id))
    }
    if (tab.info.url && !this.isPrivateWorkspace(wsId)) {
      this.closed.push({ url: tab.info.url, title: tab.info.title, pinned: tab.info.pinned, workspaceId: wsId })
      if (this.closed.length > 25) this.closed.shift()
    }
    this.onTabGone(id)
    this.destroyView(tab)

    const wsAfter = this.workspaceTabs(wsId)
    const preferredNext =
      (siblingInGroup !== undefined ? wsAfter.find((t) => t.info.id === siblingInGroup) : undefined) ??
      wsAfter[wsIndex] ??
      wsAfter[wsIndex - 1]
    if (this.workspaceActiveTab.get(wsId) === id) {
      if (preferredNext) this.workspaceActiveTab.set(wsId, preferredNext.info.id)
      else this.workspaceActiveTab.delete(wsId)
    }

    if (this.activeId === id) {
      this.activeId = null
      if (preferredNext) this.activate(preferredNext.info.id)
    } else if (prevGroup && this.activeId !== null && prevGroup.tabIds.includes(this.activeId)) {
      this.layout()
    }

    if (wsId === this.activeWorkspaceId && !wsAfter.length) {
      this.create('', { workspaceId: wsId })
    }
    this.workspaceSwitchDir = 0
    this.changed()
  }

  reopenClosed(): void {
    if (this.isPrivateWorkspace(this.activeWorkspaceId)) return
    let idx = -1
    for (let i = this.closed.length - 1; i >= 0; i--) {
      if (this.closed[i].workspaceId === this.activeWorkspaceId) {
        idx = i
        break
      }
    }
    if (idx < 0) idx = this.closed.length - 1
    if (idx < 0) return
    const [last] = this.closed.splice(idx, 1)
    this.create(last.url, { pinned: last.pinned, title: last.title, workspaceId: this.activeWorkspaceId })
  }

  private wakeTab(tab: Tab, now: number): void {
    tab.lastActiveAt = now
    if (tab.info.sleeping) {
      tab.info.sleeping = false
      if (!tab.pendingUrl && this.showsPage(tab)) tab.pendingUrl = tab.info.url
    }
    if (tab.pendingUrl) {
      const url = tab.pendingUrl
      tab.pendingUrl = undefined
      if (isAllowedUrl(url)) {
        const view = this.ensureView(tab)
        void view.webContents.loadURL(url).catch(() => {})
      }
    }
  }

  activate(id: number, keepSwitchDir = false): void {
    const tab = this.get(id)
    if (!tab) return
    const now = Date.now()
    const prevVisible = this.visibleTabs()
    if (this.active && this.active.info.id !== id) {
      for (const vt of prevVisible) vt.lastActiveAt = now
      this.stopFind(true)
      if (this.fullscreenTab) this.exitPageFullscreen(true)
    }
    if (tab.info.workspaceId !== this.activeWorkspaceId) {
      const prevIdx = this.workspaces.findIndex((w) => w.id === this.activeWorkspaceId)
      const nextIdx = this.workspaces.findIndex((w) => w.id === tab.info.workspaceId)
      this.activeWorkspaceId = tab.info.workspaceId
      if (!keepSwitchDir) this.workspaceSwitchDir = nextIdx > prevIdx ? 1 : -1
    } else if (!keepSwitchDir) {
      this.workspaceSwitchDir = 0
    }

    this.activeId = id
    this.workspaceActiveTab.set(tab.info.workspaceId, id)

    for (const vt of this.visibleTabs()) {
      this.wakeTab(vt, now)
    }

    this.layout()
    this.notifyActiveTab()
    this.changed()
    if (this.showsPage(tab) && tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.focus()
    } else if (shouldFocusOmniboxOnActivate(tab.info)) {
      // Queue after changed()'s setImmediate so the renderer receives the new active tab state
      // before focus-omnibox arrives.
      setImmediate(() => {
        if (this.activeId === id && !this.win.isDestroyed()) this.focusOmnibox()
      })
    } else if (!this.win.isDestroyed()) {
      this.win.webContents.focus()
    }
  }

  /** Focuses another visible pane when the user clicks inside its WebContentsView. */
  private focusPane(id: number): void {
    const tab = this.get(id)
    if (!tab || id === this.activeId || !this.isVisibleTab(id)) return
    const now = Date.now()
    if (this.active) this.active.lastActiveAt = now
    this.stopFind(true)
    this.activeId = id
    this.workspaceActiveTab.set(tab.info.workspaceId, id)
    tab.lastActiveAt = now
    this.lastFocusTarget = 'page'
    this.workspaceSwitchDir = 0
    this.notifyActiveTab()
    this.changed()
  }

  navigate(id: number, input: string, typed = false): void {
    const tab = this.get(id)
    const url = toUrl(input, this.hooks.searchUrl())
    if (!tab || !url) return
    tab.pendingUrl = undefined
    tab.info.sleeping = false
    tab.info.url = url
    tab.info.error = undefined
    tab.lastActiveAt = Date.now()

    if (isInternalUrl(url)) {
      if (this.fullscreenTab === tab) this.exitPageFullscreen(true)
      // One of Orbit's own pages: the UI draws it, the web view stays where it was.
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.stop()
      tab.info.title = INTERNAL_PAGES[url]
      tab.info.favicon = undefined
      tab.info.loading = false
      // Back returns to the page that was open underneath.
      tab.info.canGoBack = !!(tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.getURL())
      tab.info.canGoForward = false
      this.layout()
      this.win.webContents.focus()
      this.notifyActiveTab()
      this.changed()
      return
    }
    tab.typed = typed
    const view = this.ensureView(tab)
    void view.webContents.loadURL(url).catch(() => {})
    this.layout()
    view.webContents.focus()
    this.notifyActiveTab()
    this.changed()
  }

  /** Opens one of Orbit's own pages, reusing a tab in the active workspace that already shows it. */
  openInternal(url: keyof typeof INTERNAL_PAGES): void {
    const wsTabs = this.workspaceTabs(this.activeWorkspaceId)
    const open = wsTabs.find((t) => t.info.url === url)
    if (open) return this.activate(open.info.id)
    const blank = this.active && !this.active.info.url ? this.active : undefined
    if (blank) this.navigate(blank.info.id, url)
    else this.create(url)
  }

  toggleBookmark(): void {
    const tab = this.active
    if (!tab || !/^https?:/.test(tab.info.url) || tab.info.error) return
    this.hooks.toggleBookmark(tab.info.url, tab.info.title)
    this.changed()
  }

  /**
   * A navigation in a tab turned out to be a file download. A tab opened only for it closes (as in
   * Chrome); a tab that already had a page goes back to showing that page's address.
   */
  downloadStarted(wc: WebContents): void {
    const tab = this.tabs.find((t) => t.view?.webContents === wc)
    if (!tab) return
    const committed = wc.getURL()
    tab.info.loading = false
    if (!committed) {
      // Closed a moment later, once the download is under way on its own.
      setTimeout(() => {
        if (this.tabs.includes(tab) && !wc.isDestroyed() && !wc.getURL()) this.close(tab.info.id)
      }, 400)
    } else if (!isInternalUrl(tab.info.url)) {
      tab.info.url = committed
      tab.info.title = wc.getTitle()
    }
    this.changed()
  }

  /** Tells the UI to read state again (after a bookmark changed elsewhere). */
  refresh(): void {
    this.workspaceSwitchDir = 0
    this.changed()
  }

  /**
   * Floating UI opens or closes above the page. Opening returns a map of tabId -> JPEG data URL
   * for every visible pane so the UI can show screenshots in their place while real views hide.
   */
  async setOverlay(open: boolean): Promise<Record<number, string> | null> {
    if (!open) {
      this.overlayOpen = false
      this.layout()
      return null
    }
    const shots: Record<number, string> = {}
    for (const tab of this.visibleTabs()) {
      const view = tab.view
      if (view && this.attachedViews.has(view) && !view.webContents.isDestroyed()) {
        try {
          const img = await view.webContents.capturePage()
          if (!img.isEmpty()) shots[tab.info.id] = 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64')
        } catch {
          /* ignore capture failure */
        }
      }
    }
    this.overlayOpen = true
    return Object.keys(shots).length ? shots : null
  }

  /** Takes the page out once the UI is showing its picture (sent after setOverlay(true)). */
  hidePageForOverlay(): void {
    if (this.overlayOpen) this.layout()
  }

  togglePin(id: number): void {
    const tab = this.get(id)
    if (!tab) return
    tab.info.pinned = !tab.info.pinned
    if (tab.info.pinned) {
      const wsId = tab.info.workspaceId
      const prev = this.workspaceSplits(wsId)
      const next = removeTabFromSplit(prev, id)
      if (next.length !== prev.length || prev.some((g, i) => g.tabIds.length !== next[i]?.tabIds.length)) {
        this.setWorkspaceSplits(wsId, next)
        this.layout()
      }
    }
    this.sortPinned(tab.info.workspaceId)
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      ;(tab.view.webContents as unknown as { emit(ev: string): void }).emit('tab-updated')
    }
    this.workspaceSwitchDir = 0
    this.changed()
  }

  move(id: number, toIndex: number): void {
    const tab = this.get(id)
    if (!tab) return
    const wsId = tab.info.workspaceId
    const wsTabs = this.workspaceTabs(wsId)
    const from = wsTabs.findIndex((t) => t.info.id === id)
    if (from < 0) return
    const [moved] = wsTabs.splice(from, 1)
    wsTabs.splice(Math.max(0, Math.min(toIndex, wsTabs.length)), 0, moved)
    const pinned = wsTabs.filter((t) => t.info.pinned)
    const unpinned = keepSplitGroupsContiguous(
      wsTabs.filter((t) => !t.info.pinned),
      (t) => t.info.id,
      this.workspaceSplits(wsId)
    )
    this.replaceWorkspaceTabs(wsId, [...pinned, ...unpinned])
    this.workspaceSwitchDir = 0
    this.changed()
  }

  /** Pinned tabs always sit at the top within each workspace, and split groups stay contiguous. */
  private sortPinned(wsId: string): void {
    const wsTabs = this.workspaceTabs(wsId)
    const pinned = wsTabs.filter((t) => t.info.pinned)
    const unpinned = keepSplitGroupsContiguous(
      wsTabs.filter((t) => !t.info.pinned),
      (t) => t.info.id,
      this.workspaceSplits(wsId)
    )
    this.replaceWorkspaceTabs(wsId, [...pinned, ...unpinned])
  }

  // ---- split view ---------------------------------------------------------

  /** Splits `anchorId` with `otherId` (or adds `otherId` to `anchorId`'s split group, up to 4 panes). */
  splitTabs(anchorId: number, otherId: number, placement: 'left' | 'right' = 'right', focusId = otherId): boolean {
    const anchor = this.get(anchorId)
    const other = this.get(otherId)
    if (!anchor || !other || anchorId === otherId) return false
    if (anchor.info.workspaceId !== other.info.workspaceId) return false
    const wsId = anchor.info.workspaceId

    // Split panes live in the regular tab strip so combined rows stay clean.
    if (anchor.info.pinned) anchor.info.pinned = false
    if (other.info.pinned) other.info.pinned = false

    const current = this.workspaceSplits(wsId)
    const { groups, group } = joinSplitGroup(current, anchorId, otherId, placement, () => `split-${this.nextSplitId++}`)
    if (!group) return false

    this.setWorkspaceSplits(wsId, groups)
    this.sortPinned(wsId)
    if (this.fullscreenTab) this.exitPageFullscreen(true)
    this.activate(focusId)
    return true
  }

  /** Ctrl+Shift+\: splits the active tab with the next tab in the workspace, or unsplits if already split. */
  splitWithNext(): void {
    const active = this.active
    if (!active) return
    if (this.splitGroupOf(active.info.id)) {
      this.unsplit(active.info.id)
      return
    }
    const wsTabs = this.workspaceTabs(active.info.workspaceId).filter((t) => !t.info.pinned)
    let partner: Tab | undefined
    if (wsTabs.length >= 2) {
      const idx = wsTabs.findIndex((t) => t.info.id === active.info.id)
      partner = idx >= 0 ? wsTabs[(idx + 1) % wsTabs.length] : wsTabs[0]
      if (partner?.info.id === active.info.id) partner = wsTabs.find((t) => t.info.id !== active.info.id)
    }
    if (!partner) {
      const otherAny = this.workspaceTabs(active.info.workspaceId).find((t) => t.info.id !== active.info.id)
      if (otherAny) {
        partner = otherAny
      } else {
        const createdId = this.create('', { workspaceId: active.info.workspaceId, activate: false, after: active.info.id })
        partner = this.get(createdId)
      }
    }
    if (partner) this.splitTabs(active.info.id, partner.info.id, 'right', partner.info.id)
  }

  /** Dissolves the split group containing `tabId` (or the active tab). */
  unsplit(tabId?: number): void {
    const targetId = tabId ?? this.activeId
    const group = this.splitGroupOf(targetId)
    const tab = targetId !== null ? this.get(targetId) : undefined
    if (!group || !tab) return
    const wsId = tab.info.workspaceId
    this.setWorkspaceSplits(wsId, dissolveSplitGroup(this.workspaceSplits(wsId), group.id))
    this.layout()
    this.workspaceSwitchDir = 0
    this.changed()
  }

  /** Removes one tab from its split group without dissolving the remaining panes (when >2). */
  removeFromSplit(tabId: number): void {
    const tab = this.get(tabId)
    if (!tab) return
    const wsId = tab.info.workspaceId
    const prev = this.workspaceSplits(wsId)
    if (!findSplitGroup(prev, tabId)) return
    this.setWorkspaceSplits(wsId, removeTabFromSplit(prev, tabId))
    this.layout()
    this.workspaceSwitchDir = 0
    this.changed()
  }

  setSplitRatio(groupId: string, kind: 'col' | 'row', ratio: number): void {
    const wsId = this.activeWorkspaceId
    const prev = this.workspaceSplits(wsId)
    if (!prev.some((g) => g.id === groupId)) return
    this.setWorkspaceSplits(wsId, updateSplitGroupRatio(prev, groupId, kind, ratio))
    this.layout()
    this.workspaceSwitchDir = 0
    this.changed()
  }

  swapSplit(groupId: string): void {
    const wsId = this.activeWorkspaceId
    const prev = this.workspaceSplits(wsId)
    const idx = prev.findIndex((g) => g.id === groupId)
    if (idx < 0) return
    const next = prev.map((g, i) =>
      i === idx ? { ...g, tabIds: [...g.tabIds.slice(1), g.tabIds[0]] } : { ...g, tabIds: [...g.tabIds] }
    )
    this.setWorkspaceSplits(wsId, next)
    this.sortPinned(wsId)
    this.layout()
    this.workspaceSwitchDir = 0
    this.changed()
  }

  private replaceWorkspaceTabs(wsId: string, ordered: Tab[]): void {
    let cursor = 0
    this.tabs = this.tabs.map((t) => (t.info.workspaceId === wsId ? ordered[cursor++] : t))
  }

  // ---- sleeping tabs ------------------------------------------------------

  refreshSleepPolicy(): void {
    if (this.sleepTimer) {
      clearInterval(this.sleepTimer)
      this.sleepTimer = null
    }
    const { timeoutMs } = this.hooks.sleepPolicy()
    if (timeoutMs <= 0) return
    const intervalMs = Math.max(250, Math.min(30_000, Math.floor(timeoutMs / 4)))
    this.sleepTimer = setInterval(() => this.sweepSleepingTabs(), intervalMs)
  }

  private canSleep(tab: Tab, manual: boolean, now = Date.now()): boolean {
    return canSleepTab(
      {
        isActive: this.isVisibleTab(tab.info.id),
        sleeping: tab.info.sleeping,
        hasLoadedWebView: !!tab.view && !tab.view.webContents.isDestroyed(),
        url: tab.info.url,
        hasError: !!tab.info.error,
        audible: tab.info.audible,
        pinned: tab.info.pinned,
        hasPendingPermission: this.hooks.hasPendingPermission(tab.info.id),
        hasActiveFind: this.findOpen && this.activeId === tab.info.id,
        isFullscreen: this.fullscreenTab === tab,
        lastActiveAt: tab.lastActiveAt
      },
      this.hooks.sleepPolicy(),
      now,
      manual
    )
  }

  sweepSleepingTabs(now = Date.now()): number {
    let slept = 0
    for (const tab of this.tabs) {
      if (this.canSleep(tab, false, now)) {
        if (this.sleepTab(tab.info.id, false)) slept++
      }
    }
    return slept
  }

  sleepTab(id: number, manual = true): boolean {
    const tab = this.get(id)
    if (!tab || !this.canSleep(tab, manual)) return false
    tab.pendingUrl = tab.info.url
    tab.info.sleeping = true
    tab.info.loading = false
    tab.info.audible = false
    tab.info.canGoBack = false
    tab.info.canGoForward = false
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      ;(tab.view.webContents as unknown as { emit(ev: string): void }).emit('tab-updated')
    }
    this.destroyView(tab)
    this.workspaceSwitchDir = 0
    this.changed()
    return true
  }

  // ---- the active page ----------------------------------------------------

  back(): void {
    const tab = this.active
    const wc = tab?.view?.webContents
    if (!tab || !wc || wc.isDestroyed()) return
    if (isInternalUrl(tab.info.url)) {
      // Leave the Orbit page for the web page underneath it, if there is one.
      const under = wc.getURL()
      if (!under) return
      tab.info.url = under
      tab.info.title = wc.getTitle()
      tab.info.canGoBack = wc.navigationHistory.canGoBack()
      tab.info.canGoForward = wc.navigationHistory.canGoForward()
      this.layout()
      wc.focus()
      this.changed()
      return
    }
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  forward(): void {
    const wc = this.active?.view?.webContents
    if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(hard = false): void {
    const tab = this.active
    if (!tab) return
    if (tab.info.error) return this.navigate(tab.info.id, tab.info.error.url)
    if (!tab.info.url || isInternalUrl(tab.info.url)) return
    const view = this.ensureView(tab)
    if (hard) view.webContents.reloadIgnoringCache()
    else view.webContents.reload()
  }

  stop(): void {
    const wc = this.active?.view?.webContents
    if (wc && !wc.isDestroyed()) wc.stop()
  }

  private zoom(delta: number | null, tab = this.active): void {
    if (!tab || !this.showsPage(tab) || !tab.view || tab.view.webContents.isDestroyed()) return
    const wc = tab.view.webContents
    const next = delta === null ? 0 : clampZoomLevel(wc.getZoomLevel() + delta)
    wc.setZoomLevel(next)
    tab.info.zoom = zoomPercent(next)
    this.changed()
  }

  zoomIn(): void {
    this.zoom(ZOOM_STEP)
  }

  zoomOut(): void {
    this.zoom(-ZOOM_STEP)
  }

  resetZoom(): void {
    this.zoom(null)
  }

  toggleDevTools(): void {
    const tab = this.active
    if (!tab || !this.showsPage(tab) || !tab.view || tab.view.webContents.isDestroyed()) return
    tab.view.webContents.toggleDevTools()
  }

  /** Runs an Edit menu command against whichever surface (active web page or browser UI) last had focus. */
  editCommand(cmd: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'): void {
    const tab = this.active
    const usePage =
      this.lastFocusTarget === 'page' &&
      !!tab &&
      this.showsPage(tab) &&
      !!tab.view &&
      !tab.view.webContents.isDestroyed()
    const target = usePage ? tab!.view!.webContents : this.win.webContents
    if (target.isDestroyed()) return
    target.focus()
    target[cmd]()
  }

  setBounds(r: Rect | null): void {
    this.bounds =
      r && r.width > 0 && r.height > 0
        ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
        : null
    this.layout()
  }

  /** A tab shows its page once it has one that loaded; otherwise the UI shows the start or error page. */
  private showsPage(tab: Tab): boolean {
    return !!tab.info.url && !tab.info.error && !isInternalUrl(tab.info.url)
  }

  /** Puts visible tab page view(s) in the window (or takes them out), at the place the UI gave. */
  private layout(): void {
    if (this.win.isDestroyed()) return
    const desired = new Map<WebContentsView, { rect: Rect; radius: number }>()

    if (this.bounds && !this.overlayOpen) {
      if (this.fullscreenTab && this.fullscreenTab.view && !this.fullscreenTab.view.webContents.isDestroyed() && this.showsPage(this.fullscreenTab)) {
        const [width, height] = this.win.getContentSize()
        desired.set(this.fullscreenTab.view, { rect: { x: 0, y: 0, width, height }, radius: 0 })
      } else {
        const vis = this.visibleTabs()
        const group = this.activeId !== null ? this.splitGroupOf(this.activeId) : undefined
        const splitLayout = computeSplitLayout(
          this.bounds,
          vis.length,
          group ? { colRatio: group.colRatio, rowRatio: group.rowRatio } : {}
        )
        for (let i = 0; i < vis.length; i++) {
          const tab = vis[i]
          const slot = splitLayout.panes[i]
          if (slot && tab.view && !tab.view.webContents.isDestroyed() && this.showsPage(tab)) {
            desired.set(tab.view, { rect: slot.view, radius: 10 })
          }
        }
      }
    }

    for (const view of [...this.attachedViews]) {
      if (!desired.has(view)) {
        this.win.contentView.removeChildView(view)
        this.attachedViews.delete(view)
      }
    }

    for (const [view, cfg] of desired) {
      if (!this.attachedViews.has(view)) {
        this.win.contentView.addChildView(view)
        this.attachedViews.add(view)
      }
      view.setBounds(cfg.rect)
      this.radius(view, cfg.radius)
    }
  }

  private radius(view: WebContentsView, r: number): void {
    try {
      view.setBorderRadius(r)
    } catch {
      /* older Electron: square corners */
    }
  }

  // ---- full screen ------------------------------------------------------------

  isPageFullscreen(): boolean {
    return !!this.fullscreenTab
  }

  /** A page went full screen (or came back). The window follows, and the browser's own UI hides. */
  private setPageFullscreen(tab: Tab, on: boolean): void {
    if (on) {
      if (this.fullscreenTab !== tab) this.fullscreenByPage = !this.win.isFullScreen()
      this.fullscreenTab = tab
      if (!this.win.isFullScreen()) this.win.setFullScreen(true)
    } else if (this.fullscreenTab === tab) {
      const restoreWindow = this.fullscreenByPage
      this.fullscreenTab = null
      this.fullscreenByPage = false
      if (restoreWindow && this.win.isFullScreen()) this.win.setFullScreen(false)
    }
    if (!this.win.isDestroyed()) this.win.webContents.send('page-fullscreen', !!this.fullscreenTab)
    this.hooks.onPageFullscreen?.(!!this.fullscreenTab)
    this.layout()
  }

  /** The window left full screen (Esc, F11, or switching tab): the page leaves it too. */
  exitPageFullscreen(leaveWindow = false): void {
    const tab = this.fullscreenTab
    if (!tab) return
    const restoreWindow = leaveWindow && this.fullscreenByPage
    this.fullscreenTab = null
    this.fullscreenByPage = false
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      void tab.view.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true).catch(() => {})
    }
    if (restoreWindow && this.win.isFullScreen()) this.win.setFullScreen(false)
    if (!this.win.isDestroyed()) this.win.webContents.send('page-fullscreen', false)
    this.hooks.onPageFullscreen?.(false)
    this.layout()
  }

  /** The window changed size: a full screen page follows it. */
  relayout(): void {
    this.layout()
  }

  // ---- sound, printing, tab menu ----------------------------------------------

  toggleMute(id: number): void {
    const tab = this.get(id)
    if (!tab) return
    const wc = tab.view?.webContents
    if (wc && !wc.isDestroyed()) {
      wc.setAudioMuted(!wc.isAudioMuted())
      tab.info.muted = wc.isAudioMuted()
      tab.info.audible = wc.isCurrentlyAudible()
    } else {
      tab.info.muted = !tab.info.muted
    }
    this.changed()
  }

  print(): void {
    const tab = this.active
    if (!tab || !this.showsPage(tab) || !tab.view || tab.view.webContents.isDestroyed()) return
    tab.view.webContents.print({}, () => {})
  }

  duplicate(id: number): void {
    const tab = this.get(id)
    const url = tab?.pendingUrl ?? tab?.info.url
    if (tab && url) this.create(url, { after: id, title: tab.info.title, workspaceId: tab.info.workspaceId })
  }

  closeOthers(id: number): void {
    const tab = this.get(id)
    if (!tab) return
    for (const t of [...this.workspaceTabs(tab.info.workspaceId)]) {
      if (t.info.id !== id && !t.info.pinned) this.close(t.info.id)
    }
  }

  /** The right-click menu for a tab in the sidebar. */
  tabMenu(id: number): void {
    const tab = this.get(id)
    if (!tab) return
    const wsTabs = this.workspaceTabs(tab.info.workspaceId)
    const muted = tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents.isAudioMuted() : tab.info.muted
    const tabGroup = this.splitGroupOf(id)
    const activeTab = this.active
    const activeGroup = activeTab ? this.splitGroupOf(activeTab.info.id) : undefined
    const sameWsAsActive = !!activeTab && activeTab.info.workspaceId === tab.info.workspaceId
    const canSplitWithActive =
      sameWsAsActive &&
      activeTab!.info.id !== id &&
      (!activeGroup || (!activeGroup.tabIds.includes(id) && activeGroup.tabIds.length < MAX_SPLIT_PANES))

    const splitItems: Electron.MenuItemConstructorOptions[] = []
    if (canSplitWithActive) {
      splitItems.push({
        label: activeGroup ? 'Add to split view' : 'Split with active tab',
        click: () => this.splitTabs(activeTab!.info.id, id, 'right', id)
      })
    } else if (!tabGroup && activeTab?.info.id === id) {
      splitItems.push({
        label: 'Split with next tab',
        accelerator: 'CmdOrCtrl+Shift+\\',
        click: () => this.splitWithNext()
      })
    }
    if (tabGroup) {
      splitItems.push({ label: 'Swap panes', click: () => this.swapSplit(tabGroup.id) })
      if (tabGroup.tabIds.length > 2) {
        splitItems.push({ label: 'Remove from split', click: () => this.removeFromSplit(id) })
      }
      splitItems.push({ label: 'Unsplit', click: () => this.unsplit(id) })
    }

    this.hooks.onMenuOpen?.(true)
    Menu.buildFromTemplate([
      { label: 'New tab', click: () => this.create('', { workspaceId: tab.info.workspaceId }) },
      { type: 'separator' },
      ...(splitItems.length ? [...splitItems, { type: 'separator' as const }] : []),
      {
        label: 'Reload',
        enabled: this.showsPage(tab),
        click: () => {
          const wasDeferred = !!tab.pendingUrl || tab.info.sleeping
          this.activate(id)
          if (!wasDeferred) this.reload()
        }
      },
      { label: 'Duplicate', enabled: !!(tab.pendingUrl || tab.info.url), click: () => this.duplicate(id) },
      { label: tab.info.pinned ? 'Unpin tab' : 'Pin tab', click: () => this.togglePin(id) },
      { label: muted ? 'Unmute tab' : 'Mute tab', click: () => this.toggleMute(id) },
      { label: 'Sleep tab', enabled: this.canSleep(tab, true), click: () => this.sleepTab(id, true) },
      { type: 'separator' },
      { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => this.close(id) },
      {
        label: 'Close other tabs',
        enabled: wsTabs.some((t) => t.info.id !== id && !t.info.pinned),
        click: () => this.closeOthers(id)
      },
      { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', enabled: this.closed.length > 0, click: () => this.reopenClosed() }
    ]).popup({
      window: this.win,
      callback: () => this.hooks.onMenuOpen?.(false)
    })
  }

  focusOmnibox(): void {
    if (this.fullscreenTab) this.exitPageFullscreen(true)
    if (this.hooks.onFocusOmnibox?.() === true) return
    this.win.webContents.focus()
    this.win.webContents.send('focus-omnibox')
  }

  toggleDownloads(): void {
    if (this.fullscreenTab) this.exitPageFullscreen(true)
    if (this.hooks.onToggleDownloads?.() === true) return
    if (!this.win.isDestroyed()) this.win.webContents.send('downloads:toggle')
  }

  openFind(): void {
    if (!this.active || !this.showsPage(this.active)) return
    if (this.fullscreenTab) this.exitPageFullscreen(true)
    this.findOpen = true
    this.win.webContents.focus()
    this.win.webContents.send('find:open')
  }

  find(text: string, opts?: { forward?: boolean; findNext?: boolean }): void {
    const tab = this.active
    if (!tab || !this.showsPage(tab) || !tab.view || tab.view.webContents.isDestroyed()) return
    this.findOpen = true
    this.findQuery = text
    if (!text) {
      tab.view.webContents.stopFindInPage('clearSelection')
      if (!this.win.isDestroyed()) this.win.webContents.send('find:result', { activeMatch: 0, matches: 0, finalUpdate: true })
      return
    }
    tab.view.webContents.findInPage(text, {
      forward: opts?.forward ?? true,
      findNext: opts?.findNext ?? true
    })
  }

  stopFind(notifyUi = false): void {
    const tab = this.active
    const wasOpen = this.findOpen || this.findQuery !== ''
    this.findOpen = false
    this.findQuery = ''
    if (tab?.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.stopFindInPage('clearSelection')
    }
    if (notifyUi) {
      if (wasOpen && !this.win.isDestroyed()) this.win.webContents.send('find:close')
    } else if (tab && this.showsPage(tab) && tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.focus()
    }
  }

  private findStep(forward: boolean): void {
    if (this.findOpen && this.findQuery) this.find(this.findQuery, { forward, findNext: false })
    else this.openFind()
  }

  // ---- keyboard -------------------------------------------------------------

  /**
   * Intercepts Alt+click on a link (which Chromium turns into SaveLinkAs / will-download)
   * and opens it in the floating Peek preview window instead of downloading the page.
   */
  consumeAltPeek(wc: WebContents, url: string): boolean {
    if (!this.altHeld && Date.now() - this.lastAltAt > 450) return false
    if (!isAllowedUrl(url)) return false
    const tab = this.tabs.find((t) => t.view?.webContents === wc)
    if (!tab) return false
    this.altStandalone = false
    this.altHeld = false
    this.hooks.openPeek?.(url, tab.info.id, tab.info.workspaceId, this.partitionFor(tab.info.workspaceId))
    return true
  }

  /** Browser shortcuts, from the UI or from a page. True when one was used. */
  shortcut(input: Input): boolean {
    const isShift = input.key === 'Shift' || input.code === 'ShiftLeft' || input.code === 'ShiftRight'
    const isAlt = input.key === 'Alt' || input.code === 'AltLeft' || input.code === 'AltRight'
    if (input.type === 'keyUp') {
      if (isShift) this.shiftHeld = false
      if (isAlt) {
        this.altHeld = false
        this.lastAltAt = Date.now()
        if (this.altStandalone) {
          this.altStandalone = false
          this.hooks.onFocusMenuBar?.()
          return true
        }
      }
      return false
    }
    if (input.type !== 'keyDown') return false
    if (isShift) {
      this.shiftHeld = true
      this.altStandalone = false
      return false
    }
    if (isAlt) {
      this.altHeld = true
      this.lastAltAt = Date.now()
      if (!input.control && !input.meta && !input.shift && !input.isAutoRepeat) this.altStandalone = true
      else this.altStandalone = false
      return false
    }
    this.shiftHeld = input.shift
    this.altHeld = input.alt
    this.altStandalone = false

    const mod = process.platform === 'darwin' ? input.meta : input.control
    const key = input.key.toLowerCase()
    const run = (f: () => void): true => (f(), true)

    // Workspace shortcuts: Ctrl+Alt+1..9 and Ctrl+Alt+Left/Right
    if (mod && input.alt && !input.shift) {
      if (key === 'arrowleft') {
        const next = nextWorkspaceId(this.workspaces, this.activeWorkspaceId, -1)
        return run(() => next && this.switchWorkspace(next, -1))
      }
      if (key === 'arrowright') {
        const next = nextWorkspaceId(this.workspaces, this.activeWorkspaceId, 1)
        return run(() => next && this.switchWorkspace(next, 1))
      }
      const digitMatch = /^[1-9]$/.exec(key) ?? /^Digit([1-9])$/.exec(input.code)
      if (digitMatch) {
        const n = Number(digitMatch[1] ?? digitMatch[0])
        const ws = workspaceAtShortcut(this.workspaces, n)
        return run(() => ws && this.switchWorkspace(ws.id))
      }
    }

    if (mod && !input.alt) {
      if (key === 'q' && !input.shift) return run(() => this.hooks.quit?.())
      if (key === 'k' && !input.shift) return run(() => this.hooks.onTogglePalette?.('command'))
      if (key === 'n' && input.shift) return run(() => this.createPrivateWorkspace())
      if (key === 's' && input.shift) return run(() => this.hooks.toggleCompactMode())
      if (input.shift && (key === '\\' || key === '|' || input.code === 'Backslash')) return run(() => this.splitWithNext())
      if (key === 't' && input.shift) return run(() => this.reopenClosed())
      if (key === 't') return run(() => { if (!this.hooks.onNewTabShortcut?.()) this.create() })
      if (key === 'w') return run(() => this.activeId !== null && this.close(this.activeId))
      if (key === 'l') return run(() => this.focusOmnibox())
      if (key === 'f') return run(() => this.openFind())
      if (key === 'j') return run(() => this.toggleDownloads())
      if (key === 'h') return run(() => this.openInternal('orbit://history'))
      if (key === 'o' && input.shift) return run(() => this.openInternal('orbit://bookmarks'))
      if (key === ',') return run(() => this.openInternal('orbit://settings'))
      if (key === 'd') return run(() => this.toggleBookmark())
      if (key === 'r') return run(() => this.reload(input.shift))
      if (key === 'tab') return run(() => this.cycle(input.shift ? -1 : 1))
      if (key === 'pagedown') return run(() => this.cycle(1))
      if (key === 'pageup') return run(() => this.cycle(-1))
      if (key === '=' || key === '+') return run(() => this.zoom(ZOOM_STEP))
      if (key === '-') return run(() => this.zoom(-ZOOM_STEP))
      if (key === '0') return run(() => this.zoom(null))
      if (/^[1-9]$/.test(key)) {
        const wsTabs = this.workspaceTabs(this.activeWorkspaceId)
        const n = Number(key)
        const tab = n === 9 ? wsTabs[wsTabs.length - 1] : wsTabs[n - 1]
        return run(() => tab && this.activate(tab.info.id))
      }
    }
    if (input.alt && !mod) {
      if (key === 'arrowleft') return run(() => this.back())
      if (key === 'arrowright') return run(() => this.forward())
    }
    if (key === 'f3' && !mod && !input.alt) return run(() => this.findStep(!input.shift))
    if (mod && !input.alt && !input.shift && key === 'p') return run(() => this.print())
    if (key === 'f11' && !mod) return run(() => this.win.setFullScreen(!this.win.isFullScreen()))
    if (key === 'f5') return run(() => this.reload(mod))
    if (key === 'f12') return run(() => this.active?.view?.webContents.toggleDevTools())
    if (key === 'browserback') return run(() => this.back())
    if (key === 'browserforward') return run(() => this.forward())
    return false
  }

  private cycle(dir: number): void {
    const wsTabs = this.workspaceTabs(this.activeWorkspaceId)
    if (!wsTabs.length) return
    const i = wsTabs.findIndex((t) => t.info.id === this.activeId)
    const next = wsTabs[(i + dir + wsTabs.length) % wsTabs.length]
    this.activate(next.info.id)
  }

  // ---- page events ----------------------------------------------------------

  private wire(tab: Tab, view: WebContentsView): void {
    const wc = view.webContents
    const info = tab.info
    const isCurrent = (): boolean => tab.view === view && !wc.isDestroyed()

    const sync = (): void => {
      if (!isCurrent()) return
      const url = wc.getURL()
      // An Orbit page sits on top of whatever the tab had; the old page can't take its place.
      if (isInternalUrl(info.url)) return this.changed()
      if (url) info.url = url
      info.canGoBack = wc.navigationHistory.canGoBack()
      info.canGoForward = wc.navigationHistory.canGoForward()
      info.zoom = Math.round(wc.getZoomFactor() * 100)
      this.changed()
    }

    wc.on('focus', () => {
      if (!isCurrent()) return
      this.lastFocusTarget = 'page'
      if (info.id !== this.activeId && this.isVisibleTab(info.id)) {
        this.focusPane(info.id)
      }
    })
    wc.on('before-mouse-event', (_e, mouse) => {
      if (!isCurrent()) return
      if (mouse.type === 'mouseDown') {
        this.lastFocusTarget = 'page'
        if (mouse.modifiers?.includes('shift')) this.shiftHeld = true
        if (mouse.modifiers?.includes('alt')) {
          this.altHeld = true
          this.lastAltAt = Date.now()
          this.altStandalone = false
        }
        if (info.id !== this.activeId && this.isVisibleTab(info.id)) {
          this.focusPane(info.id)
        }
      }
    })
    wc.on('before-input-event', (e, input) => {
      if (this.shortcut(input)) e.preventDefault()
    })
    wc.on('zoom-changed', (_e, direction) => {
      if (!isCurrent()) return
      this.zoom(direction === 'in' ? ZOOM_STEP : -ZOOM_STEP, tab)
    })

    // Only web addresses (or same-extension pages on extension-owned tabs): no file:, javascript:, chrome: and the like. Allowlisted external apps ask first.
    wc.on('will-navigate', (e, url) => {
      if (!this.isUrlAllowedForTab(tab, url)) {
        e.preventDefault()
        if (parseExternalAppUrl(url)) this.hooks.externalApp(info.id, wc.getURL(), url)
      }
    })
    wc.on('will-redirect', (e, url) => {
      if (!this.isUrlAllowedForTab(tab, url)) {
        e.preventDefault()
        if (parseExternalAppUrl(url)) this.hooks.externalApp(info.id, wc.getURL(), url)
      }
    })
    wc.on('will-frame-navigate', (details) => {
      if (details.isMainFrame) return
      if (!isSafeSubframeUrl(details.url)) {
        details.preventDefault()
        if (parseExternalAppUrl(details.url)) this.hooks.externalApp(info.id, wc.getURL(), details.url)
      }
    })

    // Links that open a new tab become a tab in the same workspace. Shift+click opens a floating
    // Peek preview. Real pop-ups (window.open with explicit features, e.g. "Sign in with ...") stay pop-ups.
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (!isAllowedUrl(url)) {
        if (parseExternalAppUrl(url)) this.hooks.externalApp(info.id, wc.getURL(), url)
        return { action: 'deny' }
      }
      if (shouldPeekWindowOpen(disposition, features, this.shiftHeld)) {
        this.shiftHeld = false
        const partition = this.partitionFor(info.workspaceId)
        this.hooks.openPeek?.(url, info.id, info.workspaceId, partition)
        return { action: 'deny' }
      }
      if (disposition === 'new-window') {
        const partition = this.partitionFor(info.workspaceId)
        this.hooks.ensureSession(partition)
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            width: 520,
            height: 680,
            webPreferences: {
              partition,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              webSecurity: true
            }
          }
        }
      }
      this.create(url, { activate: disposition !== 'background-tab', after: info.id, workspaceId: info.workspaceId })
      return { action: 'deny' }
    })
    wc.on('did-create-window', (popup, details) => {
      attachPageCompat(popup.webContents, details.url)
      popup.webContents.on('will-navigate', (e, url) => {
        if (!isAllowedUrl(url)) {
          e.preventDefault()
          if (parseExternalAppUrl(url)) this.hooks.externalApp(info.id, popup.webContents.getURL() || wc.getURL(), url)
        }
      })
      popup.webContents.on('will-redirect', (e, url) => {
        if (!isAllowedUrl(url)) {
          e.preventDefault()
          if (parseExternalAppUrl(url)) this.hooks.externalApp(info.id, popup.webContents.getURL() || wc.getURL(), url)
        }
      })
      popup.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedUrl(url)) this.create(url, { after: info.id, workspaceId: info.workspaceId })
        else if (parseExternalAppUrl(url)) this.hooks.externalApp(info.id, popup.webContents.getURL() || wc.getURL(), url)
        return { action: 'deny' }
      })
    })

    wc.on('did-start-loading', () => {
      if (!isCurrent()) return
      info.loading = true
      if (info.error) {
        info.error = undefined
        this.layout()
      }
      this.changed()
    })
    wc.on('did-stop-loading', () => {
      if (!isCurrent()) return
      info.loading = false
      sync()
    })
    wc.on('did-start-navigation', (details) => {
      if (!isCurrent()) return
      if (details.isMainFrame && !details.isSameDocument) {
        info.favicon = undefined
        // A question from the page you're leaving is answered no.
        this.onTabGone(info.id)
        if (info.id === this.activeId) this.stopFind(true)
      }
    })
    wc.on('found-in-page', (_e, result) => {
      if (!isCurrent()) return
      if (info.id !== this.activeId || !this.findOpen || !this.findQuery) return
      if (!this.win.isDestroyed()) {
        this.win.webContents.send('find:result', {
          activeMatch: result.activeMatchOrdinal,
          matches: result.matches,
          finalUpdate: result.finalUpdate
        })
      }
    })
    wc.on('did-navigate', (_e, url) => {
      if (!isCurrent()) return
      sync()
      // Pages that answered (even with 404) count as a visit, as in Chrome; failed loads and private workspaces don't.
      if (!this.isPrivateWorkspace(info.workspaceId)) {
        this.hooks.visit(url, wc.getTitle(), !!tab.typed)
      }
      tab.typed = false
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isCurrent()) return
      sync()
      if (isMainFrame && !this.isPrivateWorkspace(info.workspaceId)) {
        this.hooks.visit(url, wc.getTitle(), false)
      }
    })
    wc.on('page-title-updated', (_e, title) => {
      if (!isCurrent()) return
      info.title = title
      if (!this.isPrivateWorkspace(info.workspaceId)) {
        this.hooks.title(wc.getURL(), title)
      }
      this.changed()
    })
    wc.on('page-favicon-updated', (_e, icons) => {
      if (!isCurrent()) return
      info.favicon = icons.find((u) => /^(https?|data):/.test(u))
      this.changed()
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isCurrent()) return
      // -3 is "aborted": you clicked something else, or stopped it.
      if (!isMainFrame || code === -3) return
      if (this.fullscreenTab === tab) this.exitPageFullscreen(true)
      if (info.id === this.activeId) this.stopFind(true)
      info.loading = false
      info.error = { code, description, url }
      info.url = url
      this.layout()
      this.changed()
    })
    wc.on('render-process-gone', (_e, details) => {
      if (!isCurrent()) return
      if (details.reason === 'clean-exit') return
      if (this.fullscreenTab === tab) this.exitPageFullscreen(true)
      if (info.id === this.activeId) this.stopFind(true)
      info.loading = false
      info.error = { code: -1, description: 'PAGE_CRASHED', url: info.url }
      this.layout()
      this.changed()
    })
    wc.on('context-menu', (_e, p) => isCurrent() && this.contextMenu(tab, view, p))
    wc.on('enter-html-full-screen', () => isCurrent() && this.setPageFullscreen(tab, true))
    wc.on('leave-html-full-screen', () => isCurrent() && this.setPageFullscreen(tab, false))
    wc.on('audio-state-changed', (e) => {
      if (!isCurrent()) return
      info.audible = e.audible
      info.muted = wc.isAudioMuted()
      this.changed()
    })
  }

  private contextMenu(tab: Tab, view: WebContentsView, p: Electron.ContextMenuParams): void {
    const wc = view.webContents
    const wsId = tab.info.workspaceId
    const items: Electron.MenuItemConstructorOptions[] = []
    const gap = (): void => {
      if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' })
    }

    if (p.misspelledWord) {
      for (const s of p.dictionarySuggestions.slice(0, 4)) items.push({ label: s, click: () => wc.replaceMisspelling(s) })
      items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) })
      gap()
    }
    if (p.linkURL && isAllowedUrl(p.linkURL)) {
      items.push(
        { label: 'Open link in new tab', click: () => this.create(p.linkURL, { activate: false, after: tab.info.id, workspaceId: wsId }) },
        {
          label: 'Peek link',
          click: () => this.hooks.openPeek?.(p.linkURL, tab.info.id, wsId, this.partitionFor(wsId))
        },
        { label: 'Copy link', click: () => clipboard.writeText(p.linkURL) }
      )
      gap()
    }
    if (p.mediaType === 'image' && isAllowedUrl(p.srcURL)) {
      items.push(
        { label: 'Open image in new tab', click: () => this.create(p.srcURL, { activate: false, after: tab.info.id, workspaceId: wsId }) },
        { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) },
        { label: 'Save image…', click: () => wc.downloadURL(p.srcURL) }
      )
      gap()
    }
    if (p.isEditable) {
      items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' })
      gap()
    } else if (p.selectionText.trim()) {
      const text = p.selectionText.trim()
      const short = text.length > 24 ? text.slice(0, 24) + '…' : text
      items.push(
        { role: 'copy' },
        { label: `Search for “${short}”`, click: () => this.create(buildSearchUrl(text, this.hooks.searchUrl()), { after: tab.info.id, workspaceId: wsId }) }
      )
      gap()
    }
    if (!p.linkURL && !p.isEditable && !p.selectionText.trim()) {
      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() }
      )
      gap()
    }
    const extMenuItems = this.hooks.extensionContextMenuItems?.(wc, p) ?? []
    if (!p.linkURL && !p.isEditable && !p.selectionText.trim() && p.mediaType === 'none') {
      items.push({ label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => wc.print({}, () => {}) })
      gap()
    }
    items.push({ label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) })
    const menu = Menu.buildFromTemplate(items)
    if (extMenuItems.length > 0) {
      const insertAt = Math.max(0, menu.items.length - 1)
      menu.insert(insertAt, new MenuItem({ type: 'separator' }))
      let offset = insertAt
      for (const extItem of extMenuItems) {
        menu.insert(offset++, extItem)
      }
      if (insertAt > 0 && menu.items[insertAt - 1]?.type !== 'separator') {
        menu.insert(insertAt, new MenuItem({ type: 'separator' }))
      }
    }
    this.hooks.onMenuOpen?.(true)
    menu.popup({
      window: this.win,
      callback: () => this.hooks.onMenuOpen?.(false)
    })
  }

  // ---- telling the UI, and remembering ---------------------------------------

  private changed(): void {
    if (!this.emitQueued) {
      this.emitQueued = true
      setImmediate(() => {
        this.emitQueued = false
        if (!this.win.isDestroyed()) {
          const st = this.state()
          this.win.webContents.send('state', st)
          this.hooks.onState?.(st)
        }
      })
    }
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 800)
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.sleepTimer) {
      clearInterval(this.sleepTimer)
      this.sleepTimer = null
    }
    for (const tab of this.tabs) {
      this.destroyView(tab)
    }
    for (const ws of this.workspaces) {
      if (ws.private) void this.hooks.discardSession?.(workspacePartition(ws))
    }
  }

  /** Writes non-private workspaces and open tabs to disk, so they come back next time. */
  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const data = buildSavedSession(this.workspaces, this.activeWorkspaceId, (wsId) => {
      const wsTabs = this.workspaceTabs(wsId)
      const kept = wsTabs.filter((t) => t.info.url || t.pendingUrl)
      const activeTabId = wsId === this.activeWorkspaceId ? this.activeId : this.workspaceActiveTab.get(wsId)
      const indexById = new Map<number, number>()
      kept.forEach((t, idx) => indexById.set(t.info.id, idx))
      const splits: SavedSplitGroup[] = []
      for (const group of this.workspaceSplits(wsId)) {
        const indices = group.tabIds
          .map((tid) => indexById.get(tid))
          .filter((idx): idx is number => idx !== undefined && !kept[idx].info.pinned)
        if (indices.length >= 2) splits.push({ tabs: indices, colRatio: group.colRatio, rowRatio: group.rowRatio })
      }
      return {
        tabs: kept.map((t) => ({
          url: t.pendingUrl ?? (t.info.error?.url || t.info.url),
          title: t.info.title,
          pinned: t.info.pinned
        })),
        active: Math.max(0, kept.findIndex((t) => t.info.id === activeTabId)),
        splits
      }
    })
    try {
      mkdirSync(dirname(this.sessionFile), { recursive: true })
      writeFileSync(this.sessionFile, JSON.stringify(data))
    } catch {
      /* not fatal: tabs just won't come back */
    }
  }

  /** Opens last time's workspaces and tabs (without loading them yet), or a clean new tab. */
  restore(restoreTabs = true): void {
    let raw: unknown = null
    try {
      raw = JSON.parse(readFileSync(this.sessionFile, 'utf8')) as unknown
    } catch {
      raw = null
    }
    const saved = parseSavedSession(raw)
    this.workspaces = saved.workspaces.map(({ tabs: _t, active: _a, ...info }) => info)
    this.activeWorkspaceId = saved.activeWorkspaceId
    this.workspaceSwitchDir = 0

    // Lazy-load isolated workspace sessions only when they are first activated/used.
    this.hooks.ensureSession(this.partitionFor(this.activeWorkspaceId))

    if (!restoreTabs) {
      this.create('', { workspaceId: this.activeWorkspaceId, activate: true })
      return
    }

    for (const ws of saved.workspaces) {
      if (!ws.tabs.length) continue
      const ids = ws.tabs.map((t) =>
        this.create(t.url, { activate: false, lazy: true, pinned: t.pinned, title: t.title, workspaceId: ws.id })
      )
      if (ws.splits?.length) {
        const groups: SplitGroup[] = []
        for (const sp of ws.splits) {
          const tabIds = sp.tabs.map((idx) => ids[idx]).filter((tid): tid is number => tid !== undefined)
          if (tabIds.length >= 2) {
            groups.push({
              id: `split-${this.nextSplitId++}`,
              tabIds,
              colRatio: sp.colRatio,
              rowRatio: sp.rowRatio
            })
          }
        }
        if (groups.length) {
          this.setWorkspaceSplits(ws.id, groups)
          this.sortPinned(ws.id)
        }
      }
      const activeIdx = Math.max(0, Math.min(ws.active, ids.length - 1))
      this.workspaceActiveTab.set(ws.id, ids[activeIdx])
    }

    const activeTabId = this.workspaceActiveTab.get(this.activeWorkspaceId)
    if (activeTabId !== undefined) {
      this.activate(activeTabId)
    } else {
      this.create('', { workspaceId: this.activeWorkspaceId, activate: true })
    }
  }
}
