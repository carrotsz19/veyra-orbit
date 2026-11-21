import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, type IpcMainEvent, type IpcMainInvokeEvent, type Session } from 'electron'
import { join } from 'node:path'
import { release } from 'node:os'
import type { ClearDataRange, CompactPinKind, CompactRevealState, ExternalAppAsk, PermissionAsk, Rect, WorkspaceCreateInput, WorkspaceUpdateInput } from '../shared/types'
import { toUrl } from '../shared/url'
import { suggest, type Candidate } from '../shared/suggest'
import { computeCompactZones } from '../shared/compact'
import { resolveSleepTimeoutMs } from '../shared/sleep'
import { Tabs } from './tabs'
import { Store } from './store'
import { SettingsStore } from './settings'
import { ExternalApps, Permissions, WEB_PARTITION, cleanUserAgent, hardenAll, sessionForPartition } from './security'
import { attachSessionCompat } from './compat'
import { Downloads } from './downloads'
import { Updater } from './updater'

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
const TITLE_BAR_H = 40
const HOUR_MS = 3_600_000
const CLEAR_RANGES = new Set<ClearDataRange>(['hour', 'day', 'all'])
const COMPACT_POLL_MS = 60
const COMPACT_HIDE_DELAY_MS = 240

function overlay(): Electron.TitleBarOverlayOptions {
  const dark = nativeTheme.shouldUseDarkColors
  return { color: acrylic ? '#00000000' : dark ? '#15140f' : '#f3f1ec', symbolColor: dark ? '#e9e5dc' : '#2c2a26', height: TITLE_BAR_H }
}

let win: BrowserWindow | null = null
let tabs: Tabs | null = null
let perms: Permissions | null = null
let externalApps: ExternalApps | null = null
let downloads: Downloads | null = null
let asks: PermissionAsk[] = []
let externalAsks: ExternalAppAsk[] = []
let store: Store | null = null
let settings: SettingsStore | null = null
let updater: Updater | null = null

/** Compact mode runtime state for the active window. */
let compactState: CompactRevealState = { enabled: false, sidebar: false, toolbar: false }
let compactPins = { omnibox: false, sidebar: false, menu: false }
let compactHover = { sidebar: false, toolbar: false }
let lastPolledCursor: { x: number; y: number } | null = null
let compactPoller: NodeJS.Timeout | null = null
let sideHideTimer: NodeJS.Timeout | null = null
let barHideTimer: NodeJS.Timeout | null = null

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
        if (win && !win.isDestroyed()) win.webContents.send('compact:state', compactState)
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
      if (!compactPins.omnibox && !compactHover.toolbar && compactState.toolbar) {
        compactState = { ...compactState, toolbar: false }
        if (win && !win.isDestroyed()) win.webContents.send('compact:state', compactState)
      }
    }, COMPACT_HIDE_DELAY_MS)
  }

  if (changed && win && !win.isDestroyed()) {
    win.webContents.send('compact:state', compactState)
  }
}

function sendCompactState(force = false): void {
  if (!win || win.isDestroyed()) return
  const enabled = !!settings?.get().compactMode
  const next: CompactRevealState = enabled
    ? {
        enabled: true,
        sidebar: compactState.sidebar || compactPins.sidebar || compactPins.menu || compactHover.sidebar,
        toolbar: compactState.toolbar || compactPins.omnibox || compactHover.toolbar
      }
    : { enabled: false, sidebar: false, toolbar: false }

  if (!force && next.enabled === compactState.enabled && next.sidebar === compactState.sidebar && next.toolbar === compactState.toolbar) {
    return
  }
  compactState = next
  win.webContents.send('compact:state', compactState)
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

  const focused = win.isFocused()
  const cursor = screen.getCursorScreenPoint()
  const moved = lastPolledCursor !== null && (cursor.x !== lastPolledCursor.x || cursor.y !== lastPolledCursor.y)
  lastPolledCursor = cursor

  const content = win.getContentBounds()
  const zones = computeCompactZones({
    rx: cursor.x - content.x,
    ry: cursor.y - content.y,
    contentWidth: content.width,
    contentHeight: content.height,
    sidebarOpen: compactState.sidebar,
    toolbarOpen: compactState.toolbar
  })

  // If the OS cursor is outside the window and hasn't moved (e.g. non-interactive desktop session),
  // defer to the thin always-visible edge strips so we don't override DOM hover state.
  if (!zones.insideWindow && !moved) {
    applyCompactTargets(compactHover.sidebar || compactPins.sidebar || compactPins.menu, compactHover.toolbar || compactPins.omnibox)
    return
  }

  // Only reveal newly when the window is focused; keep-open or pinned states still hold cleanly.
  const sideByCursor = focused ? zones.wantSidebar : compactState.sidebar && zones.wantSidebar
  const barByCursor = focused ? zones.wantToolbar : compactState.toolbar && zones.wantToolbar
  const wantSide = sideByCursor || compactHover.sidebar || compactPins.sidebar || compactPins.menu
  const wantBar = barByCursor || compactHover.toolbar || compactPins.omnibox
  applyCompactTargets(wantSide, wantBar)
}

