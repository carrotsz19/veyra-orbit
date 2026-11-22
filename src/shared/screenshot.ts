/*
 * Screenshot capture helpers: full-page clip capping (~16384 CSS px / ~120 MP),
 * Windows-safe filenames ("Screenshot <site> <date time>.png"), area-rect validation
 * & pixel crop mapping, and floating chooser / preview toast bounds.
 * Pure module (zero Electron/Node deps) shared across main, renderers, and unit tests.
 */

import { clampPopupBounds, type BoundsRect } from './menu.ts'

export type ScreenshotMode = 'visible' | 'full' | 'area'

export interface ScreenshotAnchor {
  x: number
  y: number
}

export interface ScreenshotAreaRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenshotAreaInit {
  imageDataUrl: string
  cssWidth: number
  cssHeight: number
  /** Offset of the captured pane within `.page` (0,0 when not split). */
  offsetX: number
  offsetY: number
}

export interface ScreenshotChooserPayload {
  dark: boolean
  accent: string
  canFullPage: boolean
  isInternal: boolean
  isPrivate: boolean
  shortcutLabel?: string
}

export interface ScreenshotToastPayload {
  dark: boolean
  accent: string
  id?: string
  previewDataUrl?: string
  width?: number
  height?: number
  mode?: ScreenshotMode
  filename?: string
  truncated?: boolean
  isPrivate?: boolean
  savedPath?: string
  savedFilename?: string
  notice?: string
  error?: string
  busy?: string
}

export const MAX_FULLPAGE_CSS_HEIGHT = 16_384
export const MAX_FULLPAGE_PIXELS = 120_000_000
export const MIN_AREA_SELECTION_PX = 4

const MODES = new Set<string>(['visible', 'full', 'area'])

export function isScreenshotMode(v: unknown): v is ScreenshotMode {
  return typeof v === 'string' && MODES.has(v)
}

export interface FullPageClipPlan {
  x: number
  y: number
  width: number
  height: number
  scale: number
  dpr: number
  truncated: boolean
  expectedPixelWidth: number
  expectedPixelHeight: number
}

/**
 * Computes a safe CDP `Page.captureScreenshot` clip for full-page capture at native DPR,
 * capping height at ~16384 CSS px and total output pixels at ~120 MP.
 */
