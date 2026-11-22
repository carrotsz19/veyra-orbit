/*
 * Reusable floating child BrowserWindow for UI that must appear above native WebContentsViews
 * (title-bar menus now; Ctrl+K command palette and link preview "peek" later).
 *
 * Each floating window loads Orbit's own renderer route with a minimal sandboxed preload,
 * no Node access, and locked-down navigation so web content can never enter it.
 */
import { BrowserWindow, WebContentsView, screen, type Input, type WebContents } from 'electron'
import { join } from 'node:path'
import { clampPopupBounds, type BoundsRect, type MenuEntry, type MenuPopupHeader, type MenuPopupSpec } from '../shared/menu'
import {
  computePaletteBounds,
  validatePalettePick,
  type PaletteAction,
  type PaletteItem,
  type PaletteMode,
  type PaletteOpenState
} from '../shared/palette'
import { PEEK_TAB_ID, computePeekBounds, computePeekViewRect, type PeekState } from '../shared/peek'
import { shouldRestoreParentFocusOnCompactHide } from '../shared/compact'
import { isAllowedUrl } from '../shared/url'
import { isSafeSubframeUrl, parseExternalAppUrl } from '../shared/external'
import type { ResolvedAppearance } from '../shared/appearance'
import { attachPageCompat } from './compat'

const FLOAT_DARK = '#1f1d18'
const FLOAT_LIGHT = '#fbfaf7'
const DEFAULT_IDLE_DESTROY_MS = 60_000
const FALLBACK_READY_MS = 2_000

interface PendingShow {
  bounds: BoundsRect
  focus: boolean
  onShown?: () => void
}

export interface FloatingWindowOptions {
  parent: BrowserWindow
  preload: string
  view: string
  acrylic: boolean
  transparent?: boolean
  extraQuery?: Record<string, string>
  width?: number
  height?: number
  hasShadow?: boolean
  hideOnBlur?: boolean
  hideOnParentMove?: boolean
  /** Destroy the underlying BrowserWindow after sitting hidden this many ms. Default 60 s. */
  idleDestroyMs?: number
  onHidden?: (reason: 'blur' | 'parent' | 'asked') => void
  onFocusChange?: (focused: boolean) => void
  onBeforeInput?: (e: Electron.Event, input: Input) => void
  onWindowDestroyed?: () => void
}

/**
 * A lazy frameless, sandboxed child window that floats above native page views.
 * Its BrowserWindow is created on first show (or explicit warm) and destroyed after sitting
 * hidden for ~60 s so idle floating UI holds zero renderer processes or RAM.
 */
export class FloatingWindow {
  private win: BrowserWindow | null = null
  private ready = false
  private disposed = false
  private queued: { channel: string; payload: unknown }[] = []
  private pendingShow: PendingShow | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private readyFallbackTimer: NodeJS.Timeout | null = null
  private lastSurfaceTheme: { dark: boolean; bgHex?: string } | null = null
  private lastZoom: number | null = null
  private parentMoveAttached = false

  private readonly opts: FloatingWindowOptions
  private readonly hideOnBlur: boolean
  private readonly hideOnParentMove: boolean
  private readonly idleDestroyMs: number
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
    this.opts = opts
    this.parent = opts.parent
    this.hideOnBlur = opts.hideOnBlur ?? true
    this.hideOnParentMove = opts.hideOnParentMove ?? true
    this.idleDestroyMs = opts.idleDestroyMs ?? DEFAULT_IDLE_DESTROY_MS
    this.onHidden = opts.onHidden
    this.onFocusChange = opts.onFocusChange

