import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, webContents, type IpcMainEvent, type IpcMainInvokeEvent, type Session } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'
import type {
  ClearDataRange,
  CompactPinKind,
  CompactRevealState,
  ExternalAppAsk,
  PermissionAsk,
  Rect,
  WinCmd,
  WindowState,
  WorkspaceCreateInput,
  WorkspaceUpdateInput
} from '../shared/types'
import { isAllowedUrl, isInternalUrl, toUrl } from '../shared/url'
import { suggest, type Candidate } from '../shared/suggest'
import {
  computeCompactWindowDrag,
  computeCompactZones,
  computeEdgeSnap,
  computeRestoreDragBounds,
  type ScreenPoint,
  type WindowBounds
} from '../shared/compact'
import { resolveSleepTimeoutMs } from '../shared/sleep'
import { WORKSPACE_ACCENTS } from '../shared/workspaces'
import {
  buildPaletteResults,
  resolveTypedPaletteText,
  type PaletteAction,
  type PaletteContext,
  type PaletteMode
} from '../shared/palette'
import { PEEK_TAB_ID, isPeekAction } from '../shared/peek'
import { shouldLoadExtensionsForPartition } from '../shared/extensions'
import {
  DEFAULT_APPEARANCE,
  exportAppearanceJson,
  parseImportedAppearanceJson,
  resolveAppearanceTokens,
  type ResolvedAppearance
} from '../shared/appearance'
import { Tabs } from './tabs'
import { Store } from './store'
import { SettingsStore } from './settings'
import { ExternalApps, Permissions, WEB_PARTITION, cleanUserAgent, hardenAll, sessionForPartition } from './security'
import { attachSessionCompat } from './compat'
import { Downloads } from './downloads'
import { Updater } from './updater'
import { CompactPanel, MenuPopup, PalettePopup, PeekPopup } from './floating'
import { BrowserImporter } from './importer'
import { ExtensionManager } from './extensions'
import { chooseAndSaveStartBackground, deleteStartBackgroundFile, readStartBackgroundDataUrl } from './backgrounds'

const APP_NAME = __CHANNEL__ === 'dev' ? 'Veyra Orbit Dev' : 'Veyra Orbit'
app.setName(APP_NAME)
// `npm run dev` and test runs keep their own profile, never the installed browser's.
if (process.env.VEYRA_USERDATA) app.setPath('userData', process.env.VEYRA_USERDATA)
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'veyra-orbit-local'))

if (!app.requestSingleInstanceLock()) app.quit()

cleanUserAgent()
hardenAll()

const isWin = process.platform === 'win32'
/** Acrylic needs Windows 11 22H2 (build 22621) or newer. */
const acrylic = isWin && Number(release().split('.')[2] ?? 0) >= 22621
const smokeLog = !app.isPackaged && process.env.VEYRA_SMOKE_LOG === '1'
function logSmoke(tag: string, data: unknown): void {
  if (smokeLog) console.log(`[smoke:${tag}] ${JSON.stringify(data)}`)
}
const TITLE_BAR_H = 40
const HOUR_MS = 3_600_000
const CLEAR_RANGES = new Set<ClearDataRange>(['hour', 'day', 'all'])
const COMPACT_POLL_MS = 100
const COMPACT_HIDE_DELAY_MS = 240
const PALETTE_PREWARM_DELAY_MS = 4_000

function resolveCurrentAppearance(): ResolvedAppearance {
  const appCfg = settings?.get().appearance ?? DEFAULT_APPEARANCE
  return resolveAppearanceTokens(appCfg, nativeTheme.shouldUseDarkColors, acrylic, false)
}

function overlay(tokens = resolveCurrentAppearance(), useAcrylic = false): Electron.TitleBarOverlayOptions {
  return {
    color: useAcrylic ? '#00000000' : tokens.shellBg,
    symbolColor: tokens.symbolColor,
    height: TITLE_BAR_H
  }
}

function applyWindowAppearance(): void {
  const tokens = resolveCurrentAppearance()
  tabs?.setPageRadius(tokens.pageRadius)
  if (win && !win.isDestroyed()) {
    const fullscreen = win.isFullScreen()
    const useAcrylic = !fullscreen && tokens.effectiveMaterial === 'acrylic'
    if (acrylic) {
      try {
        win.setBackgroundMaterial(useAcrylic ? 'acrylic' : 'none')
      } catch {
        /* ignore on unsupported builds */
      }
    }
    win.setBackgroundColor(useAcrylic ? '#00000000' : tokens.shellBg)
    if (isWin && settings?.activeWindowButtonsStyle() === 'windows') {
      try {
        win.setTitleBarOverlay(overlay(tokens, useAcrylic))
      } catch {
        /* window without titleBarOverlay */
      }
    }
    win.webContents.send('appearance:tokens', tokens)
  }
  compactSidebar?.sendAppearance(tokens)
  compactTitlebar?.sendAppearance(tokens)
  menuPopup?.sendAppearance(tokens)
  palettePopup?.sendAppearance(tokens)
  peekPopup?.sendAppearance(tokens)
}

let win: BrowserWindow | null = null
let menuPopup: MenuPopup | null = null
let palettePopup: PalettePopup | null = null
let peekPopup: PeekPopup | null = null
let compactSidebar: CompactPanel | null = null
let compactTitlebar: CompactPanel | null = null
let compactOmniboxOpen = false
let tabs: Tabs | null = null
let perms: Permissions | null = null
let externalApps: ExternalApps | null = null
let downloads: Downloads | null = null
let asks: PermissionAsk[] = []
let externalAsks: ExternalAppAsk[] = []
let store: Store | null = null
let settings: SettingsStore | null = null
let updater: Updater | null = null
let importer: BrowserImporter | null = null
let extManager: ExtensionManager | null = null

/** Compact mode runtime state for the active window. */
let compactState: CompactRevealState = { enabled: false, sidebar: false, toolbar: false }
let compactPins = { omnibox: false, sidebar: false, menu: false, titleMenu: false, dragging: false, extPopup: false }
let compactHover = { sidebar: false, toolbar: false }
let compactDrag: {
  startCursor: ScreenPoint
  startBounds: WindowBounds
  wasMaximized: boolean
  moved: boolean
} | null = null
let lastNormalBounds: WindowBounds = { x: 100, y: 100, width: 1360, height: 860 }
let lastPolledCursor: { x: number; y: number } | null = null
let compactPoller: NodeJS.Timeout | null = null
let sideHideTimer: NodeJS.Timeout | null = null
let barHideTimer: NodeJS.Timeout | null = null
let paletteWarmTimer: NodeJS.Timeout | null = null

const COMPACT_SIDEBAR_W = 264
const COMPACT_TITLEBAR_H = 52
const COMPACT_TITLEBAR_OPEN_H = 380
const COMPACT_MARGIN = 6

function compactToolbarPinned(): boolean {
  return compactPins.omnibox || compactPins.titleMenu || compactPins.dragging || compactPins.extPopup
}

function compactSidebarPinned(): boolean {
  return compactPins.sidebar || compactPins.menu
}

function isAnyOrbitFocused(): boolean {
  return (
    !!(win && !win.isDestroyed() && win.isFocused()) ||
    !!menuPopup?.isFocused() ||
    !!palettePopup?.isFocused() ||
    !!peekPopup?.isFocused() ||
    !!compactSidebar?.isFocused() ||
    !!compactTitlebar?.isFocused() ||
    !!extManager?.isPopupFocused()
  )
}

function broadcastUi(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) {
    if (payload === undefined) win.webContents.send(channel)
    else win.webContents.send(channel, payload)
  }
  compactSidebar?.send(channel, payload)
  compactTitlebar?.send(channel, payload)
}

function compactSidebarGeometry(): { offset: { x: number; y: number }; size: { width: number; height: number } } {
  const cb = win && !win.isDestroyed() ? win.getContentBounds() : { width: 1200, height: 800 }
  const z = win && !win.isDestroyed() ? win.webContents.getZoomFactor() : 1
  const cw = Math.round(cb.width / z)
  const ch = Math.round(cb.height / z)
  const top = compactState.toolbar ? COMPACT_TITLEBAR_H + 2 : COMPACT_MARGIN
  const appCfg = settings?.get().appearance ?? DEFAULT_APPEARANCE
  const width = Math.min(Math.max(appCfg.sidebarWidth + 16, COMPACT_SIDEBAR_W), Math.max(220, cw - COMPACT_MARGIN * 2))
  const x = appCfg.sidebarSide === 'right' ? Math.max(COMPACT_MARGIN, cw - width - COMPACT_MARGIN) : COMPACT_MARGIN
  return {
    offset: { x, y: top },
    size: { width, height: Math.max(200, ch - top - COMPACT_MARGIN) }
  }
}

function compactTitlebarGeometry(): { offset: { x: number; y: number }; size: { width: number; height: number } } {
  const cb = win && !win.isDestroyed() ? win.getContentBounds() : { width: 1200, height: 800 }
  const z = win && !win.isDestroyed() ? win.webContents.getZoomFactor() : 1
  const cw = Math.round(cb.width / z)
  const ch = Math.round(cb.height / z)
  const h = compactOmniboxOpen ? Math.min(COMPACT_TITLEBAR_OPEN_H, Math.max(COMPACT_TITLEBAR_H, ch - COMPACT_MARGIN * 2)) : COMPACT_TITLEBAR_H
  return {
    offset: { x: COMPACT_MARGIN, y: COMPACT_MARGIN },
    size: { width: Math.max(320, cw - COMPACT_MARGIN * 2), height: h }
  }
}

