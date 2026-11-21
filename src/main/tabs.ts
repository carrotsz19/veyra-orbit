/*
 * The tabs. Each one is its own WebContentsView (its own sandboxed Chromium renderer). Only the
 * active tab's view is in the window, placed where the UI says the page goes. New tabs start
 * without a page, and tabs restored from last time load only when you open them.
 */
import { BrowserWindow, Menu, WebContentsView, clipboard, type Input, type WebContents } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BrowserState, Rect, TabInfo } from '../shared/types'
import { SEARCH_URL, isAllowedUrl, toUrl } from '../shared/url'
import { clampZoomLevel, zoomPercent } from '../shared/format'
import { WEB_PARTITION } from './security'

interface Tab {
  info: TabInfo
  view: WebContentsView
  /** A restored tab's address, loaded the first time the tab is opened. */
  pendingUrl?: string
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
  private attached: WebContentsView | null = null
  private closed: { url: string; title: string; pinned: boolean }[] = []
  private emitQueued = false
  private saveTimer: NodeJS.Timeout | null = null
  private findOpen = false
  private findQuery = ''

  /** Called when a tab closes or leaves its page, so its open permission questions can be dropped. */
  onTabGone: (id: number) => void = () => {}

  constructor(
    private win: BrowserWindow,
    private sessionFile: string
  ) {}

  // ---- reading ------------------------------------------------------------

  state(): BrowserState {
    return { tabs: this.tabs.map((t) => ({ ...t.info })), activeId: this.activeId }
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
        safeDialogs: true
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
      info: { id, url, title: opts.title ?? '', loading: false, canGoBack: false, canGoForward: false, pinned: !!opts.pinned, zoom: 100 }
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
    if (this.activeId !== null && this.activeId !== id) this.stopFind(true)
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

  navigate(id: number, input: string): void {
    const tab = this.get(id)
    const url = toUrl(input)
    if (!tab || !url) return
    tab.pendingUrl = undefined
    tab.info.url = url
    tab.info.error = undefined
    void tab.view.webContents.loadURL(url).catch(() => {})
    this.layout()
    tab.view.webContents.focus()
    this.changed()
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
    const wc = this.active?.view.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  forward(): void {
    const wc = this.active?.view.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(hard = false): void {
    const tab = this.active
    if (!tab) return
    if (tab.info.error) return this.navigate(tab.info.id, tab.info.error.url)
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
    return !!tab.info.url && !tab.info.error
  }

  /** Puts the active tab's page in the window (or takes it out), at the place the UI gave. */
  private layout(): void {
    const tab = this.active
    const want = tab && this.bounds && this.showsPage(tab) ? tab.view : null
    if (this.attached && this.attached !== want) {
      this.win.contentView.removeChildView(this.attached)
      this.attached = null
    }
    if (want && this.bounds) {
      if (this.attached !== want) {
        this.win.contentView.addChildView(want)
        this.attached = want
      }
      want.setBounds(this.bounds)
    }
  }

  focusOmnibox(): void {
    this.win.webContents.focus()
    this.win.webContents.send('focus-omnibox')
  }

  openFind(): void {
    if (!this.active || !this.showsPage(this.active)) return
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
    wc.on('did-navigate', sync)
    wc.on('did-navigate-in-page', sync)
    wc.on('page-title-updated', (_e, title) => {
      info.title = title
      this.changed()
    })
    wc.on('page-favicon-updated', (_e, icons) => {
      info.favicon = icons.find((u) => /^(https?|data):/.test(u))
      this.changed()
    })
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      // -3 is "aborted": you clicked something else, or stopped it.
      if (!isMainFrame || code === -3) return
      if (info.id === this.activeId) this.stopFind(true)
      info.loading = false
      info.error = { code, description, url }
      info.url = url
      this.layout()
      this.changed()
    })
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return
      if (info.id === this.activeId) this.stopFind(true)
      info.loading = false
      info.error = { code: -1, description: 'PAGE_CRASHED', url: info.url }
      this.layout()
      this.changed()
    })
    wc.on('context-menu', (_e, p) => this.contextMenu(tab, p))
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
        { label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) }
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
    const tabs = (saved?.tabs ?? []).filter((t) => typeof t.url === 'string' && isAllowedUrl(t.url))
    if (!tabs.length) {
      this.create()
      return
    }
    const ids = tabs.map((t) => this.create(t.url, { activate: false, lazy: true, pinned: !!t.pinned, title: t.title }))
    this.activate(ids[Math.min(saved?.active ?? 0, ids.length - 1)])
  }
}