    if (!this.parent.isDestroyed()) {
      this.parent.on('closed', this.handleParentClosed)
    }
  }

  private attachParentMoveListeners(): void {
    if (this.parentMoveAttached || !this.hideOnParentMove || this.parent.isDestroyed()) return
    this.parent.on('move', this.handleParentMove)
    this.parent.on('resize', this.handleParentMove)
    this.parentMoveAttached = true
  }

  private detachParentMoveListeners(): void {
    if (!this.parentMoveAttached) return
    this.parentMoveAttached = false
    if (!this.parent.isDestroyed()) {
      this.parent.off('move', this.handleParentMove)
      this.parent.off('resize', this.handleParentMove)
    }
  }

  private clearReadyFallback(): void {
    if (this.readyFallbackTimer) {
      clearTimeout(this.readyFallbackTimer)
      this.readyFallbackTimer = null
    }
  }

  cancelIdleDestroy(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private scheduleIdleDestroy(): void {
    this.cancelIdleDestroy()
    if (this.disposed || this.idleDestroyMs <= 0 || !this.win || this.win.isDestroyed()) return
    if (this.win.isVisible() || this.pendingShow) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (!this.win || this.win.isDestroyed() || this.win.isVisible() || this.pendingShow) return
      this.disposeWindow()
    }, this.idleDestroyMs)
  }

  /** Creates the underlying BrowserWindow if not currently alive, cancelling any idle-destroy timer. */
  ensureWindow(): BrowserWindow | null {
    if (this.disposed || this.parent.isDestroyed()) return null
    this.cancelIdleDestroy()
    if (this.win && !this.win.isDestroyed()) return this.win

    const opts = this.opts
    const useTransparent = opts.transparent ?? !opts.acrylic
    const initialBg = this.lastSurfaceTheme
      ? (this.lastSurfaceTheme.bgHex ?? (this.lastSurfaceTheme.dark ? FLOAT_DARK : FLOAT_LIGHT))
      : FLOAT_DARK

    const w = new BrowserWindow({
      parent: this.parent,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      hasShadow: opts.hasShadow ?? true,
      ...(useTransparent ? { transparent: true, backgroundColor: '#00000000' } : { backgroundColor: initialBg }),
      width: opts.width ?? 240,
      height: opts.height ?? 200,
      webPreferences: {
        preload: opts.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: true
      }
    })

    this.win = w
    this.ready = false
    this.queued = []
    this.pendingShow = null

    w.setMenu(null)
    // Never allow navigation or popups inside a floating UI window.
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    w.webContents.on('will-redirect', (e) => e.preventDefault())
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    if (opts.onBeforeInput) {
      w.webContents.on('before-input-event', opts.onBeforeInput)
    }

    if (this.lastZoom !== null) {
      w.webContents.setZoomFactor(this.lastZoom)
    }

    // Wait for the renderer's explicit *:ready IPC so listeners are attached first; fall back only if it stalls.
    w.webContents.once('did-finish-load', () => {
      if (this.win !== w || this.ready || w.isDestroyed()) return
      this.clearReadyFallback()
      this.readyFallbackTimer = setTimeout(() => {
        this.readyFallbackTimer = null
        if (this.win === w && !this.ready && !w.isDestroyed()) this.markReady()
      }, FALLBACK_READY_MS)
    })

    w.on('focus', () => {
      if (this.win === w) this.onFocusChange?.(true)
    })
    w.on('blur', () => {
      if (this.win !== w) return
      this.onFocusChange?.(false)
      if (this.hideOnBlur) this.hide('blur')
    })
    w.on('closed', () => {
      if (this.win !== w) return
      this.win = null
      this.ready = false
      this.queued = []
      this.pendingShow = null
      this.clearReadyFallback()
      this.cancelIdleDestroy()
      this.detachParentMoveListeners()
      this.opts.onWindowDestroyed?.()
    })

    this.attachParentMoveListeners()

    const query: Record<string, string> = {
      view: opts.view,
      material: 'solid',
      platform: process.platform,
      ...(opts.extraQuery ?? {})
    }
    if (process.env.ELECTRON_RENDERER_URL) {
      void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
    } else {
      void w.loadFile(join(__dirname, '../renderer/index.html'), { query })
    }
    return w
  }

  /** Pre-creates the window hidden and starts its idle timer so it still cleans up if unused. */
  warm(): void {
    const w = this.ensureWindow()
    if (w && !w.isVisible() && !this.pendingShow) {
      this.scheduleIdleDestroy()
    }
  }

  private applyShow(req: PendingShow): void {
    const w = this.win
    if (!w || w.isDestroyed() || this.parent.isDestroyed()) return
    this.cancelIdleDestroy()
    w.setBounds(req.bounds)
    if (!w.isVisible()) {
      if (req.focus) w.show()
      else w.showInactive()
    }
    if (req.focus) w.focus()
    req.onShown?.()
  }

  /**
   * Marks the current live window ready, optionally running a hydration callback FIRST
   * (so appearance tokens and state arrive before any queued open/render payload), then
   * flushes queued messages and executes any deferred show.
   */
  markReady(beforeFlush?: () => void): void {
    const w = this.win
    if (this.ready || !w || w.isDestroyed()) return
    this.ready = true
    this.clearReadyFallback()
    beforeFlush?.()
    const pending = this.queued
    this.queued = []
    for (const msg of pending) {
      if (this.win === w && !w.isDestroyed()) w.webContents.send(msg.channel, msg.payload)
    }
    const showReq = this.pendingShow
    this.pendingShow = null
    if (showReq && this.win === w && !w.isDestroyed()) {
      this.applyShow(showReq)
    } else if (this.win === w && !w.isDestroyed() && !w.isVisible()) {
      this.scheduleIdleDestroy()
    }
  }

  hasLiveWindow(): boolean {
    return !!this.win && !this.win.isDestroyed()
  }

  hasPendingShow(): boolean {
    return this.pendingShow !== null
  }

  isSender(wc: WebContents): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.webContents === wc
  }

  isVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible()
  }

  isFocused(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isFocused()
  }

  getBrowserWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  focus(): void {
    if (this.win && !this.win.isDestroyed()) this.win.focus()
  }

  setZoomFactor(zoom: number): void {
    this.lastZoom = zoom
    if (this.win && !this.win.isDestroyed()) this.win.webContents.setZoomFactor(zoom)
  }

  setSurfaceTheme(dark: boolean, bgHex?: string): void {
    this.lastSurfaceTheme = { dark, bgHex }
    if (this.win && !this.win.isDestroyed() && !(this.opts.transparent ?? !this.opts.acrylic)) {
      this.win.setBackgroundColor(bgHex ?? (dark ? FLOAT_DARK : FLOAT_LIGHT))
    }
  }

  /** Places the floating window at explicit screen bounds, clamped inside the display workArea. */
  showAtBounds(bounds: BoundsRect, focus = true, clampMargin = 0, onShown?: () => void): BoundsRect | null {
    const w = this.ensureWindow()
    if (!w || w.isDestroyed() || this.parent.isDestroyed()) return null
    const workArea = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea
    const placed =
      clampMargin >= 0
        ? clampPopupBounds({ x: bounds.x, y: bounds.y }, { width: bounds.width, height: bounds.height }, workArea, clampMargin)
        : {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.max(80, Math.round(bounds.width)),
            height: Math.max(32, Math.round(bounds.height))
          }
    const req: PendingShow = { bounds: placed, focus, onShown }
    if (!this.ready) {
      this.pendingShow = req
      w.setBounds(placed)
      return placed
    }
    this.pendingShow = null
    this.applyShow(req)
    return placed
  }

  /** Moves/resizes an already-created window (or pending show) without changing visibility. */
  setBounds(bounds: BoundsRect): void {
    const normalized: BoundsRect = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(80, Math.round(bounds.width)),
      height: Math.max(32, Math.round(bounds.height))
    }
    if (this.pendingShow) {
      this.pendingShow = { ...this.pendingShow, bounds: normalized }
    }
    if (this.win && !this.win.isDestroyed()) {
      this.win.setBounds(normalized)
    }
  }

  /**
   * Sends a message to the live window, or queues it if the window is currently warming up.
   * Safe no-op when no window exists (never spawns a window on background broadcasts).
   */
  send(channel: string, payload: unknown): void {
    if (!this.win || this.win.isDestroyed()) return
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
    const w = this.ensureWindow()
    if (!w || w.isDestroyed() || this.parent.isDestroyed()) return
    const cb = this.parent.getContentBounds()
    const z = this.parent.webContents.getZoomFactor()
    const anchorScreen = {
      x: Math.round(cb.x + anchorCss.x * z),
      y: Math.round(cb.y + anchorCss.y * z)
    }
    const workArea = screen.getDisplayNearestPoint(anchorScreen).workArea
    const bounds = clampPopupBounds(anchorScreen, { width: sizeCss.width * z, height: sizeCss.height * z }, workArea)
    const req: PendingShow = { bounds, focus }
    if (!this.ready) {
      this.pendingShow = req
      w.setBounds(bounds)
      return
    }
    this.pendingShow = null
    this.applyShow(req)
  }

  hide(reason: 'blur' | 'parent' | 'asked' = 'asked'): void {
    this.pendingShow = null
    if (!this.ready) this.queued = []
    if (!this.win || this.win.isDestroyed()) return
    const wasVisible = this.win.isVisible()
    if (wasVisible) this.win.hide()
    this.scheduleIdleDestroy()
    if (wasVisible) this.onHidden?.(reason)
  }

  /** Destroys the current BrowserWindow while keeping the lazy wrapper reusable for future shows. */
  disposeWindow(): void {
    this.cancelIdleDestroy()
    this.clearReadyFallback()
    this.detachParentMoveListeners()
    this.queued = []
    this.pendingShow = null
    this.ready = false
    const w = this.win
    this.win = null
    if (!w) return
    this.opts.onWindowDestroyed?.()
    if (!w.isDestroyed()) w.destroy()
  }

  /** Permanently tears down the wrapper and its parent listeners (called on parent close). */
  destroy(): void {
    this.disposed = true
    if (!this.parent.isDestroyed()) {
      this.parent.off('closed', this.handleParentClosed)
    }
    this.disposeWindow()
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
  private owner: WebContents | null = null
  private pendingAnchor: { x: number; y: number } | null = null
  private openState = false
  private lastAppearance: ResolvedAppearance | null = null

  constructor(
    parent: BrowserWindow,
    opts: {
      preload: string
      acrylic: boolean
      onOpenChange?: (open: boolean) => void
      onFocusChange?: (focused: boolean) => void
      onBeforeInput?: (e: Electron.Event, input: Input) => void
    }
  ) {
    this.parent = parent
    this.onOpenChange = opts.onOpenChange
    this.floating = new FloatingWindow({
      parent,
      preload: opts.preload,
      view: 'menu',
      acrylic: opts.acrylic,
      transparent: false,
      width: 240,
      height: 200,
      hideOnBlur: true,
      hideOnParentMove: true,
      onFocusChange: opts.onFocusChange,
      onBeforeInput: opts.onBeforeInput,
      onHidden: (reason) => {
        this.pendingAnchor = null
        this.setOpen(false)
        if (reason !== 'asked') {
          this.sendToOwner('menu:closed')
        }
        this.owner = null
      },
      onWindowDestroyed: () => {
        this.pendingAnchor = null
        this.owner = null
        this.setOpen(false)
      }
    })
  }

  private sendToOwner(channel: string, payload?: unknown): void {
    const target = this.owner && !this.owner.isDestroyed() ? this.owner : !this.parent.isDestroyed() ? this.parent.webContents : null
    if (!target) return
    if (payload === undefined) target.send(channel)
    else target.send(channel, payload)
  }

  private setOpen(open: boolean): void {
    if (this.openState === open) return
    this.openState = open
    this.onOpenChange?.(open)
  }

  hasLiveWindow(): boolean {
    return this.floating.hasLiveWindow()
  }

  isSender(wc: WebContents): boolean {
    return this.floating.isSender(wc)
  }

  isOpen(): boolean {
    return this.openState || this.floating.isVisible() || this.floating.hasPendingShow()
  }

  isFocused(): boolean {
    return this.floating.isFocused()
  }

  markReady(tokens?: ResolvedAppearance): void {
    this.floating.markReady(() => {
      const t = tokens ?? this.lastAppearance
      if (t) this.sendAppearance(t)
    })
  }

  sendAppearance(tokens: ResolvedAppearance): void {
    this.lastAppearance = tokens
    this.floating.setSurfaceTheme(tokens.isDark, tokens.floatBg)
    this.floating.send('appearance:tokens', tokens)
  }

  open(rawSpec: unknown, sender?: WebContents, offsetCss: { x: number; y: number } = { x: 0, y: 0 }): void {
    const spec = sanitizeMenuSpec(rawSpec)
    if (!spec || this.parent.isDestroyed()) return
    if (!this.floating.ensureWindow()) return
    this.owner = sender ?? this.parent.webContents
    this.pendingAnchor = { x: spec.x + offsetCss.x, y: spec.y + offsetCss.y }
    this.setOpen(true)
    this.floating.setSurfaceTheme(spec.dark, this.lastAppearance?.floatBg)
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
    this.sendToOwner('menu:picked', id)
    if (!isSubmenuNav) this.owner = null
  }

  step(by: -1 | 1): void {
    this.sendToOwner('menu:step', by)
  }

  dismiss(): void {
    this.pendingAnchor = null
    if (this.floating.isVisible()) {
      this.floating.hide('blur')
    } else if (this.openState) {
      this.floating.hide('asked')
      this.setOpen(false)
      this.sendToOwner('menu:closed')
      this.owner = null
    }
    if (!this.parent.isDestroyed()) this.parent.focus()
  }

  close(): void {
    this.pendingAnchor = null
    this.floating.hide('asked')
    this.setOpen(false)
    this.owner = null
  }

  destroy(): void {
    this.pendingAnchor = null
    this.owner = null
    this.setOpen(false)
    this.floating.destroy()
  }
}