function syncCompactPanels(focusTarget?: 'sidebar' | 'toolbar', immediateHide = false): void {
  const enabled = !!settings?.get().compactMode && !tabs?.isPageFullscreen() && !!win && !win.isDestroyed() && !win.isMinimized()
  if (!enabled) {
    compactOmniboxOpen = false
    compactSidebar?.hide(true)
    compactTitlebar?.hide(true)
    return
  }

  if (compactState.toolbar) {
    const geom = compactTitlebarGeometry()
    if (compactTitlebar?.isRevealed()) {
      compactTitlebar.reposition(geom.offset, geom.size)
      if (focusTarget === 'toolbar') compactTitlebar.focus()
    } else {
      compactTitlebar?.show(geom.offset, geom.size, focusTarget === 'toolbar')
    }
  } else {
    compactOmniboxOpen = false
    compactTitlebar?.hide(immediateHide)
  }

  if (compactState.sidebar) {
    const geom = compactSidebarGeometry()
    if (compactSidebar?.isRevealed()) {
      compactSidebar.reposition(geom.offset, geom.size)
      if (focusTarget === 'sidebar') compactSidebar.focus()
    } else {
      compactSidebar?.show(geom.offset, geom.size, focusTarget === 'sidebar')
    }
  } else {
    compactSidebar?.hide(immediateHide)
  }

  logSmoke('compact', {
    enabled,
    sidebar: compactState.sidebar,
    toolbar: compactState.toolbar,
    sidebarVisible: !!compactSidebar?.isVisible(),
    toolbarVisible: !!compactTitlebar?.isVisible(),
    viewBounds: tabs?.attachedViewBounds() ?? []
  })
}

function sendWinState(): void {
  if (!win || win.isDestroyed()) return
  const payload: WindowState = {
    focused: isAnyOrbitFocused(),
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen()
  }
  broadcastUi('win:state', payload)
}

function handleOrbitFocusBlur(): void {
  sendWinState()
  // Defer slightly so focus handoff between main window, floating panels, and menus settles first.
  setTimeout(() => {
    if (!win || win.isDestroyed()) return
    sendWinState()
    if (settings?.get().compactMode && !isAnyOrbitFocused() && !compactPins.menu && !compactPins.titleMenu && !compactPins.dragging && !compactPins.extPopup) {
      compactHover = { sidebar: false, toolbar: false }
      compactPins.omnibox = false
      compactState = { enabled: true, sidebar: false, toolbar: false }
      broadcastUi('compact:state', compactState)
      syncCompactPanels(undefined, false)
    }
  }, 60)
}

function applyCompactTargets(wantSide: boolean, wantBar: boolean): void {
  if (!win || win.isDestroyed() || !settings?.get().compactMode) return
  let changed = false
  if (wantSide) {
    if (sideHideTimer) {
      clearTimeout(sideHideTimer)
      sideHideTimer = null
    }
    if (!compactState.sidebar) {
      compactState = { ...compactState, sidebar: true }
      changed = true
    }
  } else if (compactState.sidebar && !sideHideTimer) {
    sideHideTimer = setTimeout(() => {
      sideHideTimer = null
      if (!compactPins.sidebar && !compactPins.menu && !compactHover.sidebar && compactState.sidebar) {
        compactState = { ...compactState, sidebar: false }
        broadcastUi('compact:state', compactState)
        syncCompactPanels()
      }
    }, COMPACT_HIDE_DELAY_MS)
  }

  if (wantBar) {
    if (barHideTimer) {
      clearTimeout(barHideTimer)
      barHideTimer = null
    }
    if (!compactState.toolbar) {
      compactState = { ...compactState, toolbar: true }
      changed = true
    }
  } else if (compactState.toolbar && !barHideTimer) {
    barHideTimer = setTimeout(() => {
      barHideTimer = null
      if (!compactPins.omnibox && !compactPins.titleMenu && !compactPins.dragging && !compactPins.extPopup && !compactHover.toolbar && compactState.toolbar) {
        compactState = { ...compactState, toolbar: false }
        broadcastUi('compact:state', compactState)
        syncCompactPanels()
      }
    }, COMPACT_HIDE_DELAY_MS)
  }

  if (changed && win && !win.isDestroyed()) {
    broadcastUi('compact:state', compactState)
    syncCompactPanels()
  }
}

function sendCompactState(force = false, focusTarget?: 'sidebar' | 'toolbar', immediateHide = false): void {
  if (!win || win.isDestroyed()) return
  const enabled = !!settings?.get().compactMode
  const next: CompactRevealState = enabled
    ? {
        enabled: true,
        sidebar: compactState.sidebar || compactPins.sidebar || compactPins.menu || compactHover.sidebar,
        toolbar: compactState.toolbar || compactPins.omnibox || compactPins.titleMenu || compactPins.dragging || compactPins.extPopup || compactHover.toolbar
      }
    : { enabled: false, sidebar: false, toolbar: false }

  if (!force && next.enabled === compactState.enabled && next.sidebar === compactState.sidebar && next.toolbar === compactState.toolbar) {
    if (focusTarget) syncCompactPanels(focusTarget, immediateHide)
    return
  }
  compactState = next
  broadcastUi('compact:state', compactState)
  syncCompactPanels(focusTarget, immediateHide)
}

function clearCompactTimers(): void {
  if (sideHideTimer) {
    clearTimeout(sideHideTimer)
    sideHideTimer = null
  }
  if (barHideTimer) {
    clearTimeout(barHideTimer)
    barHideTimer = null
  }
}

function stopCompactPoller(): void {
  if (compactPoller) {
    clearInterval(compactPoller)
    compactPoller = null
  }
  lastPolledCursor = null
  clearCompactTimers()
}

function pollCompactCursor(): void {
  if (!win || win.isDestroyed() || !settings?.get().compactMode) return
  if (tabs?.isPageFullscreen() || win.isMinimized() || !win.isVisible()) return

  const focused = isAnyOrbitFocused()
  const cursor = screen.getCursorScreenPoint()
  const moved = lastPolledCursor !== null && (cursor.x !== lastPolledCursor.x || cursor.y !== lastPolledCursor.y)
  lastPolledCursor = cursor

  const content = win.getContentBounds()
  const appCfg = settings.get().appearance
  const zones = computeCompactZones({
    rx: cursor.x - content.x,
    ry: cursor.y - content.y,
    contentWidth: content.width,
    contentHeight: content.height,
    sidebarOpen: compactState.sidebar,
    toolbarOpen: compactState.toolbar,
    sidebarSide: appCfg.sidebarSide,
    sidebarWidth: appCfg.sidebarWidth
  })

  // If the OS cursor is outside the window and hasn't moved (e.g. non-interactive desktop session),
  // defer to the thin always-visible edge strips so we don't override DOM hover state.
  if (!zones.insideWindow && !moved) {
    applyCompactTargets(
      compactHover.sidebar || compactPins.sidebar || compactPins.menu,
      compactHover.toolbar || compactPins.omnibox || compactPins.titleMenu || compactPins.dragging || compactPins.extPopup
    )
    return
  }

  // Clear stale DOM mouseenter flags if the real OS cursor moved outside that panel's keep-open zone
  // (child BrowserWindows on Windows can miss mouseleave when crossing onto a native WebContentsView).
  if (!zones.insideWindow && moved) {
    compactHover.sidebar = false
    compactHover.toolbar = false
  } else if (zones.insideWindow) {
    if (!zones.wantSidebar && compactHover.sidebar) compactHover.sidebar = false
    if (!zones.wantToolbar && compactHover.toolbar) compactHover.toolbar = false
  }

  // Only reveal newly when the window is focused; keep-open or pinned states still hold cleanly.
  const sideByCursor = focused ? zones.wantSidebar : compactState.sidebar && zones.wantSidebar
  const barByCursor = focused ? zones.wantToolbar : compactState.toolbar && zones.wantToolbar
  const wantSide = sideByCursor || compactHover.sidebar || compactPins.sidebar || compactPins.menu
  const wantBar = barByCursor || compactHover.toolbar || compactPins.omnibox || compactPins.titleMenu || compactPins.dragging || compactPins.extPopup
  applyCompactTargets(wantSide, wantBar)
}

function startCompactPoller(): void {
  if (!compactPoller && settings?.get().compactMode && win && !win.isDestroyed() && !win.isMinimized() && win.isVisible()) {
    compactPoller = setInterval(pollCompactCursor, COMPACT_POLL_MS)
  }
}

function syncCompactMode(): void {
  const enabled = !!settings?.get().compactMode
  if (!enabled) {
    stopCompactPoller()
    compactDrag = null
    compactHover = { sidebar: false, toolbar: false }
    compactPins = { omnibox: false, sidebar: false, menu: false, titleMenu: false, dragging: false, extPopup: false }
    compactOmniboxOpen = false
    compactState = { enabled: false, sidebar: false, toolbar: false }
    sendCompactState(true, undefined, true)
    return
  }
  compactState = {
    enabled: true,
    sidebar: compactPins.sidebar || compactPins.menu || compactHover.sidebar,
    toolbar: compactPins.omnibox || compactPins.titleMenu || compactPins.dragging || compactPins.extPopup || compactHover.toolbar
  }
  sendCompactState(true)
  startCompactPoller()
}

/** History and bookmarks changed: the UI re-reads them (the Library page, the star). */
function dataChanged(): void {
  tabs?.refresh()
  broadcastUi('data-changed')
}

function sendSettings(): void {
  if (settings) broadcastUi('settings', settings.view())
}

function toggleCompactMode(): void {
  if (!settings) return
  settings.update({ compactMode: !settings.get().compactMode })
  sendSettings()
  syncCompactMode()
}

function buildPaletteContext(query: string, mode: PaletteMode): PaletteContext | null {
  if (!tabs || !store || !settings || !win || win.isDestroyed()) return null
  const st = tabs.state()
  const wsNameById = new Map(st.workspaces.map((w) => [w.id, w.name]))
  const all = tabs.allTabs()
  const activeTab = all.find((t) => t.id === st.activeId) ?? null
  const trimmed = query.trim()

  let candidates: Candidate[] = []
  if (trimmed) {
    candidates = store.candidates(trimmed, 120)
  } else {
    const bookmarks = store.bookmarks().slice(0, 12)
    const recent = store.history('', null, 16)
    const bmUrls = new Set(bookmarks.map((b) => b.url))
    candidates = [
      ...bookmarks.map((b) => ({ url: b.url, title: b.title, visits: 0, typed: 0, last: b.created, bookmarked: true })),
      ...recent
        .filter((h) => !bmUrls.has(h.url))
        .map((h) => ({ url: h.url, title: h.title, visits: 1, typed: 0, last: h.time, bookmarked: false }))
    ]
  }

  return {
    mode,
    tabs: all.map((t) => ({
      id: t.id,
      workspaceId: t.workspaceId,
      workspaceName: wsNameById.get(t.workspaceId) ?? 'Personal',
      url: t.url,
      title: t.title,
      bookmarked: t.bookmarked,
      pinned: t.pinned,
      muted: t.muted,
      active: t.id === st.activeId
    })),
    candidates,
    workspaces: st.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      active: w.id === st.activeWorkspaceId
    })),
    activeTab: activeTab
      ? {
          id: activeTab.id,
          url: activeTab.url,
          hasError: !!activeTab.error,
          pinned: activeTab.pinned,
          muted: activeTab.muted,
          bookmarked: activeTab.bookmarked,
          zoom: activeTab.zoom
        }
      : null,
    isSplit: !!activeTab && st.splits.some((g) => g.tabIds.includes(activeTab.id)),
    compactMode: settings.get().compactMode,
    isFullscreen: win.isFullScreen(),
    canReopenClosed: st.canReopenClosed,
    theme: settings.get().theme,
    searchUrl: settings.searchUrl()
  }
}

