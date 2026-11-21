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