// ---- Floating compact-mode overlay panel (sidebar or titlebar) -------------

const COMPACT_EXIT_MS = 140

export class CompactPanel {
  private readonly floating: FloatingWindow
  private readonly parent: BrowserWindow
  private hideTimer: NodeJS.Timeout | null = null
  private revealed = false
  private lastOffset = { x: 0, y: 0 }

  constructor(
    parent: BrowserWindow,
    opts: {
      view: 'compact-sidebar' | 'compact-titlebar'
      preload: string
      extraQuery?: Record<string, string>
      width: number
      height: number
      onFocusChange?: (focused: boolean) => void
      onBeforeInput?: (e: Electron.Event, input: Input) => void
    }
  ) {
    this.parent = parent
    this.floating = new FloatingWindow({
      parent,
      preload: opts.preload,
      view: opts.view,
      acrylic: false,
      hasShadow: false,
      extraQuery: opts.extraQuery,
      width: opts.width,
      height: opts.height,
      hideOnBlur: false,
      hideOnParentMove: false,
      onFocusChange: opts.onFocusChange,
      onBeforeInput: opts.onBeforeInput,
      onWindowDestroyed: () => {
        this.revealed = false
      }
    })
  }

  hasLiveWindow(): boolean {
    return this.floating.hasLiveWindow()
  }