function activeWorkspaceAccentHex(): string {
  const dark = nativeTheme.shouldUseDarkColors
  const st = tabs?.state()
  const ws = st?.workspaces.find((w) => w.id === st.activeWorkspaceId)
  const entry = WORKSPACE_ACCENTS.find((a) => a.id === ws?.accent) ?? WORKSPACE_ACCENTS[0]
  return dark ? entry.dark : entry.light
}

function openOrTogglePalette(mode: PaletteMode): void {
  if (!palettePopup || !tabs) return
  if (palettePopup.isOpen() && palettePopup.currentMode() === mode) {
    palettePopup.dismiss()
    return
  }
  menuPopup?.close()
  peekPopup?.close()
  if (tabs.isPageFullscreen()) tabs.exitPageFullscreen(true)
  const ctx = buildPaletteContext('', mode)
  if (!ctx) return
  const { items, actions } = buildPaletteResults('', ctx)
  palettePopup.open({
    mode,
    dark: nativeTheme.shouldUseDarkColors,
    accent: activeWorkspaceAccentHex(),
    items,
    actions
  })
  logSmoke('palette', { event: 'open', mode, count: items.length, visible: palettePopup.isOpen() })
}

function openNewWorkspaceEditor(): void {
  if (settings?.get().compactMode) {
    if (sideHideTimer) {
      clearTimeout(sideHideTimer)
      sideHideTimer = null
    }
    compactState = { ...compactState, sidebar: true }
    sendCompactState(true, 'sidebar')
    compactSidebar?.send('ui:new-workspace')
  } else if (win && !win.isDestroyed()) {
    win.webContents.send('ui:new-workspace')
  }
}

function executePaletteAction(action: PaletteAction, openInNewTab: boolean): void {
  if (!tabs || !win || win.isDestroyed()) return
  switch (action.type) {
    case 'switch-tab':
      tabs.activate(action.tabId)
      return
    case 'switch-workspace':
      tabs.switchWorkspace(action.workspaceId)
      return
    case 'settings-section':
      tabs.openInternal('orbit://settings')
      win.webContents.send('ui:settings-section', action.sectionId)
      return
    case 'navigate': {
      if (!isAllowedUrl(action.url) && !isInternalUrl(action.url)) return
      const activeId = tabs.state().activeId
      if (openInNewTab || activeId === null) tabs.create(action.url)
      else tabs.navigate(activeId, action.url, true)
      return
    }
    case 'command': {
      const st = tabs.state()
      switch (action.cmd) {
        case 'new-tab':
          tabs.create('')
          return
        case 'new-workspace':
          openNewWorkspaceEditor()
          return
        case 'toggle-compact':
          toggleCompactMode()
          return
        case 'split-next':
          tabs.splitWithNext()
          return
        case 'unsplit':
          tabs.unsplit()
          return
        case 'reopen-closed':
          tabs.reopenClosed()
          return
        case 'reload':
          tabs.reload(false)
          return
        case 'hard-reload':
          tabs.reload(true)
          return
        case 'duplicate-tab':
          if (st.activeId !== null) tabs.duplicate(st.activeId)
          return
        case 'pin-tab':
          if (st.activeId !== null) tabs.togglePin(st.activeId)
          return
        case 'mute-tab':
          if (st.activeId !== null) tabs.toggleMute(st.activeId)
          return
        case 'sleep-tab':
          if (st.activeId !== null) tabs.sleepTab(st.activeId, true)
          return
        case 'close-tab':
          if (st.activeId !== null) tabs.close(st.activeId)
          return
        case 'toggle-bookmark':
          tabs.toggleBookmark()
          return
        case 'zoom-in':
          tabs.zoomIn()
          return
        case 'zoom-out':
          tabs.zoomOut()
          return
        case 'zoom-reset':
          tabs.resetZoom()
          return
        case 'print':
          tabs.print()
          return
        case 'find':
          tabs.openFind()
          return
        case 'toggle-downloads':
          tabs.toggleDownloads()
          return
        case 'devtools':
          tabs.toggleDevTools()
          return
        case 'fullscreen':
          win.setFullScreen(!win.isFullScreen())
          return
        case 'open-history':
          tabs.openInternal('orbit://history')
          return
        case 'open-bookmarks':
          tabs.openInternal('orbit://bookmarks')
          return
        case 'open-settings':
          tabs.openInternal('orbit://settings')
          return
        case 'clear-history-hour':
          store?.clear(Date.now() - HOUR_MS)
          dataChanged()
          return
        case 'clear-history-day':
          store?.clear(Date.now() - 24 * HOUR_MS)
          dataChanged()
          return
        case 'theme-light':
        case 'theme-dark':
        case 'theme-system': {
          if (!settings) return
          const theme = action.cmd === 'theme-light' ? 'light' : action.cmd === 'theme-dark' ? 'dark' : 'system'
          settings.update({ theme })
          nativeTheme.themeSource = theme
          sendSettings()
          applyWindowAppearance()
          return
        }
      }
    }
  }
}

