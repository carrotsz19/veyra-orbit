/*
 * Screenshot controller for Orbit (Visible area, Full page via CDP, Select area via main UI overlay).
 * Uses FloatingWindow for both the small floating chooser and the floating preview toast so they
 * always render cleanly above native WebContentsViews.
 */
import {
  BrowserWindow,
  ClipboardItem,
  clipboard,
  nativeImage,
  screen,
  shell,
  type NativeImage,
  type WebContents
} from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { ResolvedAppearance } from '../shared/appearance'
import { pickUniqueFilename } from '../shared/downloads'
import {
  buildScreenshotFilename,
  computeChooserBounds,
  computeFullPageClip,
  computeToastBounds,
  sanitizeAreaRect,
  scaleCropRect,
  type ScreenshotAnchor,
  type ScreenshotAreaInit,
  type ScreenshotChooserPayload,
  type ScreenshotMode,
  type ScreenshotToastPayload
} from '../shared/screenshot'
import type { Rect } from '../shared/types'
import { isCompatDebuggerAttached } from './compat'
import { FloatingWindow } from './floating'

/** Rejects if `p` hasn't settled within `ms`, so a stalled capture can never wedge the tool. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took too long.`)), ms)
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export interface ScreenshotTarget {
  url: string
  title: string
  wc: WebContents | null
  isPrivate: boolean
  isInternal: boolean
  pageBounds: Rect | null
  paneBounds: Rect | null
}

export interface ScreenshotControllerDeps {
  parent: BrowserWindow
  preload: string
  acrylic: boolean
  getActiveTarget: () => ScreenshotTarget | null
  getThemeInfo: () => { dark: boolean; accent: string; appearance: ResolvedAppearance; shortcutLabel?: string }
  getDownloadsDir: () => string
  recordDownload: (savePath: string, sizeBytes: number, sourceUrl: string) => void
  setPageOverlayHidden: (hidden: boolean) => void
  onStartAreaSelect: (init: ScreenshotAreaInit) => void
  onCancelAreaSelect: () => void
  onChooserVisibilityChange?: (open: boolean) => void
}

interface StoredCapture {
  id: string
  png: Buffer
  width: number
  height: number
  mode: ScreenshotMode
  filename: string
  pageUrl: string
  isPrivate: boolean
  truncated: boolean
  notice?: string
  previewDataUrl: string
  savedPath?: string
  savedFilename?: string
}

interface PendingAreaCapture {
  /** NativeImage created from PNG (scaleFactor = 1.0, so getSize() and crop() are exact physical pixels). */
  rawImage: NativeImage
  cssWidth: number
  cssHeight: number
  pageUrl: string
  pageTitle: string
  isPrivate: boolean
}