  isSender(wc: WebContents): boolean {
    return this.floating.isSender(wc)
  }

  isVisible(): boolean {
    return this.floating.isVisible()
  }

  isRevealed(): boolean {
    return this.revealed
  }

  isFocused(): boolean {
    return this.floating.isFocused()
  }

  offsetCss(): { x: number; y: number } {
    return this.lastOffset
  }

  getBounds(): BoundsRect | null {
    const w = this.floating.getBrowserWindow()
    if (!w || !w.isVisible()) return null
    return w.getBounds()
  }

  markReady(beforeFlush?: () => void): void {
    this.floating.markReady(beforeFlush)
  }

  sendAppearance(tokens: ResolvedAppearance): void {
    this.floating.send('appearance:tokens', tokens)
  }

  send(channel: string, payload?: unknown): void {
    this.floating.send(channel, payload)
  }

  show(offsetCss: { x: number; y: number }, sizeCss: { width: number; height: number }, focus = false): void {
    if (this.parent.isDestroyed()) return
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (!this.floating.ensureWindow()) return
    this.lastOffset = offsetCss
    const cb = this.parent.getContentBounds()
    const z = this.parent.webContents.getZoomFactor()
    this.floating.setZoomFactor(z)
    const bounds: BoundsRect = {
      x: Math.round(cb.x + offsetCss.x * z),
      y: Math.round(cb.y + offsetCss.y * z),
      width: Math.max(80, Math.round(sizeCss.width * z)),
      height: Math.max(36, Math.round(sizeCss.height * z))
    }
    this.revealed = true
    this.floating.showAtBounds(bounds, focus, -1)
    this.floating.send('compact-panel:visible', true)
  }