function createWindow(): void {
  settings ??= new SettingsStore(join(app.getPath('userData'), 'settings.json'), app.getPath('downloads'), process.env.VEYRA_DOWNLOADS || '', isWin, acrylic)
  const s = settings
  nativeTheme.themeSource = s.get().theme
  const activeButtons = s.activeWindowButtonsStyle()
  const initialTokens = resolveCurrentAppearance()
  const initialAcrylic = initialTokens.effectiveMaterial === 'acrylic'

  const w = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: APP_NAME,
    // Windows picks the right hand-tuned size from the .ico; a 1024 px PNG gets shrunk badly.
    icon: join(__dirname, `../../resources/${__CHANNEL__ === 'dev' ? 'icon-dev' : 'icon'}.${isWin ? 'ico' : 'png'}`),
    autoHideMenuBar: true,
    backgroundColor: initialAcrylic ? '#00000000' : initialTokens.shellBg,
    ...(initialAcrylic ? { backgroundMaterial: 'acrylic' as const } : {}),
    ...(isWin
      ? activeButtons === 'windows'
        ? { titleBarStyle: 'hidden' as const, titleBarOverlay: overlay(initialTokens, initialAcrylic) }
        : { titleBarStyle: 'hidden' as const }
      : { titleBarStyle: 'hiddenInset' as const }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: true
    }
  })
  win = w
  // Orbit draws its own title bar and menus; remove Electron's default menu bar so Alt never shows it.
  w.setMenu(null)

  const panelExtraQuery = {
    buttons: activeButtons,
    version: app.getVersion()
  }

  // Floating overlay panels for compact mode (sidebar & titlebar slide over the page without moving it).
  compactSidebar?.destroy()
  compactSidebar = new CompactPanel(w, {
    view: 'compact-sidebar',
    preload: join(__dirname, '../preload/compact.js'),
    extraQuery: panelExtraQuery,
    width: COMPACT_SIDEBAR_W,
    height: 760,
    onFocusChange: (focused) => (focused ? sendWinState() : handleOrbitFocusBlur()),
    onBeforeInput: (e, input) => {
      if (tabs?.shortcut(input)) e.preventDefault()
    }
  })

  compactTitlebar?.destroy()
  compactTitlebar = new CompactPanel(w, {
    view: 'compact-titlebar',
    preload: join(__dirname, '../preload/compact.js'),
    extraQuery: panelExtraQuery,
    width: 1200,
    height: COMPACT_TITLEBAR_H,
    onFocusChange: (focused) => (focused ? sendWinState() : handleOrbitFocusBlur()),
    onBeforeInput: (e, input) => {
      if (tabs?.shortcut(input)) e.preventDefault()
    }
  })

  // Reusable floating acrylic window for title-bar menus (sits above native WebContentsViews and compact panels).
  menuPopup?.destroy()
  menuPopup = new MenuPopup(w, {
    preload: join(__dirname, '../preload/floating.js'),
    acrylic,
    onOpenChange: (open) => {
      compactPins.titleMenu = open
      if (settings?.get().compactMode) {
        applyCompactTargets(
          compactHover.sidebar || compactPins.sidebar || compactPins.menu,
          compactHover.toolbar || compactPins.omnibox || compactPins.titleMenu
        )
      }
      sendWinState()
    },
    onFocusChange: (focused) => (focused ? sendWinState() : handleOrbitFocusBlur())
  })

  // Reusable floating acrylic window for the Ctrl+K command palette.
  palettePopup?.destroy()
  palettePopup = new PalettePopup(w, {
    preload: join(__dirname, '../preload/palette.js'),
    acrylic,
    onFocusChange: (focused) => (focused ? sendWinState() : handleOrbitFocusBlur())
  })

  // The browser's own UI never navigates and never opens windows; pages do that in tabs.
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  store ??= new Store(join(app.getPath('userData'), 'orbit.db'))
  importer ??= new BrowserImporter(join(app.getPath('userData'), 'import-state.json'))
  const db = store

  externalApps = new ExternalApps((list) => {
    externalAsks = list
    if (!w.isDestroyed()) w.webContents.send('external-apps', list)
  })
  const ext = externalApps

  downloads?.detach()
  downloads = new Downloads(
    () => ({ dir: s.effectiveDownloadsDir(), askWhereToSave: s.get().askWhereToSave }),
    (list) => {
      broadcastUi('downloads', list)
    }
  )
  const d = downloads

  const configuredSessions = new Set<Session>()
  const onAltPeekDownload = (e: Electron.Event, item: Electron.DownloadItem, wc: Electron.WebContents): void => {
    if (tabs?.consumeAltPeek(wc, item.getURL())) {
      e.preventDefault()
    }
  }
  const onDownload = (e: Electron.Event, _item: Electron.DownloadItem, wc: Electron.WebContents): void => {
    if (!e.defaultPrevented) tabs?.downloadStarted(wc)
  }

  /**
   * Single setup path for every web session partition (the shared persist:web partition, every
   * isolated workspace persist:ws-<id> partition, and every ephemeral private-ws-<id> partition)
   * so security, site compat and downloads never drift.
   */
  const setupWebSession = (partition: string): Session => {
    // Without the permission handler a session falls back to Electron's default, which allows every
    // permission, so a session must never be set up before Permissions exists.
    if (!perms) throw new Error('web session set up before permissions')
    const sess = sessionForPartition(partition)
    if (configuredSessions.has(sess)) return sess
    configuredSessions.add(sess)
    perms.attach(sess)
    if (shouldLoadExtensionsForPartition(partition)) {
      // Persistent web sessions use Orbit's hidden internal DNR `orbit-compat` extension
      // instead of session.webRequest.onBeforeSendHeaders (which disables extension DNR).
      void extManager?.attachSession(partition, sess)
    } else {
      // Private (in-memory, non-persistent) workspaces NEVER load extensions; keep webRequest compat.
      attachSessionCompat(sess)
    }
    // Alt+click peek intercepts link SaveLinkAs before Downloads records it.
    sess.on('will-download', onAltPeekDownload)
    d.attach(sess)
    sess.on('will-download', onDownload)
    return sess
  }

  /** Clears storage, caches and listeners when an ephemeral private workspace closes or Orbit quits. */
  const discardWebSession = async (partition: string): Promise<void> => {
    const sess = sessionForPartition(partition)
    configuredSessions.delete(sess)
    sess.off('will-download', onDownload)
    d.detachSession(sess)
    try {
      await sess.clearStorageData()
      await sess.clearCache()
      await sess.clearAuthCache()
      await sess.clearHostResolverCache()
      await sess.closeAllConnections()
    } catch {
      /* session may already be tearing down during app quit */
    }
  }

  // Reusable floating Link Preview ("Peek") window hosting a sandboxed WebContentsView.
  peekPopup?.destroy()
  peekPopup = new PeekPopup(w, {
    preload: join(__dirname, '../preload/peek.js'),
    acrylic,
    ensureSession: (partition) => {
      setupWebSession(partition)
    },
    onExternalApp: (tabId, pageUrl, targetUrl) => {
      ext.request(tabId, pageUrl, targetUrl)
    },
    onFocusChange: (focused) => (focused ? sendWinState() : handleOrbitFocusBlur()),
    onClosed: () => {
      perms?.dropTab(PEEK_TAB_ID)
      ext.dropTab(PEEK_TAB_ID)
    }
  })

  tabs = new Tabs(w, join(app.getPath('userData'), 'session.json'), {
    visit: (url, title, typed) => {
      db.visit(url, title, typed)
      broadcastUi('data-changed')
    },
    title: (url, title) => db.title(url, title),
    isBookmarked: (url) => db.isBookmarked(url),
    toggleBookmark: (url, title) => {
      db.toggleBookmark(url, title)
      dataChanged()
    },
    searchUrl: () => s.searchUrl(),
    externalApp: (tabId, pageUrl, targetUrl) => {
      ext.request(tabId, pageUrl, targetUrl)
    },
    ensureSession: (partition) => {
      setupWebSession(partition)
    },
    discardSession: (partition) => discardWebSession(partition),
    hasPendingPermission: (tabId) => perms?.hasPendingPermission(tabId) ?? false,
    hasActiveMediaCapture: (tabId) => perms?.hasActiveMediaCapture(tabId) ?? false,
    sleepPolicy: () => {
      const cur = s.get()
      return {
        timeoutMs: resolveSleepTimeoutMs(cur.sleepAfterMinutes, process.env.VEYRA_SLEEP_TEST_MINUTES, app.isPackaged),
        sleepPinnedTabs: cur.sleepPinnedTabs
      }
    },
    toggleCompactMode: () => toggleCompactMode(),
    onMenuOpen: (open) => {
      compactPins.menu = open
      if (settings?.get().compactMode) sendCompactState()
    },
    onFocusOmnibox: () => {
      if (!settings?.get().compactMode) return false
      if (barHideTimer) {
        clearTimeout(barHideTimer)
        barHideTimer = null
      }
      compactPins.omnibox = true
      compactState = { ...compactState, toolbar: true }
      sendCompactState(true, 'toolbar')
      compactTitlebar?.send('focus-omnibox')
      return true
    },
    onFocusMenuBar: () => {
      if (w.isDestroyed()) return
      if (settings?.get().compactMode) {
        if (barHideTimer) {
          clearTimeout(barHideTimer)
          barHideTimer = null
        }
        compactState = { ...compactState, toolbar: true }
        sendCompactState(true, 'toolbar')
        compactTitlebar?.send('menu:focus-bar')
        return
      }
      w.webContents.focus()
      w.webContents.send('menu:focus-bar')
    },
    onState: (st) => {
      compactSidebar?.send('state', st)
      compactTitlebar?.send('state', st)
      logSmoke('state', {
        activeId: st.activeId,
        tabCount: st.tabs.length,
        splits: st.splits,
        viewBounds: tabs?.attachedViewBounds() ?? []
      })
    },
    onToggleDownloads: () => {
      if (!settings?.get().compactMode) return false
      if (sideHideTimer) {
        clearTimeout(sideHideTimer)
        sideHideTimer = null
      }
      compactState = { ...compactState, sidebar: true }
      sendCompactState(true, 'sidebar')
      compactSidebar?.send('downloads:toggle')
      return true
    },
    onPageFullscreen: (on) => {
      if (on) {
        compactSidebar?.hide(true)
        compactTitlebar?.hide(true)
        palettePopup?.close()
        peekPopup?.close()
      } else if (settings?.get().compactMode) {
        syncCompactPanels()
      }
    },
    onTogglePalette: (mode) => openOrTogglePalette(mode),
    onNewTabShortcut: () => {
      if (settings?.get().newTabBehavior === 'command-bar') {
        openOrTogglePalette('new-tab')
        return true
      }
      return false
    },
    openPeek: (url, sourceTabId, workspaceId, partition) => {
      if (!peekPopup || !isAllowedUrl(url)) return
      menuPopup?.close()
      palettePopup?.close()
      if (tabs?.isPageFullscreen()) tabs.exitPageFullscreen(true)
      peekPopup.open({
        url,
        sourceTabId,
        workspaceId,
        partition,
        dark: nativeTheme.shouldUseDarkColors,
        accent: activeWorkspaceAccentHex()
      })
      logSmoke('peek', { event: 'open', url, sourceTabId, visible: peekPopup.isOpen() })
    },
    onTabViewCreated: (wc, _tabId, partition) => {
      extManager?.addTab(partition, wc, w)
    },
    onTabViewDestroyed: (wc, _tabId, partition) => {
      extManager?.removeTab(partition, wc)
    },
    onActiveTabChanged: (wc, partition) => {
      extManager?.selectTab(partition, wc)
    },
    extensionContextMenuItems: (wc, params) => {
      return extManager?.getContextMenuItems(wc, params) ?? []
    },
    isLoadedExtension: (partition, extId) => {
      return extManager?.hasLoadedExtension(partition, extId) ?? false
    },
    quit: () => app.quit()
  })
  const t = tabs

  extManager?.dispose()
  extManager = new ExtensionManager({
    getWindow: () => (win && !win.isDestroyed() ? win : null),
    activePartition: () => t.activePartition(),
    activeWebContents: () => t.activeWebContents(),
    tabDetailsForWebContents: (wc) => t.tabDetailsForWebContents(wc),
    createTabFromExtension: (url, opts) => t.createExtensionTab(url, opts),
    authorizeExtensionTabNavigation: (wc, extId) => t.authorizeExtensionTabNavigation(wc, extId),
    activateTabByWebContents: (wc) => t.activateByWebContents(wc),
    closeTabByWebContents: (wc) => t.closeByWebContents(wc),
    openSettingsExtensions: () => {
      t.openInternal('orbit://settings')
      if (win && !win.isDestroyed()) win.webContents.send('ui:settings-section', 'set-extensions')
    },
    onStateChanged: (st) => {
      if (win && !win.isDestroyed()) win.webContents.send('extensions:state', st)
    },
    onActionsChanged: (actions) => {
      broadcastUi('extensions:actions', actions)
    },
    onInstallAsksChanged: (list) => {
      if (win && !win.isDestroyed()) win.webContents.send('extensions:install-ask', list)
    },
    onBeforeOpenPopup: () => {
      menuPopup?.close()
      palettePopup?.close()
      peekPopup?.close()
    },
    onPopupOpenChange: (open) => {
      compactPins.extPopup = open
      if (settings?.get().compactMode) {
        applyCompactTargets(
          compactHover.sidebar || compactPins.sidebar || compactPins.menu,
          compactHover.toolbar || compactPins.omnibox || compactPins.titleMenu || compactPins.dragging || compactPins.extPopup
        )
      }
      sendWinState()
    },
    onPopupFocusChange: (focused) => (focused ? sendWinState() : handleOrbitFocusBlur())
  })
  const em = extManager

  perms = new Permissions(
    (wc) => (peekPopup?.isContentWebContents(wc) ? PEEK_TAB_ID : t.tabIdOf(wc)),
    (list) => {
      asks = list
      if (!w.isDestroyed()) w.webContents.send('permissions', list)
    },
    db,
    () => {
      if (!w.isDestroyed()) w.webContents.send('permissions:saved', perms?.listSaved() ?? [])
    },
    (tabId) => t.isPrivateTab(tabId),
    (sess, url, permission) => em.isExtensionPermissionAllowed(sess, url, permission)
  )
  const p = perms
  t.onTabGone = (id) => {
    p.dropTab(id)
    ext.dropTab(id)
  }

  // Always configure the shared default web session up front.
  setupWebSession(WEB_PARTITION)

  w.webContents.on('before-input-event', (e, input) => {
    if (t.shortcut(input)) e.preventDefault()
  })

  w.once('ready-to-show', () => {
    w.show()
    // Cold-opening the command palette takes >150 ms; pre-warm only the palette after startup settles.
    // Its idle-destroy timer still tears it down after ~60 s if unused.
    if (paletteWarmTimer) clearTimeout(paletteWarmTimer)
    paletteWarmTimer = setTimeout(() => {
      paletteWarmTimer = null
      if (win === w && !w.isDestroyed() && !w.isMinimized() && palettePopup && !palettePopup.hasLiveWindow()) {
        palettePopup.warm()
      }
    }, PALETTE_PREWARM_DELAY_MS)
  })
  // Windows flickers acrylic on a full-screen window, so full screen is solid; and a page in
  // full screen leaves it when the window does (Esc, F11).
  w.on('focus', sendWinState)
  w.on('blur', handleOrbitFocusBlur)
  w.on('minimize', () => {
    stopCompactPoller()
    compactSidebar?.hide(true)
    compactTitlebar?.hide(true)
  })
  w.on('hide', () => {
    stopCompactPoller()
    compactSidebar?.hide(true)
    compactTitlebar?.hide(true)
  })
  w.on('show', () => {
    startCompactPoller()
    if (settings?.get().compactMode) syncCompactPanels()
  })
  w.on('maximize', () => {
    sendWinState()
    syncCompactPanels()
  })
  w.on('unmaximize', () => {
    sendWinState()
    syncCompactPanels()
  })
  w.on('restore', () => {
    startCompactPoller()
    sendWinState()
    syncCompactPanels()
  })
  w.on('move', () => {
    if (!w.isMaximized() && !w.isFullScreen()) lastNormalBounds = w.getBounds()
    if (settings?.get().compactMode) syncCompactPanels()
  })
  w.on('moved', () => {
    if (settings?.get().compactMode) {
      compactHover = { sidebar: false, toolbar: false }
      lastPolledCursor = null
      syncCompactPanels()
    }
  })
  w.on('enter-full-screen', () => {
    applyWindowAppearance()
    sendWinState()
    t.relayout()
    if (settings?.get().compactMode) syncCompactPanels()
  })
  w.on('leave-full-screen', () => {
    applyWindowAppearance()
    sendWinState()
    t.exitPageFullscreen()
    if (settings?.get().compactMode) syncCompactPanels()
  })
  w.on('resize', () => {
    if (!w.isMaximized() && !w.isFullScreen()) lastNormalBounds = w.getBounds()
    t.relayout()
    if (settings?.get().compactMode) syncCompactPanels()
  })
  w.on('resized', () => {
    if (settings?.get().compactMode) syncCompactPanels()
  })
  w.on('close', () => t.save())
  w.on('closed', () => {
    if (paletteWarmTimer) {
      clearTimeout(paletteWarmTimer)
      paletteWarmTimer = null
    }
    stopCompactPoller()
    compactDrag = null
    compactPins = { omnibox: false, sidebar: false, menu: false, titleMenu: false, dragging: false, extPopup: false }
    compactHover = { sidebar: false, toolbar: false }
    compactOmniboxOpen = false
    compactState = { enabled: false, sidebar: false, toolbar: false }
    em.dispose()
    if (extManager === em) extManager = null
    compactSidebar?.destroy()
    compactSidebar = null
    compactTitlebar?.destroy()
    compactTitlebar = null
    palettePopup?.destroy()
    palettePopup = null
    peekPopup?.destroy()
    peekPopup = null
    menuPopup?.destroy()
    menuPopup = null
    for (const sess of configuredSessions) {
      sess.off('will-download', onAltPeekDownload)
      sess.off('will-download', onDownload)
    }
    configuredSessions.clear()
    d.detach()
    if (downloads === d) downloads = null
    t.dispose()
    win = null
    tabs = null
  })

  const query = {
    material: initialTokens.effectiveMaterial,
    platform: process.platform,
    buttons: activeButtons,
    version: app.getVersion()
  }
  t.setPageRadius(initialTokens.pageRadius)
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
  else void w.loadFile(join(__dirname, '../renderer/index.html'), { query })

  // Wait for orbit-compat DNR rules (and initial extensions) on persist:web before restoring tabs
  // so the very first navigation already has Google sign-in / Client Hints rules active.
  void em.whenSessionReady(WEB_PARTITION).finally(() => {
    if (!w.isDestroyed() && tabs === t) {
      t.restore(s.get().startup !== 'new-tab')
      syncCompactMode()
    }
  })

  if (!updater) {
    updater = new Updater((state) => {
      broadcastUi('update:state', state)
    })
    updater.start()
  }
}

