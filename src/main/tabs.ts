/*
 * The tabs. Each one is its own WebContentsView (its own sandboxed Chromium renderer). Only the
 * active tab's view is in the window, placed where the UI says the page goes. New tabs start
 * without a page, and tabs restored from last time load only when you open them.
 */
import { BrowserWindow, Menu, WebContentsView, clipboard, type Input, type WebContents } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BrowserState, Rect, TabInfo } from '../shared/types'
import { INTERNAL_PAGES, SEARCH_URL, isAllowedUrl, isInternalUrl, toUrl } from '../shared/url'
import { clampZoomLevel, zoomPercent } from '../shared/format'
import { WEB_PARTITION } from './security'

interface Tab {
  info: TabInfo
  view: WebContentsView
  /** A restored tab's address, loaded the first time the tab is opened. */
  pendingUrl?: string
  /** The next page this tab opens was typed in the address bar (for history ranking). */
  typed?: boolean
}

/** What the tabs tell the rest of the browser about, and ask it. */
export interface TabHooks {
  /** A page was opened in a tab. */
  visit(url: string, title: string, typed: boolean): void
  title(url: string, title: string): void
  isBookmarked(url: string): boolean
  toggleBookmark(url: string, title: string): void
}

interface SavedSession {
  tabs: { url: string; title: string; pinned: boolean }[]
  active: number
}

const ZOOM_STEP = 0.5

export class Tabs {
  private tabs: Tab[] = []
  private activeId: number | null = null
  private nextId = 1
  private bounds: Rect | null = null
  /** The tab whose page asked for full screen (a video, a slideshow); its page fills the window. */
  private fullscreenTab: Tab | null = null
  /** True when Orbit put the window into full screen for the page (vs the user pressing F11 first). */
  private fullscreenByPage = false
  private attached: WebContentsView | null = null
  private closed: { url: string; title: string; pinned: boolean }[] = []
  private emitQueued = false
  private saveTimer: NodeJS.Timeout | null = null
  private findOpen = false
  private findQuery = ''

  /** Called when a tab closes or leaves its page, so its open permission questions can be dropped. */
  onTabGone: (id: number) => void = () => {}
  /** While true, floating UI is open above the page, so the page view is taken out. */
  private overlayOpen = false

  constructor(
    private win: BrowserWindow,
    private sessionFile: string,
    private hooks: TabHooks
  ) {}

  // ---- reading ------------------------------------------------------------

  state(): BrowserState {
    return { tabs: this.tabs.map((t) => ({ ...t.info, bookmarked: !!t.info.url && this.hooks.isBookmarked(t.info.url) })), activeId: this.activeId }
  }

  tabIdOf(wc: WebContents): number | null {
    return this.tabs.find((t) => t.view.webContents === wc)?.info.id ?? null
  }

  private get(id: number): Tab | undefined {
    return this.tabs.find((t) => t.info.id === id)
  }

  private get active(): Tab | undefined {
    return this.activeId === null ? undefined : this.get(this.activeId)
  }

  // ---- making and closing tabs -------------------------------------------