  reposition(offsetCss: { x: number; y: number }, sizeCss: { width: number; height: number }): void {
    if (this.parent.isDestroyed() || (!this.floating.isVisible() && !this.floating.hasPendingShow())) return
    this.lastOffset = offsetCss
    const cb = this.parent.getContentBounds()
    const z = this.parent.webContents.getZoomFactor()
    this.floating.setBounds({
      x: Math.round(cb.x + offsetCss.x * z),
      y: Math.round(cb.y + offsetCss.y * z),
      width: Math.max(80, Math.round(sizeCss.width * z)),
      height: Math.max(36, Math.round(sizeCss.height * z))
    })
  }

  focus(): void {
    this.floating.focus()
  }

  hide(immediate = false): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    this.revealed = false
    if (!this.floating.isVisible()) {
      this.floating.send('compact-panel:visible', false)
      this.floating.hide('asked')
      return
    }
    this.floating.send('compact-panel:visible', false)
    const finishHide = (): void => {
      const parentAlive = !this.parent.isDestroyed()
      if (
        shouldRestoreParentFocusOnCompactHide({
          panelFocused: this.floating.isFocused(),
          parentVisible: parentAlive && this.parent.isVisible(),
          parentMinimized: parentAlive && this.parent.isMinimized()
        })
      ) {
        this.parent.focus()
      }
      this.floating.hide('asked')
    }
    if (immediate) {
      finishHide()
      return
    }
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      if (!this.revealed) finishHide()
    }, COMPACT_EXIT_MS)
  }

  destroy(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    this.revealed = false
    this.floating.destroy()
  }
}

// ---- Floating Ctrl+K command palette built on FloatingWindow ---------------

export class PalettePopup {
  private readonly floating: FloatingWindow
  private readonly parent: BrowserWindow
  private actions = new Map<string, PaletteAction>()
  private mode: PaletteMode = 'command'
  private lastHeight = 360
  private lastAppearance: ResolvedAppearance | null = null