function syncCompactMode(): void {
  const enabled = !!settings?.get().compactMode
  if (!enabled) {
    stopCompactPoller()
    compactHover = { sidebar: false, toolbar: false }
    compactState = { enabled: false, sidebar: false, toolbar: false }
    sendCompactState(true)
    return
  }
  compactState = {
    enabled: true,
    sidebar: compactPins.sidebar || compactPins.menu || compactHover.sidebar,
    toolbar: compactPins.omnibox || compactHover.toolbar
  }
  sendCompactState(true)
  if (!compactPoller) {
    compactPoller = setInterval(pollCompactCursor, COMPACT_POLL_MS)
  }
}

/** History and bookmarks changed: the UI re-reads them (the Library page, the star). */
function dataChanged(): void {
  tabs?.refresh()
  if (win && !win.isDestroyed()) win.webContents.send('data-changed')
}

function sendSettings(): void {
  if (win && !win.isDestroyed() && settings) win.webContents.send('settings', settings.view())
}

function toggleCompactMode(): void {
  if (!settings) return
  settings.update({ compactMode: !settings.get().compactMode })
  sendSettings()
  syncCompactMode()
}

function createWindow(): void {
  settings ??= new SettingsStore(join(app.getPath('userData'), 'settings.json'), app.getPath('downloads'), process.env.VEYRA_DOWNLOADS || '')
  const s = settings
  nativeTheme.themeSource = s.get().theme

  const w = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: APP_NAME,
    icon: join(__dirname, `../../resources/${__CHANNEL__ === 'dev' ? 'icon-dev.png' : 'icon.png'}`),
    autoHideMenuBar: true,
    ...(acrylic ? { backgroundColor: '#00000000', backgroundMaterial: 'acrylic' as const } : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#15140f' : '#f3f1ec' }),
    ...(isWin ? { titleBarStyle: 'hidden' as const, titleBarOverlay: overlay() } : { titleBarStyle: 'hiddenInset' as const }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  win = w

  // The browser's own UI never navigates and never opens windows; pages do that in tabs.
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  store ??= new Store(join(app.getPath('userData'), 'orbit.db'))
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
      if (!w.isDestroyed()) w.webContents.send('downloads', list)
    }
  )
  const d = downloads

  const configuredSessions = new Set<Session>()
  const onDownload = (_e: Electron.Event, _item: Electron.DownloadItem, wc: Electron.WebContents): void => tabs?.downloadStarted(wc)

  /**
   * Single setup path for every web session partition (the shared persist:web partition and every
   * isolated workspace persist:ws-<id> partition) so security, site compat and downloads never drift.
   */
  const setupWebSession = (partition: string): Session => {
    // Without the permission handler a session falls back to Electron's default, which allows every
    // permission, so a session must never be set up before Permissions exists.
    if (!perms) throw new Error('web session set up before permissions')
    const sess = sessionForPartition(partition)
    if (configuredSessions.has(sess)) return sess
    configuredSessions.add(sess)
    perms.attach(sess)
    attachSessionCompat(sess)
    d.attach(sess)
    sess.on('will-download', onDownload)
    return sess
  }

  tabs = new Tabs(w, join(app.getPath('userData'), 'session.json'), {
    visit: (url, title, typed) => {
      db.visit(url, title, typed)
      if (win) win.webContents.send('data-changed')
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
    hasPendingPermission: (tabId) => perms?.hasPendingPermission(tabId) ?? false,
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
      if (!settings?.get().compactMode) return
      if (barHideTimer) {
        clearTimeout(barHideTimer)
        barHideTimer = null
      }
      compactPins.omnibox = true
      compactState = { ...compactState, toolbar: true }
      sendCompactState(true)
    }
  })
  const t = tabs

  perms = new Permissions(
    (wc) => t.tabIdOf(wc),
    (list) => {
      asks = list
      if (!w.isDestroyed()) w.webContents.send('permissions', list)
    },
    db,
    () => {
      if (!w.isDestroyed()) w.webContents.send('permissions:saved', perms?.listSaved() ?? [])
    }
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

  w.once('ready-to-show', () => w.show())
  // Windows flickers acrylic on a full-screen window, so full screen is solid; and a page in
  // full screen leaves it when the window does (Esc, F11).
  w.on('enter-full-screen', () => {
    if (acrylic) {
      w.setBackgroundMaterial('none')
      w.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#15140f' : '#f3f1ec')
    }
    t.relayout()
  })
  w.on('leave-full-screen', () => {
    if (acrylic) {
      w.setBackgroundColor('#00000000')
      w.setBackgroundMaterial('acrylic')
    }
    t.exitPageFullscreen()
  })
  w.on('resize', () => t.relayout())
  w.on('close', () => t.save())
  w.on('closed', () => {
    stopCompactPoller()
    compactPins = { omnibox: false, sidebar: false, menu: false }
    compactHover = { sidebar: false, toolbar: false }
    compactState = { enabled: false, sidebar: false, toolbar: false }
    for (const sess of configuredSessions) sess.off('will-download', onDownload)
    configuredSessions.clear()
    d.detach()
    if (downloads === d) downloads = null
    t.dispose()
    win = null
    tabs = null
  })

  const query = { material: acrylic ? 'acrylic' : 'solid', platform: process.platform }
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
  else void w.loadFile(join(__dirname, '../renderer/index.html'), { query })

  t.restore(s.get().startup !== 'new-tab')
  syncCompactMode()

  if (!updater) {
    updater = new Updater((state) => {
      if (win && !win.isDestroyed()) win.webContents.send('update:state', state)
    })
    updater.start()
  }
}

/** Only the browser's own UI may call these; pages have no preload and can't reach them anyway. */
function fromUi(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return !!win && e.sender === win.webContents
}

function on<A extends unknown[]>(channel: string, f: (t: Tabs, ...args: A) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromUi(e) && tabs) f(tabs, ...(args as A))
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
  sendCompactState(true)
  win.webContents.send('page-fullscreen', tabs.isPageFullscreen())
  if (updater) win.webContents.send('update:state', updater.state())
})
on('tab:new', (t, input?: unknown) => t.create((str(input) && toUrl(input, settings?.searchUrl())) || ''))
on('tab:close', (t, id: unknown) => num(id) && t.close(id))
on('tab:activate', (t, id: unknown) => num(id) && t.activate(id))
// Everything the UI navigates to was typed (address bar, start page), which history ranks higher.
on('tab:navigate', (t, id: unknown, input: unknown) => num(id) && str(input) && t.navigate(id, input, true))
on('tab:pin', (t, id: unknown) => num(id) && t.togglePin(id))
on('tab:move', (t, id: unknown, to: unknown) => num(id) && num(to) && t.move(id, to))
on('nav:back', (t) => t.back())
on('nav:forward', (t) => t.forward())
on('nav:reload', (t) => t.reload())
on('nav:stop', (t) => t.stop())
on('nav:zoom-reset', (t) => t.resetZoom())
on('tab:mute', (t, id: unknown) => num(id) && t.toggleMute(id))
on('tab:sleep', (t, id: unknown) => num(id) && t.sleepTab(id, true))
on('tab:menu', (t, id: unknown) => num(id) && t.tabMenu(id))
on('workspace:switch', (t, id: unknown) => str(id) && t.switchWorkspace(id))
on('compact:toggle', () => toggleCompactMode())
on('compact:pin', (_t, kind: unknown, pinned: unknown) => {
  if (kind !== 'omnibox' && kind !== 'sidebar') return
  const k = kind as CompactPinKind
  compactPins[k] = pinned === true
  if (settings?.get().compactMode) {
    applyCompactTargets(compactHover.sidebar || compactPins.sidebar || compactPins.menu, compactHover.toolbar || compactPins.omnibox)
  }
})
on('compact:hover', (_t, edge: unknown, hovering: unknown) => {
  if (edge !== 'sidebar' && edge !== 'toolbar') return
  compactHover[edge] = hovering === true
  if (settings?.get().compactMode && !tabs?.isPageFullscreen()) {
    applyCompactTargets(compactHover.sidebar || compactPins.sidebar || compactPins.menu, compactHover.toolbar || compactPins.omnibox)
  }
})
on('bounds', (t, r: unknown) => {
  const rect = r as Rect | null
  if (rect === null) return t.setBounds(null)
  if (rect && num(rect.x) && num(rect.y) && num(rect.width) && num(rect.height)) t.setBounds(rect)
})

