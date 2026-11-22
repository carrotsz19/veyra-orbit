/*
 * Pure geometry helpers for compact mode edge reveal and settings scroll-spy.
 */

export interface CompactRevealState {
  enabled: boolean
  sidebar: boolean
  toolbar: boolean
}

export interface CompactZoneInput {
  /** Cursor X relative to window content area left edge (CSS px). */
  rx: number
  /** Cursor Y relative to window content area top edge (CSS px). */
  ry: number
  contentWidth: number
  contentHeight: number
  sidebarOpen: boolean
  toolbarOpen: boolean
  sidebarWidth?: number
  toolbarHeight?: number
  edgePx?: number
  keepBufferPx?: number
}

export interface CompactZoneResult {
  insideWindow: boolean
  wantSidebar: boolean
  wantToolbar: boolean
}

/**
 * Evaluates whether the cursor is in the left/top reveal trigger zone or keep-open zone.
 * Trigger zones are narrow strips along the left/top edges; once revealed, the keep-open zone
 * expands to cover the full revealed panel plus a small buffer to prevent jitter.
 */
export function computeCompactZones(input: CompactZoneInput): CompactZoneResult {
  const edge = input.edgePx ?? 10
  const buffer = input.keepBufferPx ?? 16
  const sideW = input.sidebarWidth ?? 248
  const barH = input.toolbarHeight ?? 40

  const insideWindow =
    input.contentWidth > 0 &&
    input.contentHeight > 0 &&
    input.rx >= 0 &&
    input.rx <= input.contentWidth &&
    input.ry >= 0 &&
    input.ry <= input.contentHeight

  if (!insideWindow) {
    return { insideWindow: false, wantSidebar: false, wantToolbar: false }
  }

  const wantSidebar = input.sidebarOpen ? input.rx <= sideW + buffer : input.rx <= edge
  const wantToolbar = input.toolbarOpen ? input.ry <= barH + buffer : input.ry <= edge

  return { insideWindow: true, wantSidebar, wantToolbar }
}

/**
 * Whether hiding a floating compact panel should first return focus to its parent browser window.
 * On Windows, hiding the currently focused child BrowserWindow drops foreground focus from the
 * app instead of returning it to the parent, which would stop compact edge hover from revealing
 * panels until the user clicks the window again. If another app already took focus, the panel is
 * no longer focused and we must not steal focus back.
 */
export function shouldRestoreParentFocusOnCompactHide(opts: {
  panelFocused: boolean
  parentVisible: boolean
  parentMinimized: boolean
}): boolean {
  return opts.panelFocused && opts.parentVisible && !opts.parentMinimized
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenPoint {
  x: number
  y: number
}

/**
 * Computes the next main-window bounds while dragging from the floating compact titlebar.
 * Preserves the exact initial width and height so Windows DPI scaling never drifts window size.
 */
export function computeCompactWindowDrag(
  startBounds: WindowBounds,
  startCursor: ScreenPoint,
  cursor: ScreenPoint
): WindowBounds {
  const dx = Math.round(cursor.x - startCursor.x)
  const dy = Math.round(cursor.y - startCursor.y)
  return {
    x: Math.round(startBounds.x + dx),
    y: Math.round(startBounds.y + dy),
    width: Math.round(startBounds.width),
    height: Math.round(startBounds.height)
  }
}

/**
 * Computes where a restored window should be positioned when the user starts dragging
 * a maximized window by the compact titlebar: keeps the cursor at the same horizontal
 * proportion across the titlebar and near the top bar vertically.
 */
export function computeRestoreDragBounds(
  maximizedBounds: WindowBounds,
  restoredSize: { width: number; height: number },
  cursor: ScreenPoint,
  titlebarOffsetY = 20
): WindowBounds {
  const maxW = Math.max(1, maximizedBounds.width)
  const ratio = Math.min(0.92, Math.max(0.08, (cursor.x - maximizedBounds.x) / maxW))
  return {
    x: Math.round(cursor.x - restoredSize.width * ratio),
    y: Math.round(cursor.y - titlebarOffsetY),
    width: Math.round(restoredSize.width),
    height: Math.round(restoredSize.height)
  }
}

export type EdgeSnapResult =
  | { kind: 'none' }
  | { kind: 'maximize' }
  | { kind: 'bounds'; bounds: WindowBounds }

/**
 * Evaluates Aero-style screen-edge snap when releasing a compact-titlebar window drag:
 * top edge maximizes, left edge snaps left half, right edge snaps right half.
 */
export function computeEdgeSnap(
  cursor: ScreenPoint,
  workArea: WindowBounds,
  thresholdPx = 4
): EdgeSnapResult {
  if (workArea.width <= 0 || workArea.height <= 0) return { kind: 'none' }
  if (cursor.y <= workArea.y + thresholdPx) {
    return { kind: 'maximize' }
  }
  if (cursor.x <= workArea.x + thresholdPx) {
    const half = Math.floor(workArea.width / 2)
    return {
      kind: 'bounds',
      bounds: { x: workArea.x, y: workArea.y, width: half, height: workArea.height }
    }
  }
  if (cursor.x >= workArea.x + workArea.width - thresholdPx) {
    const half = Math.floor(workArea.width / 2)
    return {
      kind: 'bounds',
      bounds: { x: workArea.x + workArea.width - half, y: workArea.y, width: half, height: workArea.height }
    }
  }
  return { kind: 'none' }
}

export interface ScrollSection {
  id: string
  /** Section top relative to the scroll container's visible top edge (px). */
  top: number
}

/**
 * Picks the active settings nav section from current scroll metrics.
 * Returns the last section when scrolled to the bottom; otherwise picks the section nearest the
 * top of the scroll viewport (the last section whose top has passed or reached the top anchor).
 */
export function pickActiveSection(
  sections: readonly ScrollSection[],
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  anchorPx = 48
): string | null {
  if (!sections.length) return null
  if (scrollHeight > clientHeight && scrollTop + clientHeight >= scrollHeight - 2) {
    return sections[sections.length - 1].id
  }
  let chosen = sections[0].id
  for (const s of sections) {
    if (s.top <= anchorPx) chosen = s.id
    else break
  }
  return chosen
}
