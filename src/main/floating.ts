/*
 * Reusable floating child BrowserWindow for UI that must appear above native WebContentsViews
 * (title-bar menus now; Ctrl+K command palette and link preview "peek" later).
 *
 * Each floating window loads Orbit's own renderer route with a minimal sandboxed preload,
 * no Node access, and locked-down navigation so web content can never enter it.
 */
import { BrowserWindow, screen, type WebContents } from 'electron'
import { join } from 'node:path'
import { clampPopupBounds, type MenuEntry, type MenuPopupHeader, type MenuPopupSpec } from '../shared/menu'

export interface FloatingWindowOptions {
  parent: BrowserWindow
  preload: string
  view: string
  acrylic: boolean
  width?: number
  height?: number
  hideOnBlur?: boolean
  hideOnParentMove?: boolean
  onHidden?: (reason: 'blur' | 'parent' | 'asked') => void
  onFocusChange?: (focused: boolean) => void
}

/**
 * A reusable frameless, sandboxed child window that floats above native page views.
 * Created once per parent window and shown/repositioned on demand so popups open instantly.
 */
export class FloatingWindow {
  private win: BrowserWindow
  private ready = false
  private queued: { channel: string; payload: unknown }[] = []
  private readonly hideOnBlur: boolean
  private readonly hideOnParentMove: boolean
  private readonly onHidden?: (reason: 'blur' | 'parent' | 'asked') => void
  private readonly onFocusChange?: (focused: boolean) => void
  private readonly parent: BrowserWindow
  private readonly handleParentMove = (): void => {
    if (this.hideOnParentMove) this.hide('parent')
  }
  private readonly handleParentClosed = (): void => {
    this.destroy()
  }

  constructor(opts: FloatingWindowOptions) {
    this.parent = opts.parent
    this.hideOnBlur = opts.hideOnBlur ?? true
    this.hideOnParentMove = opts.hideOnParentMove ?? true
    this.onHidden = opts.onHidden
    this.onFocusChange = opts.onFocusChange

    this.win = new BrowserWindow({
      parent: opts.parent,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: true,
      ...(opts.acrylic
        ? { backgroundColor: '#00000000', backgroundMaterial: 'acrylic' as const }
        : { transparent: true, backgroundColor: '#00000000' }),
      width: opts.width ?? 240,
      height: opts.height ?? 200,
      webPreferences: {
        preload: opts.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true
      }
    })

    this.win.setMenu(null)
    // Never allow navigation or popups inside a floating UI window.
    this.win.webContents.on('will-navigate', (e) => e.preventDefault())
    this.win.webContents.on('will-redirect', (e) => e.preventDefault())
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    this.win.webContents.once('did-finish-load', () => {
      if (!this.ready) this.markReady()
    })

    this.win.on('focus', () => this.onFocusChange?.(true))
    this.win.on('blur', () => {
      this.onFocusChange?.(false)
      if (this.hideOnBlur) this.hide('blur')
    })

    this.parent.on('move', this.handleParentMove)
    this.parent.on('resize', this.handleParentMove)
    this.parent.on('closed', this.handleParentClosed)

    const query = {
      view: opts.view,
      material: opts.acrylic ? 'acrylic' : 'solid',
      platform: process.platform
    }
    if (process.env.ELECTRON_RENDERER_URL) {
      void this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
    } else {
      void this.win.loadFile(join(__dirname, '../renderer/index.html'), { query })
    }
  }

  markReady(): void {
    if (this.ready || this.win.isDestroyed()) return
    this.ready = true
    const pending = this.queued
    this.queued = []
    for (const msg of pending) {
      if (!this.win.isDestroyed()) this.win.webContents.send(msg.channel, msg.payload)
    }
  }

  isSender(wc: WebContents): boolean {
    return !this.win.isDestroyed() && this.win.webContents === wc
  }

  isVisible(): boolean {
    return !this.win.isDestroyed() && this.win.isVisible()
  }

  isFocused(): boolean {
    return !this.win.isDestroyed() && this.win.isFocused()
  }

  setZoomFactor(zoom: number): void {
    if (!this.win.isDestroyed()) this.win.webContents.setZoomFactor(zoom)
  }

  send(channel: string, payload: unknown): void {
    if (this.win.isDestroyed()) return
    if (!this.ready) {
      // Keep only the newest message per channel while warming up.
      this.queued = this.queued.filter((m) => m.channel !== channel)
      this.queued.push({ channel, payload })
      return
    }
    this.win.webContents.send(channel, payload)
  }

  /**
   * Positions the floating window below a parent-relative CSS point and shows it,
   * clamped inside the active display's workArea.
   */
  showAt(anchorCss: { x: number; y: number }, sizeCss: { width: number; height: number }, focus = true): void {
    if (this.win.isDestroyed() || this.parent.isDestroyed()) return
    const cb = this.parent.getContentBounds()
    const z = this.parent.webContents.getZoomFactor()
    const anchorScreen = {
      x: Math.round(cb.x + anchorCss.x * z),
      y: Math.round(cb.y + anchorCss.y * z)
    }
    const workArea = screen.getDisplayNearestPoint(anchorScreen).workArea
    const bounds = clampPopupBounds(anchorScreen, { width: sizeCss.width * z, height: sizeCss.height * z }, workArea)
    this.win.setBounds(bounds)
    if (!this.win.isVisible()) {
      if (focus) this.win.show()
      else this.win.showInactive()
    }
    if (focus) this.win.focus()
  }

  hide(reason: 'blur' | 'parent' | 'asked' = 'asked'): void {
    if (this.win.isDestroyed() || !this.win.isVisible()) return
    this.win.hide()
    this.onHidden?.(reason)
  }