  /** A new tab. With no URL it shows the start page. */
  create(url = '', opts: { activate?: boolean; after?: number; pinned?: boolean; lazy?: boolean; title?: string } = {}): number {
    const view = new WebContentsView({
      webPreferences: {
        partition: WEB_PARTITION,
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
    try {
      view.setBorderRadius(10)
    } catch {
      /* older Electron: square corners */
    }
    const id = this.nextId++
    const tab: Tab = {
      view,
      info: {
        id,
        url,
        title: opts.title ?? (isInternalUrl(url) ? INTERNAL_PAGES[url] : ''),
        loading: false,
        canGoBack: false,
        canGoForward: false,
        pinned: !!opts.pinned,
        bookmarked: false,
        zoom: 100,
        audible: false,
        muted: false
      }
    }
    this.wire(tab)

    const at = opts.after !== undefined ? this.tabs.findIndex((t) => t.info.id === opts.after) + 1 : this.tabs.length
    this.tabs.splice(at > 0 ? at : this.tabs.length, 0, tab)
    this.sortPinned()

    if (url && isAllowedUrl(url)) {
      if (opts.lazy) tab.pendingUrl = url
      else void view.webContents.loadURL(url).catch(() => {})
    }
    if (opts.activate !== false) this.activate(id)
    else this.changed()
    return id
  }

  close(id: number): void {
    const i = this.tabs.findIndex((t) => t.info.id === id)
    if (i < 0) return
    if (this.activeId === id) this.stopFind(true)
    if (this.fullscreenTab?.info.id === id) {
      const restoreWindow = this.fullscreenByPage
      this.fullscreenTab = null
      this.fullscreenByPage = false
      if (restoreWindow && this.win.isFullScreen()) this.win.setFullScreen(false)
      if (!this.win.isDestroyed()) this.win.webContents.send('page-fullscreen', false)
    }
    const [tab] = this.tabs.splice(i, 1)
    if (tab.info.url) this.closed.push({ url: tab.info.url, title: tab.info.title, pinned: tab.info.pinned })
    if (this.closed.length > 25) this.closed.shift()
    if (this.attached === tab.view) {
      this.win.contentView.removeChildView(tab.view)
      this.attached = null
    }
    this.onTabGone(id)
    tab.view.webContents.close()
    if (this.activeId === id) {
      // The tab that slides into its place, or the one before it.
      const next = this.tabs[i] ?? this.tabs[i - 1]
      this.activeId = null
      if (next) this.activate(next.info.id)
    }
    if (!this.tabs.length) this.create()
    this.changed()
  }

  reopenClosed(): void {
    const last = this.closed.pop()
    if (last) this.create(last.url, { pinned: last.pinned, title: last.title })
  }

  activate(id: number): void {
    const tab = this.get(id)
    if (!tab) return
    if (this.activeId !== null && this.activeId !== id) {
      this.stopFind(true)
      if (this.fullscreenTab) this.exitPageFullscreen(true)
    }
    this.activeId = id
    if (tab.pendingUrl) {
      const url = tab.pendingUrl
      tab.pendingUrl = undefined
      void tab.view.webContents.loadURL(url).catch(() => {})
    }
    this.layout()
    if (this.showsPage(tab)) tab.view.webContents.focus()
    else this.focusOmnibox()
    this.changed()
  }

  navigate(id: number, input: string, typed = false): void {
    const tab = this.get(id)
    const url = toUrl(input)
    if (!tab || !url) return
    tab.pendingUrl = undefined
    tab.info.url = url
    tab.info.error = undefined
    if (isInternalUrl(url)) {
      if (this.fullscreenTab === tab) this.exitPageFullscreen(true)
      // One of Orbit's own pages: the UI draws it, the web view stays where it was.
      tab.view.webContents.stop()
      tab.info.title = INTERNAL_PAGES[url]
      tab.info.favicon = undefined
      tab.info.loading = false
      // Back returns to the page that was open underneath.
      tab.info.canGoBack = !!tab.view.webContents.getURL()
      tab.info.canGoForward = false
      this.layout()
      this.win.webContents.focus()
      this.changed()
      return
    }
    tab.typed = typed
    void tab.view.webContents.loadURL(url).catch(() => {})
    this.layout()
    tab.view.webContents.focus()
    this.changed()
  }

  /** Opens one of Orbit's own pages, reusing a tab that already shows it. */
  openInternal(url: keyof typeof INTERNAL_PAGES): void {
    const open = this.tabs.find((t) => t.info.url === url)
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
    const tab = this.tabs.find((t) => t.view.webContents === wc)
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
    this.changed()
  }

  /**
   * Floating UI opens or closes above the page. Opening returns a picture of the page (JPEG data
   * URL) for the UI to show in its place while the real page is taken out.
   */
  async setOverlay(open: boolean): Promise<string | null> {
    if (!open) {
      this.overlayOpen = false
      this.layout()
      return null
    }
    const view = this.attached
    let shot: string | null = null
    if (view) {
      try {
        const img = await view.webContents.capturePage()
        if (!img.isEmpty()) shot = 'data:image/jpeg;base64,' + img.toJPEG(82).toString('base64')
      } catch {
        shot = null
      }
    }
    this.overlayOpen = true
    return shot
  }

  /** Takes the page out once the UI is showing its picture (sent after setOverlay(true)). */
  hidePageForOverlay(): void {
    if (this.overlayOpen) this.layout()
  }

  togglePin(id: number): void {
    const tab = this.get(id)
    if (!tab) return
    tab.info.pinned = !tab.info.pinned
    this.sortPinned()
    this.changed()
  }

  move(id: number, toIndex: number): void {
    const from = this.tabs.findIndex((t) => t.info.id === id)
    if (from < 0) return
    const [tab] = this.tabs.splice(from, 1)
    this.tabs.splice(Math.max(0, Math.min(toIndex, this.tabs.length)), 0, tab)
    this.sortPinned()
    this.changed()
  }

  /** Pinned tabs always sit at the top, in the order they were in. */
  private sortPinned(): void {
    this.tabs = [...this.tabs.filter((t) => t.info.pinned), ...this.tabs.filter((t) => !t.info.pinned)]
  }

  // ---- the active page ----------------------------------------------------

  back(): void {
    const tab = this.active
    const wc = tab?.view.webContents
    if (!tab || !wc) return
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
    const wc = this.active?.view.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(hard = false): void {
    const tab = this.active
    if (!tab) return
    if (tab.info.error) return this.navigate(tab.info.id, tab.info.error.url)
    if (isInternalUrl(tab.info.url)) return
    if (hard) tab.view.webContents.reloadIgnoringCache()
    else tab.view.webContents.reload()
  }

  stop(): void {
    this.active?.view.webContents.stop()
  }

  private zoom(delta: number | null, tab = this.active): void {
    if (!tab || !this.showsPage(tab)) return
    const wc = tab.view.webContents
    const next = delta === null ? 0 : clampZoomLevel(wc.getZoomLevel() + delta)
    wc.setZoomLevel(next)
    tab.info.zoom = zoomPercent(next)
    this.changed()
  }

  resetZoom(): void {
    this.zoom(null)
  }

  setBounds(r: Rect | null): void {
    this.bounds = r && r.width > 0 && r.height > 0 ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null
    this.layout()
  }

  /** A tab shows its page once it has one that loaded; otherwise the UI shows the start or error page. */
  private showsPage(tab: Tab): boolean {
    return !!tab.info.url && !tab.info.error && !isInternalUrl(tab.info.url)
  }

  /** Puts the active tab's page in the window (or takes it out), at the place the UI gave. */
  private layout(): void {
    const tab = this.active
    const want = tab && this.bounds && !this.overlayOpen && this.showsPage(tab) ? tab.view : null
    if (this.attached && this.attached !== want) {
      this.win.contentView.removeChildView(this.attached)
      this.attached = null
    }
    if (want && this.bounds) {
      if (this.attached !== want) {
        this.win.contentView.addChildView(want)
        this.attached = want
      }
      if (this.fullscreenTab?.view === want) {
        const [width, height] = this.win.getContentSize()
        want.setBounds({ x: 0, y: 0, width, height })
        this.radius(want, 0)
      } else {
        want.setBounds(this.bounds)
        this.radius(want, 10)
      }
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
    this.layout()
  }

  /** The window left full screen (Esc, F11, or switching tab): the page leaves it too. */
  exitPageFullscreen(leaveWindow = false): void {
    const tab = this.fullscreenTab
    if (!tab) return
    const restoreWindow = leaveWindow && this.fullscreenByPage
    this.fullscreenTab = null
    this.fullscreenByPage = false
    if (!tab.view.webContents.isDestroyed()) void tab.view.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true).catch(() => {})
    if (restoreWindow && this.win.isFullScreen()) this.win.setFullScreen(false)
    if (!this.win.isDestroyed()) this.win.webContents.send('page-fullscreen', false)
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
    const wc = tab.view.webContents
    wc.setAudioMuted(!wc.isAudioMuted())
    tab.info.muted = wc.isAudioMuted()
    tab.info.audible = wc.isCurrentlyAudible()
    this.changed()
  }

  print(): void {
    const tab = this.active
    if (!tab || !this.showsPage(tab)) return
    tab.view.webContents.print({}, () => {})
  }

  duplicate(id: number): void {
    const tab = this.get(id)
    const url = tab?.pendingUrl ?? tab?.info.url
    if (tab && url) this.create(url, { after: id, title: tab.info.title })
  }

  closeOthers(id: number): void {
    for (const t of [...this.tabs]) if (t.info.id !== id && !t.info.pinned) this.close(t.info.id)
  }

  /** The right-click menu for a tab in the sidebar. */
  tabMenu(id: number): void {
    const tab = this.get(id)
    if (!tab) return
    const wc = tab.view.webContents
    Menu.buildFromTemplate([
      { label: 'New tab', click: () => this.create() },
      { type: 'separator' },
      {
        label: 'Reload',
        enabled: this.showsPage(tab),
        click: () => {
          const wasLazy = !!tab.pendingUrl
          this.activate(id)
          if (!wasLazy) this.reload()
        }
      },
      { label: 'Duplicate', enabled: !!(tab.pendingUrl || tab.info.url), click: () => this.duplicate(id) },
      { label: tab.info.pinned ? 'Unpin tab' : 'Pin tab', click: () => this.togglePin(id) },
      { label: wc.isAudioMuted() ? 'Unmute tab' : 'Mute tab', click: () => this.toggleMute(id) },
      { type: 'separator' },
      { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: () => this.close(id) },
      { label: 'Close other tabs', enabled: this.tabs.some((t) => t.info.id !== id && !t.info.pinned), click: () => this.closeOthers(id) },
      { label: 'Reopen closed tab', accelerator: 'CmdOrCtrl+Shift+T', enabled: this.closed.length > 0, click: () => this.reopenClosed() }
    ]).popup({ window: this.win })
  }

  focusOmnibox(): void {
    if (this.fullscreenTab) this.exitPageFullscreen(true)
    this.win.webContents.focus()
    this.win.webContents.send('focus-omnibox')
  }

  toggleDownloads(): void {
    if (this.fullscreenTab) this.exitPageFullscreen(true)
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
    if (!tab || !this.showsPage(tab)) return
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
    if (tab && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.stopFindInPage('clearSelection')
    }
    if (notifyUi) {
      if (wasOpen && !this.win.isDestroyed()) this.win.webContents.send('find:close')
    } else if (tab && this.showsPage(tab)) {
      tab.view.webContents.focus()
    }
  }

  private findStep(forward: boolean): void {
    if (this.findOpen && this.findQuery) this.find(this.findQuery, { forward, findNext: false })
    else this.openFind()
  }

  // ---- keyboard -------------------------------------------------------------

  /** Browser shortcuts, from the UI or from a page. True when one was used. */
  shortcut(input: Input): boolean {
    if (input.type !== 'keyDown') return false
    const mod = process.platform === 'darwin' ? input.meta : input.control
    const key = input.key.toLowerCase()
    const run = (f: () => void): true => (f(), true)

    if (mod && !input.alt) {
      if (key === 't' && input.shift) return run(() => this.reopenClosed())
      if (key === 't') return run(() => this.create())
      if (key === 'w') return run(() => this.activeId !== null && this.close(this.activeId))
      if (key === 'l') return run(() => this.focusOmnibox())
      if (key === 'f') return run(() => this.openFind())
      if (key === 'j') return run(() => this.toggleDownloads())
      if (key === 'h') return run(() => this.openInternal('orbit://history'))
      if (key === 'o' && input.shift) return run(() => this.openInternal('orbit://bookmarks'))
      if (key === 'd') return run(() => this.toggleBookmark())
      if (key === 'r') return run(() => this.reload(input.shift))
      if (key === 'tab') return run(() => this.cycle(input.shift ? -1 : 1))
      if (key === 'pagedown') return run(() => this.cycle(1))
      if (key === 'pageup') return run(() => this.cycle(-1))
      if (key === '=' || key === '+') return run(() => this.zoom(ZOOM_STEP))
      if (key === '-') return run(() => this.zoom(-ZOOM_STEP))
      if (key === '0') return run(() => this.zoom(null))
      if (/^[1-9]$/.test(key)) {
        const n = Number(key)
        const tab = n === 9 ? this.tabs[this.tabs.length - 1] : this.tabs[n - 1]
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
    if (key === 'f12') return run(() => this.active?.view.webContents.toggleDevTools())
    if (key === 'browserback') return run(() => this.back())
    if (key === 'browserforward') return run(() => this.forward())
    return false
  }

  private cycle(dir: number): void {
    if (!this.tabs.length) return
    const i = this.tabs.findIndex((t) => t.info.id === this.activeId)
    const next = this.tabs[(i + dir + this.tabs.length) % this.tabs.length]
    this.activate(next.info.id)
  }

  // ---- page events ----------------------------------------------------------

  private wire(tab: Tab): void {
    const wc = tab.view.webContents
    const info = tab.info
    const sync = (): void => {
      const url = wc.getURL()
      // An Orbit page sits on top of whatever the tab had; the old page can't take its place.
      if (isInternalUrl(info.url)) return this.changed()
      if (url) info.url = url
      info.canGoBack = wc.navigationHistory.canGoBack()
      info.canGoForward = wc.navigationHistory.canGoForward()
      info.zoom = Math.round(wc.getZoomFactor() * 100)
      this.changed()
    }

    wc.on('before-input-event', (e, input) => {
      if (this.shortcut(input)) e.preventDefault()
    })
    wc.on('zoom-changed', (_e, direction) => {
      this.zoom(direction === 'in' ? ZOOM_STEP : -ZOOM_STEP, tab)
    })

    // Only web addresses: no file:, javascript:, chrome: and the like.
    wc.on('will-navigate', (e, url) => {
      if (!isAllowedUrl(url)) e.preventDefault()
    })
    wc.on('will-redirect', (e, url) => {
      if (!isAllowedUrl(url)) e.preventDefault()
    })

    // Links that open a new tab become a tab here. Real pop-ups (window.open with a size, used by
    // "Sign in with ..." buttons) stay pop-ups, so the page that opened them can hear back.
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (!isAllowedUrl(url)) return { action: 'deny' }
      if (disposition === 'new-window') {
        return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 520, height: 680 } }
      }
      this.create(url, { activate: disposition !== 'background-tab', after: info.id })
      return { action: 'deny' }
    })
    wc.on('did-create-window', (popup) => {
      popup.webContents.on('will-navigate', (e, url) => {
        if (!isAllowedUrl(url)) e.preventDefault()
      })
      popup.webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedUrl(url)) this.create(url, { after: info.id })
        return { action: 'deny' }
      })
    })