/** Only the browser's own main UI may call privileged IPC (settings, privacy, bounds, overlay); pages have no preload. */
function fromUi(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!win && !win.isDestroyed() && e.sender === win.webContents
}

/** Only the floating compact-mode sidebar or titlebar panels may call compact-panel channels. */
function fromCompactPanel(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!compactSidebar?.isSender(e.sender) || !!compactTitlebar?.isSender(e.sender)
}

/** Main UI or floating compact-mode panels (for shared Sidebar/TitleBar actions). */
function fromUiSurface(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return fromUi(e) || fromCompactPanel(e)
}

/** Only the floating menu window may call menu-popup return channels. */
function fromMenu(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!menuPopup && menuPopup.isSender(e.sender)
}

/** Only the floating Ctrl+K command palette window may call palette:* return channels. */
function fromPalette(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!palettePopup && palettePopup.isSender(e.sender)
}

/** Only the floating Link Preview ("Peek") toolbar window may call peek:* return channels. */
function fromPeek(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!peekPopup && peekPopup.isSender(e.sender)
}

const WIN_CMDS = new Set<WinCmd>([
  'minimize',
  'maximize',
  'close',
  'fullscreen',
  'quit',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'selectAll'
])

function on<A extends unknown[]>(channel: string, f: (t: Tabs, ...args: A) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromUi(e) && tabs) f(tabs, ...(args as A))
  })
}

function onSurface<A extends unknown[]>(channel: string, f: (t: Tabs, ...args: A) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromUiSurface(e) && tabs) f(tabs, ...(args as A))
  })
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): v is string => typeof v === 'string' && v.length < 8192

on('ready', () => {
  if (!win || !tabs) return
  win.webContents.send('state', tabs.state())
  win.webContents.send('permissions', asks)
  win.webContents.send('external-apps', externalAsks)
  win.webContents.send('downloads', downloads?.list() ?? [])
  win.webContents.send('permissions:saved', perms?.listSaved() ?? [])
  sendSettings()
  applyWindowAppearance()
  sendCompactState(true)
  sendWinState()
  win.webContents.send('page-fullscreen', tabs.isPageFullscreen())
  if (updater) win.webContents.send('update:state', updater.state())
  if (extManager) {
    win.webContents.send('extensions:state', extManager.getState())
    win.webContents.send('extensions:actions', extManager.getToolbarActions())
    win.webContents.send('extensions:install-ask', extManager.listInstallAsks())
  }
})

// Compact-mode floating panel handshake and narrow panel-specific IPC.
ipcMain.on('compact-panel:ready', (e) => {
  if (!fromCompactPanel(e) || !tabs) return
  const panel = compactSidebar?.isSender(e.sender) ? compactSidebar : compactTitlebar
  if (!panel) return
  const currentTabs = tabs
  panel.markReady(() => {
    panel.sendAppearance(resolveCurrentAppearance())
    if (settings) panel.send('settings', settings.view())
    panel.send('state', currentTabs.state())
    panel.send('downloads', downloads?.list() ?? [])
    panel.send('compact:state', compactState)
    panel.send('win:state', {
      focused: isAnyOrbitFocused(),
      maximized: !!win && !win.isDestroyed() && win.isMaximized(),
      fullscreen: !!win && !win.isDestroyed() && win.isFullScreen()
    })
    if (updater) panel.send('update:state', updater.state())
    if (extManager && panel === compactTitlebar) {
      panel.send('extensions:actions', extManager.getToolbarActions())
    }
  })
})
ipcMain.on('compact-panel:omnibox-open', (e, open: unknown) => {
  if (!compactTitlebar?.isSender(e.sender)) return
  const next = open === true
  if (compactOmniboxOpen === next) return
  compactOmniboxOpen = next
  if (compactTitlebar.isRevealed()) {
    const geom = compactTitlebarGeometry()
    compactTitlebar.reposition(geom.offset, geom.size)
  }
})
ipcMain.on('compact-panel:new-workspace', (e) => {
  if (!fromCompactPanel(e)) return
  if (settings?.get().compactMode) {
    if (sideHideTimer) {
      clearTimeout(sideHideTimer)
      sideHideTimer = null
    }
    compactState = { ...compactState, sidebar: true }
    sendCompactState(true, 'sidebar')
    compactSidebar?.send('ui:new-workspace')
  } else if (win && !win.isDestroyed()) {
    win.webContents.send('ui:new-workspace')
  }
})
ipcMain.on('compact-panel:settings-section', (e, sectionId: unknown) => {
  if (!fromCompactPanel(e) || !str(sectionId) || !tabs) return
  tabs.openInternal('orbit://settings')
  if (win && !win.isDestroyed()) win.webContents.send('ui:settings-section', sectionId)
})
ipcMain.on('compact-panel:drag-start', (e) => {
  if (!compactTitlebar?.isSender(e.sender) || !win || win.isDestroyed() || win.isFullScreen()) return
  menuPopup?.close()
  const wasMaximized = win.isMaximized()
  const bounds = win.getBounds()
  if (!wasMaximized) lastNormalBounds = bounds
  compactDrag = {
    startCursor: screen.getCursorScreenPoint(),
    startBounds: bounds,
    wasMaximized,
    moved: false
  }
  compactPins.dragging = true
})
ipcMain.on('compact-panel:drag-move', (e) => {
  if (!compactTitlebar?.isSender(e.sender) || !compactDrag || !win || win.isDestroyed() || win.isFullScreen()) return
  const cursor = screen.getCursorScreenPoint()
  const dist = Math.hypot(cursor.x - compactDrag.startCursor.x, cursor.y - compactDrag.startCursor.y)
  if (!compactDrag.moved && dist < 4) return

  if (compactDrag.wasMaximized) {
    const maxBounds = compactDrag.startBounds
    win.unmaximize()
    const restoredSize = { width: lastNormalBounds.width || 1200, height: lastNormalBounds.height || 800 }
    const next = computeRestoreDragBounds(maxBounds, restoredSize, cursor)
    win.setBounds(next)
    compactDrag = {
      startCursor: cursor,
      startBounds: win.getBounds(),
      wasMaximized: false,
      moved: true
    }
    syncCompactPanels()
    return
  }

  compactDrag.moved = true
  const next = computeCompactWindowDrag(compactDrag.startBounds, compactDrag.startCursor, cursor)
  win.setBounds(next)
  syncCompactPanels()
})
ipcMain.on('compact-panel:drag-end', (e) => {
  if (!compactTitlebar?.isSender(e.sender)) return
  const drag = compactDrag
  compactDrag = null
  compactPins.dragging = false
  compactHover = { sidebar: false, toolbar: false }
  lastPolledCursor = null
  if (drag?.moved && win && !win.isDestroyed() && !win.isFullScreen()) {
    const cursor = screen.getCursorScreenPoint()
    const workArea = screen.getDisplayNearestPoint(cursor).workArea
    const snap = computeEdgeSnap(cursor, workArea)
    if (snap.kind === 'maximize') {
      win.maximize()
    } else if (snap.kind === 'bounds') {
      win.setBounds(snap.bounds)
    }
    syncCompactPanels()
  }
  // Clicking/dragging the floating titlebar moves OS focus onto that child window.
  // Return focus to the main window so hiding the titlebar after the drag never drops
  // Orbit's foreground focus (which would disable top-edge hover reveal).
  if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && compactTitlebar.isFocused()) {
    win.focus()
  }
  sendWinState()
  if (settings?.get().compactMode) pollCompactCursor()
})

