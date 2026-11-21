/*
 * Pure Link Preview ("Peek") geometry, action validation, and Shift/Alt-click trigger rules.
 * Shared between main, renderer, and node:test unit tests.
 */
import { clampPopupBounds, type BoundsRect } from './menu.ts'

export const PEEK_TOOLBAR_HEIGHT = 44
export const PEEK_PADDING = 6
export const PEEK_TAB_ID = -1

export type PeekAction = 'back' | 'reload' | 'open-tab' | 'open-split' | 'close'

const PEEK_ACTIONS = new Set<string>(['back', 'reload', 'open-tab', 'open-split', 'close'])

export interface PeekState {
  url: string
  title: string
  favicon?: string
  loading: boolean
  canGoBack: boolean
  dark: boolean
  accent: string
  error?: string
}

export function isPeekAction(v: unknown): v is PeekAction {
  return typeof v === 'string' && PEEK_ACTIONS.has(v)
}

/**
 * Computes centred floating bounds for the Peek preview window over the parent window,
 * clamped inside the active display's workArea.
 */
export function computePeekBounds(parentContent: BoundsRect, workArea: BoundsRect, zoom = 1): BoundsRect {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const pw = Math.max(400, parentContent.width / z)
  const ph = Math.max(320, parentContent.height / z)
  const widthCss = Math.min(980, Math.max(520, Math.round(pw * 0.78)))
  const heightCss = Math.min(760, Math.max(400, Math.round(ph * 0.82)))
  const width = Math.round(widthCss * z)
  const height = Math.round(heightCss * z)
  const x = Math.round(parentContent.x + (parentContent.width - width) / 2)
  const y = Math.round(parentContent.y + (parentContent.height - height) / 2)
  return clampPopupBounds({ x, y }, { width, height }, workArea, 10)
}

/** Computes the hosted WebContentsView bounds inside the Peek window below the toolbar. */
export function computePeekViewRect(contentWidth: number, contentHeight: number, zoom = 1): BoundsRect {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const pad = Math.round(PEEK_PADDING * z)
  const top = Math.round(PEEK_TOOLBAR_HEIGHT * z)
  return {
    x: pad,
    y: top,
    width: Math.max(100, Math.round(contentWidth) - pad * 2),
    height: Math.max(100, Math.round(contentHeight) - top - pad)
  }
}

/**
 * Decides whether a Chromium window-open event represents a Shift+click link peek rather than
 * a real site popup (e.g. "Sign in with Google", which passes explicit window features).
 */
export function shouldPeekWindowOpen(disposition: string, features: string, shiftHeld: boolean): boolean {
  if (disposition !== 'new-window') return false
  const hasFeatures = features.trim().length > 0
  if (hasFeatures) return false
  return shiftHeld || !hasFeatures
}