const TOAST_AUTO_HIDE_MS = 11_000
const CHOOSER_DEFAULT_W = 240
const CHOOSER_DEFAULT_H = 176
const TOAST_DEFAULT_W = 328
const TOAST_DEFAULT_H = 196

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function writePngToClipboard(png: Buffer): Promise<boolean> {
  try {
    const blob = new Blob([new Uint8Array(png)], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

function makePreviewDataUrl(img: NativeImage): string {
  const size = img.getSize()
  if (size.width <= 0 || size.height <= 0) return ''
  // Keep preview crisp without bloating IPC payload for very tall full-page captures.
  const maxW = 340
  const maxH = 220
  let target = img
  if (size.height > size.width * 2.2) {
    // Tall full-page capture: show the top portion in the preview thumbnail so text stays legible.
    const cropH = Math.min(size.height, Math.round(size.width * 1.4))
    target = img.crop({ x: 0, y: 0, width: size.width, height: Math.max(1, cropH) })
  }
  const tSize = target.getSize()
  const ratio = Math.min(1, maxW / Math.max(1, tSize.width), maxH / Math.max(1, tSize.height))
  const resized =
    ratio < 1
      ? target.resize({
          width: Math.max(1, Math.round(tSize.width * ratio)),
          height: Math.max(1, Math.round(tSize.height * ratio)),
          quality: 'good'
        })
      : target
  return 'data:image/jpeg;base64,' + resized.toJPEG(86).toString('base64')
}

export class ScreenshotController {
  private readonly parent: BrowserWindow
  private readonly deps: ScreenshotControllerDeps
  private readonly chooser: FloatingWindow
  private readonly toast: FloatingWindow

  private chooserAnchor: ScreenshotAnchor | null = null
  private chooserSize = { width: CHOOSER_DEFAULT_W, height: CHOOSER_DEFAULT_H }
  private toastSize = { width: TOAST_DEFAULT_W, height: TOAST_DEFAULT_H }
  private toastHover = false
  private toastTimer: NodeJS.Timeout | null = null
  private capturing = false
  private captureSeq = 0
  private latestCapture: StoredCapture | null = null
  private pendingArea: PendingAreaCapture | null = null
  private lastAppearance: ResolvedAppearance | null = null

  private readonly repositionToast = (): void => {
    if (!this.toast.isVisible() && !this.toast.hasPendingShow()) return
    if (this.parent.isDestroyed()) return
    const wb = this.parent.getContentBounds()
    const wa = screen.getDisplayMatching(wb).workArea
    this.toast.setBounds(computeToastBounds(wb, wa, this.toastSize.width, this.toastSize.height))
  }

  constructor(deps: ScreenshotControllerDeps) {
    this.parent = deps.parent
    this.deps = deps

    this.chooser = new FloatingWindow({
      parent: deps.parent,
      preload: deps.preload,
      view: 'screenshot',
      extraQuery: { mode: 'chooser' },
      acrylic: deps.acrylic,
      width: CHOOSER_DEFAULT_W,
      height: CHOOSER_DEFAULT_H,
      hideOnBlur: true,
      hideOnParentMove: true,
      onHidden: () => {
        this.deps.onChooserVisibilityChange?.(false)
      }
    })

    this.toast = new FloatingWindow({
      parent: deps.parent,
      preload: deps.preload,
      view: 'screenshot',
      extraQuery: { mode: 'toast' },
      acrylic: deps.acrylic,
      width: TOAST_DEFAULT_W,
      height: TOAST_DEFAULT_H,
      hideOnBlur: false,
      hideOnParentMove: false,
      onHidden: () => {
        this.clearToastTimer()
        this.toastHover = false
      }
    })

    if (!this.parent.isDestroyed()) {
      this.parent.on('move', this.repositionToast)
      this.parent.on('resize', this.repositionToast)
    }
  }

  isSender(wc: WebContents): boolean {
    return this.chooser.isSender(wc) || this.toast.isSender(wc)
  }

  isChooserSender(wc: WebContents): boolean {
    return this.chooser.isSender(wc)
  }

  isToastSender(wc: WebContents): boolean {
    return this.toast.isSender(wc)
  }

  isChooserOpen(): boolean {
    return this.chooser.isVisible() || this.chooser.hasPendingShow()
  }

  hasPendingArea(): boolean {
    return this.pendingArea !== null
  }

  applyAppearance(tokens: ResolvedAppearance): void {
    this.lastAppearance = tokens
    const zoom = !this.parent.isDestroyed() ? this.parent.webContents.getZoomFactor() : 1
    for (const fw of [this.chooser, this.toast]) {
      fw.setZoomFactor(zoom)
      fw.setSurfaceTheme(tokens.isDark, tokens.floatBg)
      fw.send('appearance:tokens', tokens)
    }
  }

  markReady(wc: WebContents): void {
    const tokens = this.lastAppearance ?? this.deps.getThemeInfo().appearance
    const zoom = !this.parent.isDestroyed() ? this.parent.webContents.getZoomFactor() : 1
    if (this.chooser.isSender(wc)) {
      this.chooser.markReady(() => {
        this.chooser.setZoomFactor(zoom)
        this.chooser.setSurfaceTheme(tokens.isDark, tokens.floatBg)
        this.chooser.send('appearance:tokens', tokens)
      })
    } else if (this.toast.isSender(wc)) {
      this.toast.markReady(() => {
        this.toast.setZoomFactor(zoom)
        this.toast.setSurfaceTheme(tokens.isDark, tokens.floatBg)
        this.toast.send('appearance:tokens', tokens)
      })
    }
  }

  resizeForSender(wc: WebContents, width: number, height: number): void {
    if (this.parent.isDestroyed()) return
    const wb = this.parent.getContentBounds()
    const wa = screen.getDisplayMatching(wb).workArea
    const z = this.parent.webContents.getZoomFactor() || 1
    if (this.chooser.isSender(wc)) {
      const w = Math.max(180, Math.min(340, Math.ceil(width * z)))
      const h = Math.max(96, Math.min(320, Math.ceil(height * z)))
      this.chooserSize = { width: w, height: h }
      this.chooser.setBounds(computeChooserBounds(this.chooserAnchor, wb, wa, w, h))
    } else if (this.toast.isSender(wc)) {
      const w = Math.max(240, Math.min(400, Math.ceil(width * z)))
      const h = Math.max(72, Math.min(360, Math.ceil(height * z)))
      this.toastSize = { width: w, height: h }
      this.toast.setBounds(computeToastBounds(wb, wa, w, h))
    }
  }

  setToastHover(hovering: boolean): void {
    this.toastHover = hovering
    if (hovering) {
      this.clearToastTimer()
    } else if (this.toast.isVisible()) {
      this.armToastTimer()
    }
  }

  openChooser(anchorCss?: ScreenshotAnchor | null, fromParentScreen = false): void {
    if (this.parent.isDestroyed()) return
    if (this.pendingArea) this.cancelArea()
    if (this.isChooserOpen()) {
      this.closeChooser()
      return
    }
    const target = this.deps.getActiveTarget()
    const theme = this.deps.getThemeInfo()
    const wb = this.parent.getContentBounds()
    const wa = screen.getDisplayMatching(wb).workArea
    const z = this.parent.webContents.getZoomFactor()

    if (anchorCss && Number.isFinite(anchorCss.x) && Number.isFinite(anchorCss.y)) {
      this.chooserAnchor = fromParentScreen
        ? { x: Math.round(anchorCss.x), y: Math.round(anchorCss.y) }
        : { x: Math.round(wb.x + anchorCss.x * z), y: Math.round(wb.y + anchorCss.y * z) }
    } else {
      this.chooserAnchor = null
    }

    const payload: ScreenshotChooserPayload = {
      dark: theme.dark,
      accent: theme.accent,
      canFullPage: !!target?.wc,
      isInternal: !!target?.isInternal,
      isPrivate: !!target?.isPrivate,
      shortcutLabel: theme.shortcutLabel
    }

    const bounds = computeChooserBounds(this.chooserAnchor, wb, wa, this.chooserSize.width, this.chooserSize.height)
    this.chooser.ensureWindow()
    this.chooser.send('screenshot-win:chooser', payload)
    this.chooser.showAtBounds(bounds, true, 8)
    this.deps.onChooserVisibilityChange?.(true)
  }

  closeChooser(): void {
    this.chooser.hide('asked')
  }

  dismissToast(): void {
    this.clearToastTimer()
    this.toast.hide('asked')
  }

  dismissForSender(wc: WebContents): void {
    if (this.chooser.isSender(wc)) this.closeChooser()
    else if (this.toast.isSender(wc)) this.dismissToast()
  }

  async capture(mode: ScreenshotMode): Promise<void> {
    if (this.capturing || this.parent.isDestroyed()) return
    this.closeChooser()
    if (this.pendingArea) this.cancelArea()
    this.capturing = true
    try {
      // Let the floating chooser hide cleanly so it never appears in orbit:// captures.
      await delay(65)
      if (this.parent.isDestroyed()) return
      const target = this.deps.getActiveTarget()
      if (!target) {
        this.showErrorToast('There is no active tab to capture.')
        return
      }
      if (mode === 'visible') {
        await this.captureVisible(target)
      } else if (mode === 'full') {
        await this.captureFullPage(target)
      } else if (mode === 'area') {
        await this.startAreaSelection(target)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Screenshot failed.'
      this.showErrorToast(msg)
    } finally {
      this.capturing = false
    }
  }

  private async captureTargetBitmap(target: ScreenshotTarget): Promise<{ image: NativeImage; cssWidth: number; cssHeight: number }> {
    if (target.wc && !target.wc.isDestroyed()) {
      const img = await withTimeout(target.wc.capturePage(), 10_000, 'Capturing the page')
      const rect = target.paneBounds ?? target.pageBounds
      const cssW = rect?.width ?? img.getSize().width
      const cssH = rect?.height ?? img.getSize().height
      return { image: img, cssWidth: cssW, cssHeight: cssH }
    }
    // Internal orbit:// or Start page rendered inside parent BrowserWindow's `.page` rect.
    const rect = target.paneBounds ?? target.pageBounds
    if (!rect || rect.width < 2 || rect.height < 2) {
      const img = await withTimeout(this.parent.webContents.capturePage(), 10_000, 'Capturing the page')
      const cb = this.parent.getContentBounds()
      return { image: img, cssWidth: cb.width, cssHeight: cb.height }
    }
    const captureRect = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    }
    const img = await withTimeout(this.parent.webContents.capturePage(captureRect), 10_000, 'Capturing the page')
    return { image: img, cssWidth: captureRect.width, cssHeight: captureRect.height }
  }

  private async captureVisible(target: ScreenshotTarget, notice?: string): Promise<void> {
    const { image } = await this.captureTargetBitmap(target)
    if (image.isEmpty()) {
      this.showErrorToast("Couldn't capture the current page.")
      return
    }
    const png = image.toPNG()
    const raw = nativeImage.createFromBuffer(png)
    const size = raw.getSize()
    this.finalizeCapture({
      png,
      raw,
      width: size.width,
      height: size.height,
      mode: 'visible',
      target,
      truncated: false,
      notice
    })
  }

  private async captureFullPage(target: ScreenshotTarget): Promise<void> {
    if (!target.wc || target.wc.isDestroyed()) {
      await this.captureVisible(target, 'Full-page scroll capture applies to web pages — captured the visible view.')
      return
    }
    const wc = target.wc
    const dbg = wc.debugger

    // Graceful fallback when DevTools or an external debugger owns the target.
    if (wc.isDevToolsOpened()) {
      await this.captureVisible(
        target,
        'Developer Tools is open on this tab — captured the visible area instead.'
      )
      return
    }
    if (dbg.isAttached() && !isCompatDebuggerAttached(wc)) {
      await this.captureVisible(
        target,
        'A debugger is already attached to this tab — captured the visible area instead.'
      )
      return
    }

    const theme = this.deps.getThemeInfo()
    this.showBusyToast(theme, 'Capturing full page… long pages can take up to a minute.')

    const attachedByUs = !dbg.isAttached()
    if (attachedByUs) {
      try {
        dbg.attach('1.3')
      } catch {
        await this.captureVisible(
          target,
          'Could not attach capture debugger — captured the visible area instead.'
        )
        return
      }
    }

    try {
      const metrics = (await withTimeout(dbg.sendCommand('Page.getLayoutMetrics'), 5_000, 'Measuring the page')) as {
        cssContentSize?: { width: number; height: number }
        contentSize?: { width: number; height: number }
        cssLayoutViewport?: { clientWidth: number; clientHeight: number }
      }
      const content = metrics.cssContentSize ?? metrics.contentSize
      const contentW = content?.width ?? metrics.cssLayoutViewport?.clientWidth ?? (target.paneBounds?.width ?? 1200)
      const contentH = content?.height ?? metrics.cssLayoutViewport?.clientHeight ?? (target.paneBounds?.height ?? 800)
      const dpr = screen.getDisplayMatching(this.parent.getBounds()).scaleFactor || 1
      const plan = computeFullPageClip(contentW, contentH, dpr)

      const shot = (await withTimeout(dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: plan.x,
          y: plan.y,
          width: plan.width,
          height: plan.height,
          scale: plan.scale
        }
      }), 60_000, 'Capturing the full page')) as { data?: string }

      if (!shot?.data) {
        await this.captureVisible(target, 'Full-page capture returned empty — captured the visible area instead.')
        return
      }

      const png = Buffer.from(shot.data, 'base64')
      const raw = nativeImage.createFromBuffer(png)
      if (raw.isEmpty()) {
        await this.captureVisible(target, 'Full-page capture failed to decode — captured the visible area instead.')
        return
      }
      const size = raw.getSize()
      const notice = plan.truncated
        ? `Page was taller than the capture limit — captured the top ${plan.height.toLocaleString()} px.`
        : undefined
      this.finalizeCapture({
        png,
        raw,
        width: size.width,
        height: size.height,
        mode: 'full',
        target,
        truncated: plan.truncated,
        notice
      })
    } catch {
      await this.captureVisible(
        target,
        'Full-page capture was unavailable on this page — captured the visible area instead.'
      )
    } finally {
      if (attachedByUs && !wc.isDestroyed() && dbg.isAttached()) {
        try {
          dbg.detach()
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async startAreaSelection(target: ScreenshotTarget): Promise<void> {
    const { image, cssWidth, cssHeight } = await this.captureTargetBitmap(target)
    if (image.isEmpty() || cssWidth < 4 || cssHeight < 4) {
      this.showErrorToast("Couldn't start area capture on this page.")
      return
    }
    const png = image.toPNG()
    const rawImage = nativeImage.createFromBuffer(png)
    const offsetX =
      target.paneBounds && target.pageBounds ? Math.max(0, target.paneBounds.x - target.pageBounds.x) : 0
    const offsetY =
      target.paneBounds && target.pageBounds ? Math.max(0, target.paneBounds.y - target.pageBounds.y) : 0

    this.pendingArea = {
      rawImage,
      cssWidth,
      cssHeight,
      pageUrl: target.url,
      pageTitle: target.title,
      isPrivate: target.isPrivate
    }
    this.dismissToast()
    this.deps.setPageOverlayHidden(true)
    this.deps.onStartAreaSelect({
      imageDataUrl: 'data:image/jpeg;base64,' + rawImage.toJPEG(90).toString('base64'),
      cssWidth,
      cssHeight,
      offsetX,
      offsetY
    })
    if (!this.parent.isDestroyed()) this.parent.webContents.focus()
  }

  commitArea(rawRect: unknown): void {
    const pending = this.pendingArea
    this.pendingArea = null
    this.deps.setPageOverlayHidden(false)
    if (!pending) return

    const clean = sanitizeAreaRect(rawRect, pending.cssWidth, pending.cssHeight)
    if (!clean) return
    const imgSize = pending.rawImage.getSize()
    const cropBox = scaleCropRect(clean, pending.cssWidth, pending.cssHeight, imgSize.width, imgSize.height)
    const cropped = pending.rawImage.crop(cropBox)
    if (cropped.isEmpty()) {
      this.showErrorToast("Couldn't crop the selected area.")
      return
    }
    const png = cropped.toPNG()
    const raw = nativeImage.createFromBuffer(png)
    const size = raw.getSize()
    this.finalizeCapture({
      png,
      raw,
      width: size.width,
      height: size.height,
      mode: 'area',
      target: {
        url: pending.pageUrl,
        title: pending.pageTitle,
        wc: null,
        isPrivate: pending.isPrivate,
        isInternal: false,
        pageBounds: null,
        paneBounds: null
      },
      truncated: false
    })
  }

  cancelArea(): void {
    if (!this.pendingArea) return
    this.pendingArea = null
    this.deps.setPageOverlayHidden(false)
    this.deps.onCancelAreaSelect()
  }

  private finalizeCapture(opts: {
    png: Buffer
    raw: NativeImage
    width: number
    height: number
    mode: ScreenshotMode
    target: ScreenshotTarget
    truncated: boolean
    notice?: string
  }): void {
    // Always copy immediately to the system clipboard (allowed in private workspaces; never auto-saved).
    void writePngToClipboard(opts.png)

    const id = `shot-${++this.captureSeq}`
    const filename = buildScreenshotFilename(opts.target.url, opts.target.title)
    const previewDataUrl = makePreviewDataUrl(opts.raw)

    this.latestCapture = {
      id,
      png: opts.png,
      width: opts.width,
      height: opts.height,
      mode: opts.mode,
      filename,
      pageUrl: opts.target.url,
      isPrivate: opts.target.isPrivate,
      truncated: opts.truncated,
      notice: opts.notice,
      previewDataUrl
    }

    this.showCaptureToast(this.latestCapture)
  }

  saveCapture(id: string): { ok: boolean; filename?: string; savePath?: string; error?: string } {
    const cap = this.latestCapture
    if (!cap || cap.id !== id) {
      return { ok: false, error: 'That screenshot is no longer available.' }
    }
    if (cap.savedPath && existsSync(cap.savedPath)) {
      return { ok: true, filename: cap.savedFilename, savePath: cap.savedPath }
    }
    try {
      const baseDir = resolve(this.deps.getDownloadsDir())
      mkdirSync(baseDir, { recursive: true })
      const uniqueName = pickUniqueFilename(cap.filename, (name) => existsSync(join(baseDir, name)))
      const savePath = join(baseDir, uniqueName)
      writeFileSync(savePath, cap.png)
      cap.savedPath = savePath
      cap.savedFilename = basename(savePath)
      this.deps.recordDownload(savePath, cap.png.length, cap.isPrivate ? '' : cap.pageUrl)
      this.showCaptureToast(cap)
      return { ok: true, filename: cap.savedFilename, savePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not save screenshot.' }
    }
  }

  async copyAgain(id: string): Promise<boolean> {
    const cap = this.latestCapture
    if (!cap || cap.id !== id) return false
    const ok = await writePngToClipboard(cap.png)
    if (ok) this.armToastTimer()
    return ok
  }

  showInFolder(id: string): void {
    const cap = this.latestCapture
    if (!cap || cap.id !== id || !cap.savedPath || !existsSync(cap.savedPath)) return
    shell.showItemInFolder(cap.savedPath)
  }

  private showBusyToast(theme: { dark: boolean; accent: string }, message: string): void {
    if (this.parent.isDestroyed()) return
    this.clearToastTimer()
    const payload: ScreenshotToastPayload = {
      dark: theme.dark,
      accent: theme.accent,
      busy: message
    }
    const wb = this.parent.getContentBounds()
    const wa = screen.getDisplayMatching(wb).workArea
    this.toast.ensureWindow()
    this.toast.send('screenshot-win:toast', payload)
    this.toast.showAtBounds(computeToastBounds(wb, wa, this.toastSize.width, 84), false, 8)
  }

  private showCaptureToast(cap: StoredCapture): void {
    if (this.parent.isDestroyed()) return
    const theme = this.deps.getThemeInfo()
    const payload: ScreenshotToastPayload = {
      dark: theme.dark,
      accent: theme.accent,
      id: cap.id,
      previewDataUrl: cap.previewDataUrl,
      width: cap.width,
      height: cap.height,
      mode: cap.mode,
      filename: cap.filename,
      truncated: cap.truncated,
      isPrivate: cap.isPrivate,
      savedPath: cap.savedPath,
      savedFilename: cap.savedFilename,
      notice: cap.notice
    }
    const wb = this.parent.getContentBounds()
    const wa = screen.getDisplayMatching(wb).workArea
    this.toast.ensureWindow()
    this.toast.send('screenshot-win:toast', payload)
    this.toast.showAtBounds(computeToastBounds(wb, wa, this.toastSize.width, this.toastSize.height), false, 8)
    this.armToastTimer()
  }

  private showErrorToast(message: string): void {
    if (this.parent.isDestroyed()) return
    const theme = this.deps.getThemeInfo()
    const payload: ScreenshotToastPayload = {
      dark: theme.dark,
      accent: theme.accent,
      error: message
    }
    const wb = this.parent.getContentBounds()
    const wa = screen.getDisplayMatching(wb).workArea
    this.toast.ensureWindow()
    this.toast.send('screenshot-win:toast', payload)
    this.toast.showAtBounds(computeToastBounds(wb, wa, this.toastSize.width, 108), false, 8)
    this.armToastTimer()
  }

  private clearToastTimer(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer)
      this.toastTimer = null
    }
  }

  private armToastTimer(): void {
    this.clearToastTimer()
    if (this.toastHover) return
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null
      if (!this.toastHover) this.toast.hide('asked')
    }, TOAST_AUTO_HIDE_MS)
  }

  destroy(): void {
    this.clearToastTimer()
    this.latestCapture = null
    this.pendingArea = null
    if (!this.parent.isDestroyed()) {
      this.parent.off('move', this.repositionToast)
      this.parent.off('resize', this.repositionToast)
    }
    this.chooser.destroy()
    this.toast.destroy()
  }
}