    wc.on('did-start-loading', () => {
      info.loading = true
      if (info.error) {
        info.error = undefined
        this.layout()
      }
      this.changed()
    })
    wc.on('did-stop-loading', () => {
      info.loading = false
      sync()
    })
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        info.favicon = undefined
        // A question from the page you're leaving is answered no.
        this.onTabGone(info.id)
        if (info.id === this.activeId) this.stopFind(true)
      }
    })
    wc.on('found-in-page', (_e, result) => {
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
      sync()
      // Pages that answered (even with 404) count as a visit, as in Chrome; failed loads don't.
      this.hooks.visit(url, wc.getTitle(), !!tab.typed)
      tab.typed = false
    })
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      sync()
      if (isMainFrame) this.hooks.visit(url, wc.getTitle(), false)
    })
    wc.on('page-title-updated', (_e, title) => {
      info.title = title
      this.hooks.title(wc.getURL(), title)
      this.changed()
    })
    wc.on('page-favicon-updated', (_e, icons) => {
      info.favicon = icons.find((u) => /^(https?|data):/.test(u))
      this.changed()
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
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
      if (details.reason === 'clean-exit') return
      if (this.fullscreenTab === tab) this.exitPageFullscreen(true)
      if (info.id === this.activeId) this.stopFind(true)
      info.loading = false
      info.error = { code: -1, description: 'PAGE_CRASHED', url: info.url }
      this.layout()
      this.changed()
    })
    wc.on('context-menu', (_e, p) => this.contextMenu(tab, p))
    wc.on('enter-html-full-screen', () => this.setPageFullscreen(tab, true))
    wc.on('leave-html-full-screen', () => this.setPageFullscreen(tab, false))
    wc.on('audio-state-changed', (e) => {
      info.audible = e.audible
      info.muted = wc.isAudioMuted()
      this.changed()
    })
  }

  private contextMenu(tab: Tab, p: Electron.ContextMenuParams): void {
    const wc = tab.view.webContents
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
        { label: 'Open link in new tab', click: () => this.create(p.linkURL, { activate: false, after: tab.info.id }) },
        { label: 'Copy link', click: () => clipboard.writeText(p.linkURL) }
      )
      gap()
    }
    if (p.mediaType === 'image' && isAllowedUrl(p.srcURL)) {
      items.push(
        { label: 'Open image in new tab', click: () => this.create(p.srcURL, { activate: false, after: tab.info.id }) },
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
      items.push({ role: 'copy' }, { label: `Search for “${short}”`, click: () => this.create(SEARCH_URL + encodeURIComponent(text), { after: tab.info.id }) })
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
    if (!p.linkURL && !p.isEditable && !p.selectionText.trim() && p.mediaType === 'none') {
      items.push({ label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => wc.print({}, () => {}) })
      gap()
    }
    items.push({ label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) })
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  // ---- telling the UI, and remembering ---------------------------------------

  private changed(): void {
    if (!this.emitQueued) {
      this.emitQueued = true
      setImmediate(() => {
        this.emitQueued = false
        if (!this.win.isDestroyed()) this.win.webContents.send('state', this.state())
      })
    }
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), 800)
  }

  /** Writes the open tabs to disk, so they come back next time. */
  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const kept = this.tabs.filter((t) => t.info.url || t.pendingUrl)
    const data: SavedSession = {
      tabs: kept.map((t) => ({ url: t.pendingUrl ?? (t.info.error?.url || t.info.url), title: t.info.title, pinned: t.info.pinned })),
      active: Math.max(0, kept.findIndex((t) => t.info.id === this.activeId))
    }
    try {
      mkdirSync(dirname(this.sessionFile), { recursive: true })
      writeFileSync(this.sessionFile, JSON.stringify(data))
    } catch {
      /* not fatal: tabs just won't come back */
    }
  }

  /** Opens last time's tabs (without loading them yet), or one new tab. */
  restore(): void {
    let saved: SavedSession | null = null
    try {
      saved = JSON.parse(readFileSync(this.sessionFile, 'utf8')) as SavedSession
    } catch {
      saved = null
    }
    const tabs = (saved?.tabs ?? []).filter((t) => typeof t.url === 'string' && (isAllowedUrl(t.url) || isInternalUrl(t.url)))
    if (!tabs.length) {
      this.create()
      return
    }
    const ids = tabs.map((t) => this.create(t.url, { activate: false, lazy: true, pinned: !!t.pinned, title: t.title }))
    this.activate(ids[Math.min(saved?.active ?? 0, ids.length - 1)])
  }
}