onSurface('tab:new', (t, input?: unknown) => {
  if (input === undefined && settings?.get().newTabBehavior === 'command-bar') {
    openOrTogglePalette('new-tab')
    return
  }
  t.create((str(input) && toUrl(input, settings?.searchUrl())) || '')
})
onSurface('tab:close', (t, id: unknown) => num(id) && t.close(id))
onSurface('tab:reopen', (t) => t.reopenClosed())
onSurface('tab:print', (t) => t.print())
onSurface('tab:devtools', (t) => t.toggleDevTools())
onSurface('tab:open-internal', (t, url: unknown) => {
  if (str(url) && isInternalUrl(url)) t.openInternal(url)
})
onSurface('downloads:toggle', (t) => t.toggleDownloads())
onSurface('find:open', (t) => t.openFind())
onSurface('palette:open-request', (_t, mode?: unknown) => {
  openOrTogglePalette(mode === 'new-tab' ? 'new-tab' : 'command')
})
onSurface('tab:activate', (t, id: unknown) => num(id) && t.activate(id))
// Everything the UI navigates to was typed (address bar, start page), which history ranks higher.
onSurface('tab:navigate', (t, id: unknown, input: unknown) => num(id) && str(input) && t.navigate(id, input, true))
onSurface('tab:pin', (t, id: unknown) => num(id) && t.togglePin(id))
onSurface('tab:move', (t, id: unknown, to: unknown) => num(id) && num(to) && t.move(id, to))
onSurface('nav:back', (t) => t.back())
onSurface('nav:forward', (t) => t.forward())
onSurface('nav:reload', (t) => t.reload())
onSurface('nav:stop', (t) => t.stop())
onSurface('nav:zoom-in', (t) => t.zoomIn())
onSurface('nav:zoom-out', (t) => t.zoomOut())
onSurface('nav:zoom-reset', (t) => t.resetZoom())
onSurface('win:cmd', (t, cmd: unknown) => {
  if (!str(cmd) || !WIN_CMDS.has(cmd as WinCmd) || !win || win.isDestroyed()) return
  switch (cmd as WinCmd) {
    case 'minimize':
      win.minimize()
      return
    case 'maximize':
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return
    case 'close':
      win.close()
      return
    case 'fullscreen':
      win.setFullScreen(!win.isFullScreen())
      return
    case 'quit':
      app.quit()
      return
    case 'undo':
    case 'redo':
    case 'cut':
    case 'copy':
    case 'paste':
    case 'selectAll':
      t.editCommand(cmd as 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll')
      return
  }
})
on('app:relaunch', (t) => {
  t.save()
  app.relaunch()
  app.quit()
})
// Floating title-bar menu IPC: main UI or compact titlebar asks to open/close; menu window reports size/pick/step/dismiss.
ipcMain.on('menu:open', (e, spec: unknown) => {
  if (!fromUiSurface(e)) return
  const offset = compactTitlebar?.isSender(e.sender) ? compactTitlebar.offsetCss() : { x: 0, y: 0 }
  menuPopup?.open(spec, e.sender, offset)
})
ipcMain.on('menu:close', (e) => {
  if (fromUiSurface(e)) menuPopup?.close()
})
ipcMain.on('menu:ready', (e) => {
  if (fromMenu(e)) {
    menuPopup?.markReady(resolveCurrentAppearance())
  }
})
ipcMain.on('menu:size', (e, width: unknown, height: unknown) => {
  if (fromMenu(e) && num(width) && num(height)) menuPopup?.applySize(width, height)
})
ipcMain.on('menu:pick', (e, id: unknown) => {
  if (fromMenu(e) && str(id)) menuPopup?.pick(id)
})
ipcMain.on('menu:step', (e, by: unknown) => {
  if (fromMenu(e) && (by === -1 || by === 1)) menuPopup?.step(by)
})
ipcMain.on('menu:dismiss', (e) => {
  if (fromMenu(e)) menuPopup?.dismiss()
})

// Floating Ctrl+K command palette IPC: strict sender check + main-side ID/URL validation.
ipcMain.on('palette:ready', (e) => {
  if (fromPalette(e)) {
    palettePopup?.markReady(resolveCurrentAppearance())
  }
})
ipcMain.on('palette:query', (e, text: unknown) => {
  if (!fromPalette(e) || !palettePopup || !str(text)) return
  const ctx = buildPaletteContext(text, palettePopup.currentMode())
  if (!ctx) return
  const { items, actions } = buildPaletteResults(text, ctx)
  palettePopup.updateResults(text.trim(), items, actions)
})
ipcMain.on('palette:pick', (e, id: unknown, openInNewTab: unknown) => {
  if (!fromPalette(e) || !palettePopup) return
  const action = palettePopup.consumePick(id)
  if (!action) return
  executePaletteAction(action, openInNewTab === true)
})
ipcMain.on('palette:submit-text', (e, text: unknown, openInNewTab: unknown) => {
  if (!fromPalette(e) || !palettePopup || !settings) return
  const url = resolveTypedPaletteText(text, settings.searchUrl())
  palettePopup.close()
  if (url) executePaletteAction({ type: 'navigate', url }, openInNewTab === true)
})
ipcMain.on('palette:size', (e, height: unknown) => {
  if (fromPalette(e) && num(height)) palettePopup?.applyHeight(height)
})
ipcMain.on('palette:dismiss', (e) => {
  if (fromPalette(e)) palettePopup?.dismiss()
})

// Floating Link Preview ("Peek") toolbar IPC: strict sender check + fixed action allowlist (never accepts URLs).
ipcMain.on('peek:ready', (e) => {
  if (fromPeek(e)) {
    peekPopup?.markReady(resolveCurrentAppearance())
  }
})
ipcMain.on('peek:action', (e, act: unknown) => {
  if (!fromPeek(e) || !peekPopup || !tabs || !isPeekAction(act)) return
  switch (act) {
    case 'back':
      peekPopup.back()
      return
    case 'reload':
      peekPopup.reload()
      return
    case 'close':
      peekPopup.dismiss()
      return
    case 'open-tab': {
      const target = peekPopup.currentTarget()
      peekPopup.close()
      if (target && isAllowedUrl(target.url)) {
        tabs.create(target.url, { after: target.sourceTabId, workspaceId: target.workspaceId, activate: true })
      }
      return
    }
    case 'open-split': {
      const target = peekPopup.currentTarget()
      peekPopup.close()
      if (target && isAllowedUrl(target.url)) {
        const st = tabs.state()
        const anchorId = st.tabs.some((tab) => tab.id === target.sourceTabId)
          ? target.sourceTabId
          : st.activeId
        const newId = tabs.create(target.url, { after: anchorId ?? undefined, workspaceId: target.workspaceId, activate: false })
        if (anchorId !== null && anchorId !== newId) {
          tabs.splitTabs(anchorId, newId, 'right', newId)
        } else {
          tabs.activate(newId)
        }
      }
      return
    }
  }
})
onSurface('tab:mute', (t, id: unknown) => num(id) && t.toggleMute(id))
onSurface('tab:sleep', (t, id: unknown) => num(id) && t.sleepTab(id, true))
onSurface('tab:menu', (t, id: unknown) => num(id) && t.tabMenu(id))
onSurface('split:with', (t, anchorId: unknown, otherId: unknown, placement?: unknown) => {
  if (!num(anchorId) || !num(otherId)) return
  const side = placement === 'left' ? 'left' : 'right'
  t.splitTabs(anchorId, otherId, side, otherId)
})
onSurface('split:next', (t) => t.splitWithNext())
onSurface('split:unsplit', (t, tabId?: unknown) => t.unsplit(num(tabId) ? tabId : undefined))
on('split:ratio', (t, groupId: unknown, kind: unknown, ratio: unknown) => {
  if (str(groupId) && (kind === 'col' || kind === 'row') && num(ratio)) {
    t.setSplitRatio(groupId, kind, ratio)
  }
})
on('split:swap', (t, groupId: unknown) => {
  if (str(groupId)) t.swapSplit(groupId)
})
onSurface('workspace:switch', (t, id: unknown) => str(id) && t.switchWorkspace(id))
onSurface('compact:toggle', () => toggleCompactMode())
onSurface('compact:pin', (_t, kind: unknown, pinned: unknown) => {
  if (kind !== 'omnibox' && kind !== 'sidebar') return
  const k = kind as CompactPinKind
  compactPins[k] = pinned === true
  if (settings?.get().compactMode) {
    applyCompactTargets(compactHover.sidebar || compactSidebarPinned(), compactHover.toolbar || compactToolbarPinned())
  }
})
onSurface('compact:hover', (_t, edge: unknown, hovering: unknown) => {
  if (edge !== 'sidebar' && edge !== 'toolbar') return
  compactHover[edge] = hovering === true
  if (settings?.get().compactMode && !tabs?.isPageFullscreen()) {
    applyCompactTargets(compactHover.sidebar || compactSidebarPinned(), compactHover.toolbar || compactToolbarPinned())
  }
})
on('bounds', (t, r: unknown) => {
  const rect = r as Rect | null
  if (rect === null) return t.setBounds(null)
  if (rect && num(rect.x) && num(rect.y) && num(rect.width) && num(rect.height)) t.setBounds(rect)
})

/** Calls from the main UI only (privileged settings/privacy/permissions/overlay). */
function handle(channel: string, f: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromUi(e)) throw new Error('not allowed')
    return f(...args)
  })
}