  constructor(
    parent: BrowserWindow,
    opts: {
      preload: string
      acrylic: boolean
      onFocusChange?: (focused: boolean) => void
      onHidden?: () => void
      onBeforeInput?: (e: Electron.Event, input: Input) => void
    }
  ) {
    this.parent = parent
    this.floating = new FloatingWindow({
      parent,
      preload: opts.preload,
      view: 'palette',
      acrylic: opts.acrylic,
      transparent: false,
      width: 600,
      height: 360,
      hideOnBlur: true,
      hideOnParentMove: true,
      onFocusChange: opts.onFocusChange,
      onBeforeInput: opts.onBeforeInput,
      onHidden: () => {
        this.actions.clear()
        opts.onHidden?.()
      },
      onWindowDestroyed: () => {
        this.actions.clear()
      }
    })
  }

  hasLiveWindow(): boolean {
    return this.floating.hasLiveWindow()
  }

  warm(): void {
    this.floating.warm()
  }

  isSender(wc: WebContents): boolean {
    return this.floating.isSender(wc)
  }

  isOpen(): boolean {
    return this.floating.isVisible() || this.floating.hasPendingShow()
  }

  isFocused(): boolean {
    return this.floating.isFocused()
  }

  currentMode(): PaletteMode {
    return this.mode
  }

  markReady(tokens?: ResolvedAppearance): void {
    this.floating.markReady(() => {
      const t = tokens ?? this.lastAppearance
      if (t) this.sendAppearance(t)
    })
  }

  sendAppearance(tokens: ResolvedAppearance): void {
    this.lastAppearance = tokens
    this.floating.setSurfaceTheme(tokens.isDark, tokens.floatBg)
    this.floating.send('appearance:tokens', tokens)
  }

  open(
    init: { mode: PaletteMode; dark: boolean; accent: string; items: PaletteItem[]; actions: Map<string, PaletteAction> }
  ): void {
    if (this.parent.isDestroyed()) return
    if (!this.floating.ensureWindow()) return
    this.mode = init.mode
    this.actions = init.actions
    this.floating.setSurfaceTheme(init.dark, this.lastAppearance?.floatBg)
    const z = this.parent.webContents.getZoomFactor()
    this.floating.setZoomFactor(z)
    const cb = this.parent.getContentBounds()
    const workArea = screen.getDisplayNearestPoint({ x: cb.x + Math.round(cb.width / 2), y: cb.y + 60 }).workArea
    const initialH = Math.min(500, Math.max(92, 52 + init.items.length * 42 + 34))
    this.lastHeight = initialH
    const bounds = computePaletteBounds(cb, workArea, initialH, z)
    const payload: PaletteOpenState = {
      mode: init.mode,
      dark: init.dark,
      accent: init.accent,
      items: init.items
    }
    this.floating.send('palette:open', payload)
    this.floating.showAtBounds(bounds, true, 8)
  }

  updateResults(query: string, items: PaletteItem[], actions: Map<string, PaletteAction>): void {
    this.actions = actions
    this.floating.send('palette:results', { query, items })
  }

  applyHeight(height: number): void {
    if (this.parent.isDestroyed() || !this.isOpen()) return
    if (!Number.isFinite(height) || height <= 0) return
    const clamped = Math.min(520, Math.max(58, Math.ceil(height)))
    if (Math.abs(clamped - this.lastHeight) < 2) return
    this.lastHeight = clamped
    const z = this.parent.webContents.getZoomFactor()
    const cb = this.parent.getContentBounds()
    const workArea = screen.getDisplayNearestPoint({ x: cb.x + Math.round(cb.width / 2), y: cb.y + 60 }).workArea
    const bounds = computePaletteBounds(cb, workArea, clamped, z)
    this.floating.setBounds(bounds)
  }

  /** Validates an item ID against the exact list main rendered, closes the palette, and returns the action. */
  consumePick(id: unknown): PaletteAction | null {
    const action = validatePalettePick(this.actions, id)
    if (!action) return null
    this.close()
    return action
  }

  dismiss(): void {
    this.close()
    if (!this.parent.isDestroyed()) this.parent.focus()
  }

  close(): void {
    this.actions.clear()
    this.floating.hide('asked')
  }

  destroy(): void {
    this.actions.clear()
    this.floating.destroy()
  }
}

// ---- Floating Link Preview ("Peek") window hosting a sandboxed WebContentsView ---

export interface PeekOpenRequest {
  url: string
  sourceTabId: number
  workspaceId: string
  partition: string
  dark: boolean
  accent: string
}

export interface PeekTarget {
  url: string
  sourceTabId: number
  workspaceId: string
}

export class PeekPopup {
  private readonly floating: FloatingWindow
  private readonly parent: BrowserWindow
  private readonly ensureSession: (partition: string) => void
  private readonly onExternalApp: (tabId: number, pageUrl: string, targetUrl: string) => void
  private readonly onClosed?: () => void
  private view: WebContentsView | null = null
  private target: PeekTarget | null = null
  private state: PeekState | null = null
  private lastAppearance: ResolvedAppearance | null = null