export function computeFullPageClip(contentWidth: number, contentHeight: number, dpr: number): FullPageClipPlan {
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? Math.max(1, Math.min(4, dpr)) : 1
  const width = Number.isFinite(contentWidth) && contentWidth > 0 ? Math.max(1, Math.ceil(contentWidth)) : 1
  const rawHeight = Number.isFinite(contentHeight) && contentHeight > 0 ? Math.max(1, Math.ceil(contentHeight)) : 1

  const maxHeightByPixels = Math.max(1, Math.floor(MAX_FULLPAGE_PIXELS / Math.max(1, width * safeDpr * safeDpr)))
  const maxCssHeight = Math.min(MAX_FULLPAGE_CSS_HEIGHT, maxHeightByPixels)
  const height = Math.min(rawHeight, maxCssHeight)
  const truncated = rawHeight > height

  return {
    x: 0,
    y: 0,
    width,
    height,
    scale: 1,
    dpr: safeDpr,
    truncated,
    expectedPixelWidth: Math.round(width * safeDpr),
    expectedPixelHeight: Math.round(height * safeDpr)
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function sanitizeFilenameSegment(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .trim()
    .slice(0, 60)
}

/** Extracts a calm human-readable site label for screenshot filenames. */
export function screenshotSiteLabel(pageUrl: string, pageTitle = ''): string {
  const trimmedUrl = (pageUrl || '').trim()
  if (/^https?:\/\//i.test(trimmedUrl)) {
    try {
      const host = new URL(trimmedUrl).hostname.replace(/^www\./i, '')
      const clean = sanitizeFilenameSegment(host)
      if (clean) return clean
    } catch {
      /* fall through */
    }
  } else if (/^orbit:\/\//i.test(trimmedUrl)) {
    const slug = sanitizeFilenameSegment(trimmedUrl.replace(/^orbit:\/\//i, 'orbit-').replace(/\/+$/, ''))
    if (slug) return slug
  }
  const fromTitle = sanitizeFilenameSegment(pageTitle || '')
  if (fromTitle) return fromTitle
  return 'Start page'
}

/** Builds a Windows-safe PNG filename: "Screenshot <site> <YYYY-MM-DD HH-MM-SS>.png". */
export function buildScreenshotFilename(pageUrl: string, pageTitle = '', now: Date = new Date()): string {
  const site = screenshotSiteLabel(pageUrl, pageTitle)
  const datePart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const timePart = `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`
  return `Screenshot ${site} ${datePart} ${timePart}.png`
}

/** Validates and clamps a user-dragged area selection rect inside `[0..maxW, 0..maxH]`. */
export function sanitizeAreaRect(raw: unknown, maxW: number, maxH: number): ScreenshotAreaRect | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!Number.isFinite(maxW) || !Number.isFinite(maxH) || maxW < MIN_AREA_SELECTION_PX || maxH < MIN_AREA_SELECTION_PX) {
    return null
  }
  const r = raw as Record<string, unknown>
  if (
    typeof r.x !== 'number' ||
    typeof r.y !== 'number' ||
    typeof r.width !== 'number' ||
    typeof r.height !== 'number' ||
    !Number.isFinite(r.x) ||
    !Number.isFinite(r.y) ||
    !Number.isFinite(r.width) ||
    !Number.isFinite(r.height)
  ) {
    return null
  }
  let x1 = r.x
  let y1 = r.y
  let x2 = r.x + r.width
  let y2 = r.y + r.height
  if (x2 < x1) [x1, x2] = [x2, x1]
  if (y2 < y1) [y1, y2] = [y2, y1]
  x1 = Math.max(0, Math.min(maxW, x1))
  y1 = Math.max(0, Math.min(maxH, y1))
  x2 = Math.max(0, Math.min(maxW, x2))
  y2 = Math.max(0, Math.min(maxH, y2))
  const width = Math.round(x2 - x1)
  const height = Math.round(y2 - y1)
  if (width < MIN_AREA_SELECTION_PX || height < MIN_AREA_SELECTION_PX) return null
  return { x: Math.round(x1), y: Math.round(y1), width, height }
}

/** Maps a CSS-pixel selection rect into exact integer pixel crop coordinates on the captured bitmap. */
export function scaleCropRect(
  rect: ScreenshotAreaRect,
  cssWidth: number,
  cssHeight: number,
  imgWidth: number,
  imgHeight: number
): ScreenshotAreaRect {
  const sx = cssWidth > 0 ? imgWidth / cssWidth : 1
  const sy = cssHeight > 0 ? imgHeight / cssHeight : 1
  const x = Math.max(0, Math.min(imgWidth - 1, Math.round(rect.x * sx)))
  const y = Math.max(0, Math.min(imgHeight - 1, Math.round(rect.y * sy)))
  const width = Math.max(1, Math.min(imgWidth - x, Math.round(rect.width * sx)))
  const height = Math.max(1, Math.min(imgHeight - y, Math.round(rect.height * sy)))
  return { x, y, width, height }
}

/** Positions the floating screenshot chooser near the toolbar camera button (or top-right fallback). */
export function computeChooserBounds(
  anchor: ScreenshotAnchor | null,
  winBounds: BoundsRect,
  workArea: BoundsRect,
  width = 240,
  height = 176
): BoundsRect {
  const desiredX = anchor ? Math.round(anchor.x - width / 2 + 14) : winBounds.x + winBounds.width - width - 24
  const desiredY = anchor ? Math.round(anchor.y) : winBounds.y + 52
  return clampPopupBounds({ x: desiredX, y: desiredY }, { width, height }, workArea, 8)
}

/** Positions the floating screenshot preview toast in the bottom-right corner of the Orbit window. */
export function computeToastBounds(
  winBounds: BoundsRect,
  workArea: BoundsRect,
  width = 328,
  height = 200
): BoundsRect {
  const desiredX = winBounds.x + winBounds.width - width - 20
  const desiredY = winBounds.y + winBounds.height - height - 20
  return clampPopupBounds({ x: desiredX, y: desiredY }, { width, height }, workArea, 8)
}