  destroy(): void {
    if (!this.parent.isDestroyed()) {
      this.parent.off('move', this.handleParentMove)
      this.parent.off('resize', this.handleParentMove)
      this.parent.off('closed', this.handleParentClosed)
    }
    this.queued = []
    if (!this.win.isDestroyed()) this.win.destroy()
  }
}

// ---- Title-bar menu popup built on FloatingWindow --------------------------

const MAX_MENU_ITEMS = 200
const MAX_STR = 512

function safeStr(v: unknown, max = MAX_STR): string | null {
  return typeof v === 'string' && v.length <= max ? v : null
}

function safeNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Validates and normalizes an untrusted menu popup spec from IPC. */
export function sanitizeMenuSpec(raw: unknown): MenuPopupSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const x = safeNum(r.x)
  const y = safeNum(r.y)
  const accent = safeStr(r.accent, 64)
  if (x === null || y === null || !accent || !Array.isArray(r.items)) return null

  const items: MenuEntry[] = []
  for (const entry of r.items.slice(0, MAX_MENU_ITEMS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const e = entry as Record<string, unknown>
    if (e.kind === 'separator') {
      items.push({ kind: 'separator' })
      continue
    }
    if (e.kind === 'item') {
      const id = safeStr(e.id, 128)
      const label = safeStr(e.label, MAX_STR)
      if (!id || label === null) continue
      const keys = safeStr(e.keys, 64) ?? undefined
      items.push({
        kind: 'item',
        id,
        label,
        ...(keys ? { keys } : {}),
        ...(typeof e.checked === 'boolean' ? { checked: e.checked } : {}),
        ...(typeof e.disabled === 'boolean' ? { disabled: e.disabled } : {}),
        ...(e.hasSubmenu === true ? { hasSubmenu: true } : {})
      })
    }
  }

  let header: MenuPopupHeader | undefined
  if (r.header && typeof r.header === 'object' && !Array.isArray(r.header)) {
    const h = r.header as Record<string, unknown>
    const label = safeStr(h.label, 128)
    const backId = safeStr(h.backId, 128)
    if (label && backId) header = { label, backId }
  }

  const initialActive = safeNum(r.initialActive)
  return {
    x,
    y,
    dark: r.dark === true,
    accent,
    items,
    initialActive: initialActive === null ? -1 : Math.trunc(initialActive),
    ...(header ? { header } : {})
  }
}

export class MenuPopup {
  private readonly floating: FloatingWindow
  private readonly parent: BrowserWindow
  private readonly onOpenChange?: (open: boolean) => void
  private pendingAnchor: { x: number; y: number } | null = null
  private openState = false

  constructor(
    parent: BrowserWindow,
    opts: {
      preload: string
      acrylic: boolean
      onOpenChange?: (open: boolean) => void
      onFocusChange?: (focused: boolean) => void
    }
  ) {
    this.parent = parent
    this.onOpenChange = opts.onOpenChange
    this.floating = new FloatingWindow({
      parent,
      preload: opts.preload,
      view: 'menu',
      acrylic: opts.acrylic,
      width: 240,
      height: 200,
      hideOnBlur: true,
      hideOnParentMove: true,
      onFocusChange: opts.onFocusChange,
      onHidden: (reason) => {
        this.pendingAnchor = null
        this.setOpen(false)
        if (reason !== 'asked' && !this.parent.isDestroyed()) {
          this.parent.webContents.send('menu:closed')
        }
      }
    })
  }

  private setOpen(open: boolean): void {
    if (this.openState === open) return
    this.openState = open
    this.onOpenChange?.(open)
  }

  isSender(wc: WebContents): boolean {
    return this.floating.isSender(wc)
  }

  isOpen(): boolean {
    return this.openState || this.floating.isVisible()
  }

  isFocused(): boolean {
    return this.floating.isFocused()
  }

  markReady(): void {
    this.floating.markReady()
  }

  open(rawSpec: unknown): void {
    const spec = sanitizeMenuSpec(rawSpec)
    if (!spec || this.parent.isDestroyed()) return
    this.pendingAnchor = { x: spec.x, y: spec.y }
    this.setOpen(true)
    this.floating.setZoomFactor(this.parent.webContents.getZoomFactor())
    this.floating.send('menu:render', spec)
  }

  applySize(width: number, height: number): void {
    if (!this.pendingAnchor) return
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
    const w = Math.min(Math.max(Math.ceil(width), 120), 640)
    const h = Math.min(Math.max(Math.ceil(height), 32), 900)
    const anchor = this.pendingAnchor
    this.pendingAnchor = null
    this.floating.showAt(anchor, { width: w, height: h }, true)
  }

  pick(id: string): void {
    // Submenu drill-downs stay open and re-render in place; normal picks close the popup first.
    const isSubmenuNav = id.startsWith('submenu:') || id === 'submenu-back'
    if (!isSubmenuNav) {
      this.pendingAnchor = null
      this.floating.hide('asked')
      this.setOpen(false)
    }
    if (!this.parent.isDestroyed()) this.parent.webContents.send('menu:picked', id)
  }

  step(by: -1 | 1): void {
    if (!this.parent.isDestroyed()) this.parent.webContents.send('menu:step', by)
  }

  dismiss(): void {
    this.pendingAnchor = null
    if (this.floating.isVisible()) {
      this.floating.hide('blur')
    } else if (this.openState) {
      this.setOpen(false)
      if (!this.parent.isDestroyed()) this.parent.webContents.send('menu:closed')
    }
    if (!this.parent.isDestroyed()) this.parent.focus()
  }

  close(): void {
    this.pendingAnchor = null
    this.floating.hide('asked')
    this.setOpen(false)
  }

  destroy(): void {
    this.pendingAnchor = null
    this.setOpen(false)
    this.floating.destroy()
  }
}