  constructor(
    parent: BrowserWindow,
    opts: {
      preload: string
      acrylic: boolean
      ensureSession: (partition: string) => void
      onExternalApp: (tabId: number, pageUrl: string, targetUrl: string) => void
      onFocusChange?: (focused: boolean) => void
      onClosed?: () => void
    }
  ) {
    this.parent = parent
    this.ensureSession = opts.ensureSession
    this.onExternalApp = opts.onExternalApp
    this.onClosed = opts.onClosed

    this.floating = new FloatingWindow({
      parent,
      preload: opts.preload,
      view: 'peek',
      acrylic: opts.acrylic,
      transparent: false,
      width: 820,
      height: 600,
      hideOnBlur: true,
      hideOnParentMove: true,
      onFocusChange: opts.onFocusChange,
      onHidden: () => {
        this.teardownView()
        this.onClosed?.()
      },
      onWindowDestroyed: () => {
        this.teardownView()
      }
    })
  }

  hasLiveWindow(): boolean {
    return this.floating.hasLiveWindow()
  }

  isSender(wc: WebContents): boolean {
    return this.floating.isSender(wc)
  }

  isContentWebContents(wc: WebContents): boolean {
    return !!this.view && !this.view.webContents.isDestroyed() && this.view.webContents === wc
  }

  isOpen(): boolean {
    return (this.floating.isVisible() || this.floating.hasPendingShow()) && this.target !== null
  }

  isFocused(): boolean {
    return this.floating.isFocused()
  }

  markReady(tokens?: ResolvedAppearance): void {
    this.floating.markReady(() => {
      const t = tokens ?? this.lastAppearance
      if (t) this.sendAppearance(t)
      if (this.state) this.floating.send('peek:state', this.state)
    })
  }

  sendAppearance(tokens: ResolvedAppearance): void {
    this.lastAppearance = tokens
    this.floating.setSurfaceTheme(tokens.isDark, tokens.floatBg)
    this.floating.send('appearance:tokens', tokens)
  }

  currentTarget(): PeekTarget | null {
    return this.target ? { ...this.target } : null
  }

  private emitState(): void {
    if (this.state) this.floating.send('peek:state', this.state)
  }

  private teardownView(): void {
    this.target = null
    this.state = null
    const view = this.view
    this.view = null
    if (!view) return
    const hostWin = this.floating.getBrowserWindow()
    if (hostWin && !hostWin.isDestroyed()) {
      try {
        hostWin.contentView.removeChildView(view)
      } catch {
        /* already detached */
      }
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  open(req: PeekOpenRequest): void {
    if (this.parent.isDestroyed() || !isAllowedUrl(req.url)) return
    this.teardownView()
    this.ensureSession(req.partition)

    const hostWin = this.floating.ensureWindow()
    if (!hostWin || hostWin.isDestroyed()) return

    const z = this.parent.webContents.getZoomFactor()
    this.floating.setSurfaceTheme(req.dark, this.lastAppearance?.floatBg)
    this.floating.setZoomFactor(z)
    const cb = this.parent.getContentBounds()
    const workArea = screen.getDisplayNearestPoint({ x: cb.x + Math.round(cb.width / 2), y: cb.y + Math.round(cb.height / 2) }).workArea
    const bounds = computePeekBounds(cb, workArea, z)

    this.target = { url: req.url, sourceTabId: req.sourceTabId, workspaceId: req.workspaceId }
    this.state = {
      url: req.url,
      title: '',
      loading: true,
      canGoBack: false,
      dark: req.dark,
      accent: req.accent
    }

    // Create a sandboxed WebContentsView with NO preload in the originating workspace's session.
    const view = new WebContentsView({
      webPreferences: {
        partition: req.partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        safeDialogs: true,
        plugins: true,
        backgroundThrottling: true
      }
    })
    view.setBackgroundColor('#ffffffff')
    try {
      view.setBorderRadius(10)
    } catch {
      /* ignore on older Electron */
    }
    attachPageCompat(view.webContents)
    this.wireView(view, req.partition)
    this.view = view

    const placed = this.floating.showAtBounds(bounds, true, 10, () => {
      if (this.view === view && !hostWin.isDestroyed() && !view.webContents.isDestroyed()) {
        const [cw, ch] = hostWin.getContentSize()
        view.setBounds(computePeekViewRect(cw, ch, z))
        view.webContents.focus()
      }
    })
    if (!hostWin.isDestroyed()) {
      hostWin.contentView.addChildView(view)
      const [cw, ch] = hostWin.getContentSize()
      const viewW = cw > 0 ? cw : placed?.width ?? bounds.width
      const viewH = ch > 0 ? ch : placed?.height ?? bounds.height
      view.setBounds(computePeekViewRect(viewW, viewH, z))
    }

    this.emitState()
    void view.webContents.loadURL(req.url).catch(() => {})
    if (hostWin.isVisible() && !view.webContents.isDestroyed()) {
      view.webContents.focus()
    }
  }

  private wireView(view: WebContentsView, partition: string): void {
    const wc = view.webContents
    const isCurrent = (): boolean => this.view === view && !wc.isDestroyed()

    const sync = (): void => {
      if (!isCurrent() || !this.state || !this.target) return
      const curUrl = wc.getURL()
      if (curUrl && isAllowedUrl(curUrl)) {
        this.target.url = curUrl
        this.state.url = curUrl
      }
      this.state.canGoBack = wc.navigationHistory.canGoBack()
      this.emitState()
    }

    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        e.preventDefault()
        this.dismiss()
      }
    })