/** Calls from either the main UI or the floating compact-mode panels (workspaces, suggest, read-only history/bookmarks). */
function handleSurface(channel: string, f: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromUiSurface(e)) throw new Error('not allowed')
    return f(...args)
  })
}

handleSurface('workspace:create', (input) => {
  if (!tabs || !input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  const req: WorkspaceCreateInput = {
    name: str(raw.name) ? raw.name : '',
    icon: str(raw.icon) ? raw.icon : undefined,
    accent: str(raw.accent) ? (raw.accent as WorkspaceCreateInput['accent']) : undefined,
    isolated: typeof raw.isolated === 'boolean' ? raw.isolated : undefined
  }
  return tabs.createWorkspace(req)
})

handle('workspace:create-private', () => {
  return tabs?.createPrivateWorkspace() ?? null
})

handleSurface('workspace:update', (id, patch) => {
  if (!tabs || !str(id) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return null
  const raw = patch as Record<string, unknown>
  const req: WorkspaceUpdateInput = {}
  if (str(raw.name)) req.name = raw.name
  if (str(raw.icon)) req.icon = raw.icon
  if (str(raw.accent)) req.accent = raw.accent as WorkspaceUpdateInput['accent']
  if (typeof raw.isolated === 'boolean') req.isolated = raw.isolated
  return tabs.updateWorkspace(id, req)
})

handleSurface('workspace:delete', (id) => {
  if (!tabs || !str(id)) return false
  return tabs.deleteWorkspace(id)
})

handleSurface('suggest', (input) => {
  if (!str(input) || !store || !tabs) return []
  const open: Candidate[] = tabs
    .suggestableTabs()
    .filter((t) => /^https?:/.test(t.url))
    .map((t) => ({ url: t.url, title: t.title, visits: 0, typed: 0, last: 0, bookmarked: t.bookmarked, tabId: t.id }))
  return suggest(input, [...open, ...store.candidates(input)], Date.now(), 7, settings?.searchUrl())
})
handle('overlay', (open) => tabs?.setOverlay(open === true) ?? null)
on('overlay:hide', (t) => t.hidePageForOverlay())
handleSurface('history:list', (query, before) => store?.history(str(query) ? query : '', num(before) ? before : null) ?? [])
handle('history:delete', (id) => {
  if (num(id)) store?.deleteVisit(id)
  dataChanged()
})
handle('history:clear', (msAgo) => {
  if (!num(msAgo) || msAgo < 0) return
  store?.clear(msAgo === 0 ? 0 : Date.now() - msAgo)
  dataChanged()
})
handleSurface('bookmarks:list', () => store?.bookmarks() ?? [])
onSurface('bookmark:toggle', (t) => t.toggleBookmark())
handle('bookmark:remove', (url) => {
  if (str(url)) store?.removeBookmark(url)
  dataChanged()
})
handle('bookmark:rename', (url, title) => {
  if (str(url) && str(title)) store?.renameBookmark(url, title)
  dataChanged()
})

handle('settings:get', () => settings?.view() ?? null)
handle('settings:update', (patch) => {
  if (!settings || !patch || typeof patch !== 'object' || Array.isArray(patch)) return settings?.view() ?? null
  // Custom downloads folders are chosen only via the main-process folder dialog; here only '' (reset) is accepted.
  const raw = patch as Record<string, unknown>
  const safePatch: Record<string, unknown> = { ...raw }
  if ('downloadsDir' in safePatch && safePatch.downloadsDir !== '') delete safePatch.downloadsDir
  // Custom start-page background files are only created by main's image picker; renderer may only clear to ''.
  if (safePatch.startPage && typeof safePatch.startPage === 'object' && !Array.isArray(safePatch.startPage)) {
    const sp = { ...(safePatch.startPage as Record<string, unknown>) }
    if ('backgroundImage' in sp && sp.backgroundImage !== '') delete sp.backgroundImage
    safePatch.startPage = sp
  }
  const prev = settings.get()
  const view = settings.update(safePatch)
  if (view.theme !== prev.theme) nativeTheme.themeSource = view.theme
  if (view.compactMode !== prev.compactMode) syncCompactMode()
  if (view.sleepAfterMinutes !== prev.sleepAfterMinutes || view.sleepPinnedTabs !== prev.sleepPinnedTabs) {
    tabs?.refreshSleepPolicy()
  }
  sendSettings()
  applyWindowAppearance()
  if (view.compactMode && (view.appearance.sidebarSide !== prev.appearance.sidebarSide || view.appearance.sidebarWidth !== prev.appearance.sidebarWidth)) {
    syncCompactPanels()
  }
  return view
})
handle('settings:export-theme', async () => {
  if (!settings || !win || win.isDestroyed()) return { ok: false, error: 'Window unavailable.' }
  const cur = settings.get()
  const result = await dialog.showSaveDialog(win, {
    title: 'Export Veyra Orbit theme',
    defaultPath: `veyra-orbit-${cur.appearance.preset}.json`,
    filters: [{ name: 'JSON theme', extensions: ['json'] }]
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  try {
    writeFileSync(result.filePath, exportAppearanceJson(cur.theme, cur.appearance), 'utf8')
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not save the theme file.' }
  }
})
handle('settings:import-theme', async () => {
  if (!settings || !win || win.isDestroyed()) return { ok: false, error: 'Window unavailable.' }
  const result = await dialog.showOpenDialog(win, {
    title: 'Import Veyra Orbit theme',
    filters: [{ name: 'JSON theme', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
  try {
    const raw = readFileSync(result.filePaths[0], 'utf8')
    const parsed = parseImportedAppearanceJson(raw)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const patchObj: Record<string, unknown> = { appearance: parsed.appearance }
    if (parsed.theme) patchObj.theme = parsed.theme
    const view = settings.update(patchObj)
    if (parsed.theme) nativeTheme.themeSource = view.theme
    sendSettings()
    applyWindowAppearance()
    if (view.compactMode) syncCompactPanels()
    return { ok: true, settings: view }
  } catch {
    return { ok: false, error: 'Could not read the selected theme file.' }
  }
})
handle('settings:choose-downloads-dir', async () => {
  if (!settings || !win || win.isDestroyed()) return settings?.view() ?? null
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose downloads folder',
    defaultPath: settings.effectiveDownloadsDir(),
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return settings.view()
  const view = settings.update({ downloadsDir: result.filePaths[0] })
  sendSettings()
  return view
})

handle('startpage:data', () => {
  const isPrivate = !!tabs && tabs.isPrivateWorkspace(tabs.state().activeWorkspaceId)
  if (isPrivate || !store || !tabs) {
    return { topSites: [], recentlyClosed: [], recentHistory: [], bookmarks: [] }
  }
  const topSites = store.topSites(8).map((s) => ({
    url: s.url,
    title: s.title,
    favicon: tabs?.cachedFavicon(s.url),
    time: s.last
  }))
  const recentlyClosed = tabs.recentClosedTabs(6)
  const seenRecent = new Set(recentlyClosed.map((c) => c.url))
  const recentHistory = store
    .history('', null, 24)
    .filter((h) => {
      if (seenRecent.has(h.url)) return false
      seenRecent.add(h.url)
      return true
    })
    .slice(0, 8)
    .map((h) => ({
      url: h.url,
      title: h.title,
      favicon: tabs?.cachedFavicon(h.url),
      time: h.time
    }))
  const bookmarks = store
    .bookmarks()
    .slice(0, 12)
    .map((b) => ({
      ...b,
      favicon: tabs?.cachedFavicon(b.url)
    }))
  return { topSites, recentlyClosed, recentHistory, bookmarks }
})

handle('startpage:get-background', () => {
  const filename = settings?.get().startPage.backgroundImage ?? ''
  if (!filename) return null
  return readStartBackgroundDataUrl(app.getPath('userData'), filename)
})

handle('startpage:choose-background', async () => {
  if (!settings || !win || win.isDestroyed()) return { ok: false, error: 'Window unavailable.' }
  const prev = settings.get().startPage.backgroundImage
  const res = await chooseAndSaveStartBackground(win, app.getPath('userData'), prev)
  if (!res.ok) return res
  const view = settings.update({
    startPage: {
      background: 'image',
      backgroundImage: res.filename
    }
  })
  sendSettings()
  return { ok: true, dataUrl: res.dataUrl, settings: view }
})

handle('startpage:remove-background', () => {
  if (!settings) return null
  const prev = settings.get().startPage.backgroundImage
  if (prev) deleteStartBackgroundFile(app.getPath('userData'), prev)
  const curBg = settings.get().startPage.background
  const view = settings.update({
    startPage: {
      backgroundImage: '',
      ...(curBg === 'image' ? { background: 'ambient' } : {})
    }
  })
  sendSettings()
  return view
})

handle('permissions:list', () => perms?.listSaved() ?? [])
handle('permissions:set', (origin, permission, allow) => {
  if (!str(origin) || !str(permission)) return false
  return perms?.setSaved(origin, permission, allow === true) ?? false
})
handle('permissions:remove', (origin, permission) => {
  if (str(origin) && str(permission)) perms?.removeSaved(origin, permission)
})

handle('privacy:clear', async (req) => {
  if (!req || typeof req !== 'object' || Array.isArray(req)) return
  const r = req as Record<string, unknown>
  const range = typeof r.range === 'string' && CLEAR_RANGES.has(r.range as ClearDataRange) ? (r.range as ClearDataRange) : null
  if (!range) return
  if (r.history === true) {
    const since = range === 'all' ? 0 : Date.now() - (range === 'hour' ? HOUR_MS : 24 * HOUR_MS)
    store?.clear(since)
    dataChanged()
  }
  const partitions = new Set<string>([WEB_PARTITION, ...(tabs?.workspacePartitions() ?? [])])
  for (const part of partitions) {
    const sess = sessionForPartition(part)
    if (r.siteData === true) {
      // Omit 'serviceworkers' so clearing browsing data doesn't tear down installed MV3 extension service workers.
      await sess.clearStorageData({
        storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'cachestorage']
      })
    }
    if (r.cache === true) await sess.clearCache()
  }
})

on('permission:answer', (_t, id: unknown, allow: unknown, remember?: unknown) => {
  if (num(id)) perms?.answer(id, allow === true, remember === undefined ? true : remember === true)
})
on('external-app:answer', (_t, id: unknown, open: unknown) => {
  if (num(id)) externalApps?.answer(id, open === true)
})
on('find:start', (t, text: unknown, opts: unknown) => {
  if (!str(text)) return
  const o = opts && typeof opts === 'object' ? (opts as { forward?: unknown; findNext?: unknown }) : undefined
  t.find(text, {
    forward: o?.forward === undefined ? true : o.forward === true,
    findNext: o?.findNext === undefined ? true : o.findNext === true
  })
})
on('find:stop', (t) => t.stopFind())
onSurface('download:pause', (_t, id: unknown) => {
  if (num(id)) downloads?.pause(id)
})
onSurface('download:resume', (_t, id: unknown) => {
  if (num(id)) downloads?.resume(id)
})
onSurface('download:cancel', (_t, id: unknown) => {
  if (num(id)) downloads?.cancel(id)
})
onSurface('download:open', (_t, id: unknown) => {
  if (num(id)) downloads?.open(id)
})
onSurface('download:show', (_t, id: unknown) => {
  if (num(id)) downloads?.show(id)
})
onSurface('download:clear', () => {
  downloads?.clearFinished()
})
handle('update:state', () => updater?.state() ?? null)
handleSurface('update:check', () => updater?.check(true) ?? null)
onSurface('update:install', () => updater?.install())

handle('import:status', () => importer?.status() ?? { profiles: [], showFirstRunPrompt: false })
handle('import:dismiss-prompt', () => importer?.dismissPrompt())

// Chrome extensions IPC: strictly gated to Orbit's own UI / compact titlebar.
handle('extensions:get-state', () => extManager?.getState() ?? { extensions: [], developerMode: false })
handleSurface('extensions:get-actions', () => extManager?.getToolbarActions() ?? [])
handle('extensions:set-enabled', (id, enabled) => {
  if (!str(id) || !extManager) return false
  return extManager.setEnabled(id, enabled === true)
})
handleSurface('extensions:set-pinned', (id, pinned) => {
  if (!str(id) || !extManager) return false
  return extManager.setPinned(id, pinned === true)
})
handle('extensions:install-store', (idOrUrl) => {
  if (!str(idOrUrl) || !extManager) return { ok: false, error: 'Invalid extension ID.' }
  return extManager.installFromStoreById(idOrUrl)
})
handle('extensions:install-unpacked', async () => {
  if (!extManager || !win || win.isDestroyed()) return { ok: false, error: 'Window unavailable.' }
  if (!extManager.getState().developerMode) return { ok: false, error: 'Enable Developer mode first.' }
  const result = await dialog.showOpenDialog(win, {
    title: 'Load unpacked extension',
    properties: ['openDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }
  return extManager.loadUnpackedFromDirectory(result.filePaths[0])
})
handle('extensions:uninstall', (id) => {
  if (!str(id) || !extManager) return false
  return extManager.uninstall(id)
})
on('extensions:open-options', (_t, id: unknown) => {
  if (str(id)) extManager?.openOptions(id)
})
handle('extensions:set-dev-mode', (enabled) => {
  if (!extManager) return false
  return extManager.setDeveloperMode(enabled === true)
})
on('extensions:install-answer', (_t, requestId: unknown, allow: unknown) => {
  if (str(requestId)) extManager?.answerInstallAsk(requestId, allow === true)
})
ipcMain.on('extensions:action-click', (e, id: unknown, rawRect: unknown) => {
  if (!fromUiSurface(e) || !str(id) || !extManager) return
  const r = rawRect as Partial<Rect> | null
  if (!r || !num(r.x) || !num(r.y) || !num(r.width) || !num(r.height)) return
  const offset = compactTitlebar?.isSender(e.sender) ? compactTitlebar.offsetCss() : { x: 0, y: 0 }
  extManager.activateAction(id, { x: r.x + offset.x, y: r.y + offset.y, width: r.width, height: r.height })
})
ipcMain.on('extensions:action-context-menu', (e, id: unknown, rawRect: unknown) => {
  if (!fromUiSurface(e) || !str(id) || !extManager) return
  const r = rawRect as Partial<Rect> | null
  if (!r || !num(r.x) || !num(r.y) || !num(r.width) || !num(r.height)) return
  const offset = compactTitlebar?.isSender(e.sender) ? compactTitlebar.offsetCss() : { x: 0, y: 0 }
  extManager.openActionContextMenu(id, { x: r.x + offset.x, y: r.y + offset.y, width: r.width, height: r.height })
})
handle('import:run', (raw) => {
  if (!importer || !store || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      browserName: '',
      profileName: '',
      bookmarksImported: 0,
      bookmarksSkipped: 0,
      historyImported: 0,
      historySkipped: 0,
      error: 'Invalid import request.'
    }
  }
  const r = raw as Record<string, unknown>
  if (!str(r.profileId)) {
    return {
      ok: false,
      browserName: '',
      profileName: '',
      bookmarksImported: 0,
      bookmarksSkipped: 0,
      historyImported: 0,
      historySkipped: 0,
      error: 'Missing browser profile.'
    }
  }
  const result = importer.runImport(
    { profileId: r.profileId, bookmarks: r.bookmarks === true, history: r.history === true },
    store
  )
  if (result.ok && (result.bookmarksImported > 0 || result.historyImported > 0)) {
    dataChanged()
  }
  return result
})

nativeTheme.on('updated', () => {
  if (!win || win.isDestroyed()) return
  applyWindowAppearance()
})

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

void app.whenReady().then(createWindow)
app.on('will-quit', () => {
  stopCompactPoller()
  updater?.stop()
  store?.close()
  store = null
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (!win) createWindow()
})

// Bounded UI smoke runs can opt in to a self-terminating Electron process.
const smokeExitMs = Number(process.env.VEYRA_TEST_EXIT_MS)
if (!app.isPackaged && Number.isFinite(smokeExitMs) && smokeExitMs > 0) {
  setTimeout(() => app.exit(0), Math.min(smokeExitMs, 120_000))
}

// Dev-only memory measurement hook for tools/measure-memory.mjs. Never runs in packaged builds.
if (!app.isPackaged && process.env.VEYRA_MEASURE_IPC_DIR) {
  const ipcDir = process.env.VEYRA_MEASURE_IPC_DIR
  const reqFile = join(ipcDir, 'req.json')
  const collectMeasureSnapshot = (label: string): Record<string, unknown> => {
    const metrics = app.getAppMetrics()
    const wcByPid = new Map<number, string[]>()
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed()) continue
      const pid = wc.getOSProcessId()
      const url = wc.getURL()
      let desc = url
      if (url.includes('index.html')) {
        try {
          const view = new URL(url).searchParams.get('view')
          desc = view ? `floating:${view}` : 'main-ui'
        } catch {
          desc = 'orbit-ui'
        }
      } else if (url.length > 80) {
        desc = url.slice(0, 77) + '...'
      }
      const list = wcByPid.get(pid) ?? []
      list.push(desc || '(blank)')
      wcByPid.set(pid, list)
    }

    const processes = metrics.map((m) => ({
      pid: m.pid,
      type: m.type,
      name: m.name ?? m.serviceName ?? '',
      workingSetKB: m.memory.workingSetSize ?? 0,
      privateKB: m.memory.privateBytes ?? 0,
      peakWorkingSetKB: m.memory.peakWorkingSetSize ?? 0,
      targets: wcByPid.get(m.pid) ?? []
    }))

    const allTabs = tabs?.allTabs() ?? []
    const totalWorkingSetKB = processes.reduce((s, p) => s + p.workingSetKB, 0)
    const totalPrivateKB = processes.reduce((s, p) => s + p.privateKB, 0)
    return {
      label,
      timestamp: Date.now(),
      windowCount: BrowserWindow.getAllWindows().length,
      webContentsCount: webContents.getAllWebContents().filter((w) => !w.isDestroyed()).length,
      tabs: {
        total: allTabs.length,
        loading: allTabs.filter((t) => t.loading).length,
        sleeping: allTabs.filter((t) => t.sleeping).length
      },
      processCount: processes.length,
      totalWorkingSetKB,
      totalPrivateKB,
      processes
    }
  }

  const measurePoll = setInterval(() => {
    if (!existsSync(reqFile)) return
    let req: { id?: string; cmd?: string; label?: string } | null = null
    try {
      req = JSON.parse(readFileSync(reqFile, 'utf8')) as { id?: string; cmd?: string; label?: string }
      unlinkSync(reqFile)
    } catch {
      return
    }
    if (!req?.cmd) return
    if (req.cmd === 'quit') {
      clearInterval(measurePoll)
      app.exit(0)
      return
    }
    if (req.cmd === 'metrics' && req.id) {
      const snap = collectMeasureSnapshot(req.label ?? '')
      try {
        mkdirSync(ipcDir, { recursive: true })
        const tmp = join(ipcDir, `res-${req.id}.tmp`)
        const out = join(ipcDir, `res-${req.id}.json`)
        writeFileSync(tmp, JSON.stringify(snap), 'utf8')
        renameSync(tmp, out)
      } catch {
        /* ignore */
      }
    }
  }, 80)
  measurePoll.unref()
  app.on('will-quit', () => clearInterval(measurePoll))
}