/** Calls from the UI that answer back. Pages can't reach these either. */
function handle(channel: string, f: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromUi(e)) throw new Error('not allowed')
    return f(...args)
  })
}

handle('workspace:create', (input) => {
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

handle('workspace:update', (id, patch) => {
  if (!tabs || !str(id) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return null
  const raw = patch as Record<string, unknown>
  const req: WorkspaceUpdateInput = {}
  if (str(raw.name)) req.name = raw.name
  if (str(raw.icon)) req.icon = raw.icon
  if (str(raw.accent)) req.accent = raw.accent as WorkspaceUpdateInput['accent']
  if (typeof raw.isolated === 'boolean') req.isolated = raw.isolated
  return tabs.updateWorkspace(id, req)
})

handle('workspace:delete', (id) => {
  if (!tabs || !str(id)) return false
  return tabs.deleteWorkspace(id)
})

handle('suggest', (input) => {
  if (!str(input) || !store || !tabs) return []
  const open: Candidate[] = tabs
    .allTabs()
    .filter((t) => /^https?:/.test(t.url))
    .map((t) => ({ url: t.url, title: t.title, visits: 0, typed: 0, last: 0, bookmarked: t.bookmarked, tabId: t.id }))
  return suggest(input, [...open, ...store.candidates(input)], Date.now(), 7, settings?.searchUrl())
})
handle('overlay', (open) => tabs?.setOverlay(open === true) ?? null)
on('overlay:hide', (t) => t.hidePageForOverlay())
handle('history:list', (query, before) => store?.history(str(query) ? query : '', num(before) ? before : null) ?? [])
handle('history:delete', (id) => {
  if (num(id)) store?.deleteVisit(id)
  dataChanged()
})
handle('history:clear', (msAgo) => {
  if (!num(msAgo) || msAgo < 0) return
  store?.clear(msAgo === 0 ? 0 : Date.now() - msAgo)
  dataChanged()
})
handle('bookmarks:list', () => store?.bookmarks() ?? [])
on('bookmark:toggle', (t) => t.toggleBookmark())
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
  const prev = settings.get()
  const view = settings.update(safePatch)
  if (view.theme !== prev.theme) nativeTheme.themeSource = view.theme
  if (view.compactMode !== prev.compactMode) syncCompactMode()
  if (view.sleepAfterMinutes !== prev.sleepAfterMinutes || view.sleepPinnedTabs !== prev.sleepPinnedTabs) {
    tabs?.refreshSleepPolicy()
  }
  sendSettings()
  return view
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
    if (r.siteData === true) await sess.clearStorageData()
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
on('download:pause', (_t, id: unknown) => {
  if (num(id)) downloads?.pause(id)
})
on('download:resume', (_t, id: unknown) => {
  if (num(id)) downloads?.resume(id)
})
on('download:cancel', (_t, id: unknown) => {
  if (num(id)) downloads?.cancel(id)
})
on('download:open', (_t, id: unknown) => {
  if (num(id)) downloads?.open(id)
})
on('download:show', (_t, id: unknown) => {
  if (num(id)) downloads?.show(id)
})
on('download:clear', () => {
  downloads?.clearFinished()
})
handle('update:state', () => updater?.state() ?? null)
handle('update:check', () => updater?.check(true) ?? null)
on('update:install', () => updater?.install())

nativeTheme.on('updated', () => {
  if (!win || win.isDestroyed()) return
  if (isWin) win.setTitleBarOverlay(overlay())
  if (!acrylic) win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#15140f' : '#f3f1ec')
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