    // Same security baseline as normal tabs: allow only http(s)/about:blank; ask for allowlisted external apps.
    wc.on('will-navigate', (e, url) => {
      if (!isAllowedUrl(url)) {
        e.preventDefault()
        if (parseExternalAppUrl(url)) this.onExternalApp(PEEK_TAB_ID, wc.getURL(), url)
      }
    })
    wc.on('will-redirect', (e, url) => {
      if (!isAllowedUrl(url)) {
        e.preventDefault()
        if (parseExternalAppUrl(url)) this.onExternalApp(PEEK_TAB_ID, wc.getURL(), url)
      }
    })
    wc.on('will-frame-navigate', (details) => {
      if (details.isMainFrame) return
      if (!isSafeSubframeUrl(details.url)) {
        details.preventDefault()
        if (parseExternalAppUrl(details.url)) this.onExternalApp(PEEK_TAB_ID, wc.getURL(), details.url)
      }
    })
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (!isAllowedUrl(url)) {
        if (parseExternalAppUrl(url)) this.onExternalApp(PEEK_TAB_ID, wc.getURL(), url)
        return { action: 'deny' }
      }
      if (disposition === 'new-window' && features.trim().length > 0) {
        this.ensureSession(partition)
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
              webSecurity: true,
              backgroundThrottling: true
            }
          }
        }
      }
      // Keep link clicks inside the preview itself.
      if (isCurrent()) void wc.loadURL(url).catch(() => {})
      return { action: 'deny' }
    })
    wc.on('did-create-window', (popup) => {
      attachPageCompat(popup.webContents)
      popup.webContents.on('will-navigate', (e, url) => {
        if (!isAllowedUrl(url)) {
          e.preventDefault()
          if (parseExternalAppUrl(url)) this.onExternalApp(PEEK_TAB_ID, popup.webContents.getURL() || wc.getURL(), url)
        }
      })
      popup.webContents.on('will-redirect', (e, url) => {
        if (!isAllowedUrl(url)) {
          e.preventDefault()
          if (parseExternalAppUrl(url)) this.onExternalApp(PEEK_TAB_ID, popup.webContents.getURL() || wc.getURL(), url)
        }
      })
      popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    })

    wc.on('did-start-loading', () => {
      if (!isCurrent() || !this.state) return
      this.state.loading = true
      this.state.error = undefined
      this.emitState()
    })
    wc.on('did-stop-loading', () => {
      if (!isCurrent() || !this.state) return
      this.state.loading = false
      sync()
    })
    wc.on('did-navigate', () => sync())
    wc.on('did-navigate-in-page', () => sync())
    wc.on('page-title-updated', (_e, title) => {
      if (!isCurrent() || !this.state) return
      this.state.title = title
      this.emitState()
    })
    wc.on('page-favicon-updated', (_e, icons) => {
      if (!isCurrent() || !this.state) return
      this.state.favicon = icons.find((u) => /^(https?|data):/.test(u))
      this.emitState()
    })
    wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (!isCurrent() || !this.state || !isMainFrame || code === -3) return
      this.state.loading = false
      this.state.error = description || `Error ${code}`
      this.emitState()
    })
  }

  back(): void {
    const wc = this.view?.webContents
    if (wc && !wc.isDestroyed() && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  reload(): void {
    const wc = this.view?.webContents
    if (wc && !wc.isDestroyed()) wc.reload()
  }

  dismiss(): void {
    this.close()
    if (!this.parent.isDestroyed()) this.parent.focus()
  }

  close(): void {
    this.teardownView()
    this.floating.hide('asked')
    this.onClosed?.()
  }

  destroy(): void {
    this.teardownView()
    this.floating.destroy()
  }
}
