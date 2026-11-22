/*
 * Split view model, layout geometry (2 to 4 panes in side-by-side, stacked top/bottom,
 * or 2x2 grid), ratio clamping, 4-edge drop detection, recent-partner selection, and
 * pane group operations. Pure, so it is shared between main, renderer, and node:test.
 */

export const MAX_SPLIT_PANES = 4
export const MIN_SPLIT_RATIO = 0.2
export const MAX_SPLIT_RATIO = 0.8
export const DEFAULT_SPLIT_RATIO = 0.5
/** Gap between adjacent split panes (where the draggable divider sits), in CSS pixels. */
export const SPLIT_GAP = 8
/** Inset inside each pane frame so the focused pane accent ring shows cleanly around the native WebContentsView. */
export const SPLIT_RING_INSET = 2

export type SplitPlacement = 'left' | 'right' | 'top' | 'bottom'
export type SplitOrientation = 'side-by-side' | 'stacked'

const PLACEMENTS = new Set<string>(['left', 'right', 'top', 'bottom'])
const ORIENTATIONS = new Set<string>(['side-by-side', 'stacked'])

export function isSplitPlacement(v: unknown): v is SplitPlacement {
  return typeof v === 'string' && PLACEMENTS.has(v)
}

export function isSplitOrientation(v: unknown): v is SplitOrientation {
  return typeof v === 'string' && ORIENTATIONS.has(v)
}

export interface SplitRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SplitGroup {
  id: string
  /** Ordered tab ids in this split group (2..4 unique tabs in the same workspace). */
  tabIds: number[]
  /** Horizontal split ratio for the vertical divider (0.2..0.8). */
  colRatio: number
  /** Vertical split ratio for the horizontal divider when stacked or 3–4 panes are open (0.2..0.8). */
  rowRatio: number
  /** Arrangement for 2-pane splits: 'side-by-side' (default, left/right) or 'stacked' (top/bottom). */
  orientation?: SplitOrientation
}

export interface SplitPaneLayout {
  index: number
  /** Outer card rect inside the container (CSS pixels relative to container origin or window). */
  frame: SplitRect
  /** Inner rect for the native WebContentsView, inset by SPLIT_RING_INSET so the focus ring stays visible. */
  view: SplitRect
}

export interface SplitDividerLayout {
  kind: 'col' | 'row'
  orientation: 'vertical' | 'horizontal'
  rect: SplitRect
}

export interface SplitLayout {
  panes: SplitPaneLayout[]
  dividers: SplitDividerLayout[]
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_SPLIT_RATIO
  return Math.round(Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio)) * 1000) / 1000
}

function insetRect(r: SplitRect, inset: number): SplitRect {
  const i = Math.max(0, Math.min(inset, Math.floor(Math.min(r.width, r.height) / 4)))
  return {
    x: r.x + i,
    y: r.y + i,
    width: Math.max(1, r.width - i * 2),
    height: Math.max(1, r.height - i * 2)
  }
}

/**
 * Decides which of the four page edges ('left' | 'right' | 'top' | 'bottom') a pointer
 * is closest to inside `rect` (using normalised distances so all four edge zones scale
 * evenly across aspect ratios). Returns null when the pointer lies outside `rect`.
 */
export function dropPlacementFromPoint(x: number, y: number, rect: SplitRect): SplitPlacement | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || rect.width <= 0 || rect.height <= 0) return null
  if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) return null

  const nx = (x - rect.x) / rect.width
  const ny = (y - rect.y) / rect.height
  const dLeft = nx
  const dRight = 1 - nx
  const dTop = ny
  const dBottom = 1 - ny

  let best: SplitPlacement = 'left'
  let min = dLeft
  if (dRight < min) {
    min = dRight
    best = 'right'
  }
  if (dTop < min) {
    min = dTop
    best = 'top'
  }
  if (dBottom < min) {
    best = 'bottom'
  }
  return best
}

/**
 * Computes pixel-aligned pane frames, inset WebContentsView rects, and gap divider rects
 * for 1..4 panes inside `container`.
 *
 * Layout:
 * - 1 pane: full container, no inset, no dividers
 * - 2 panes ('side-by-side'): [left, right] split vertically by colRatio
 * - 2 panes ('stacked'): [top, bottom] split horizontally by rowRatio
 * - 3 panes: [left (full height), topRight, bottomRight] split by colRatio and rowRatio on the right
 * - 4 panes: [topLeft, topRight, bottomLeft, bottomRight] 2x2 grid split by colRatio and rowRatio
 */
export function computeSplitLayout(
  container: SplitRect,
  paneCount: number,
  ratios: { colRatio?: number; rowRatio?: number; orientation?: SplitOrientation } = {},
  opts: { gap?: number; ringInset?: number } = {}
): SplitLayout {
  const count = Math.max(0, Math.min(MAX_SPLIT_PANES, Math.trunc(paneCount)))
  if (count === 0 || container.width <= 0 || container.height <= 0) {
    return { panes: [], dividers: [] }
  }

  const base: SplitRect = {
    x: Math.round(container.x),
    y: Math.round(container.y),
    width: Math.max(1, Math.round(container.width)),
    height: Math.max(1, Math.round(container.height))
  }

  if (count === 1) {
    return {
      panes: [{ index: 0, frame: base, view: base }],
      dividers: []
    }
  }

  const gap = Math.max(0, Math.round(opts.gap ?? SPLIT_GAP))
  const ring = Math.max(0, Math.round(opts.ringInset ?? SPLIT_RING_INSET))
  const colRatio = clampSplitRatio(ratios.colRatio ?? DEFAULT_SPLIT_RATIO)
  const rowRatio = clampSplitRatio(ratios.rowRatio ?? DEFAULT_SPLIT_RATIO)
  const orientation: SplitOrientation = ratios.orientation === 'stacked' ? 'stacked' : 'side-by-side'

  if (count === 2 && orientation === 'stacked') {
    const availH = Math.max(2, base.height - gap)
    const topH = Math.max(1, Math.min(availH - 1, Math.round(availH * rowRatio)))
    const botH = Math.max(1, availH - topH)
    const botY = base.y + topH + gap
    const f0: SplitRect = { x: base.x, y: base.y, width: base.width, height: topH }
    const f1: SplitRect = { x: base.x, y: botY, width: base.width, height: botH }
    const rowDivider: SplitDividerLayout = {
      kind: 'row',
      orientation: 'horizontal',
      rect: { x: base.x, y: base.y + topH, width: base.width, height: gap }
    }
    return {
      panes: [
        { index: 0, frame: f0, view: insetRect(f0, ring) },
        { index: 1, frame: f1, view: insetRect(f1, ring) }
      ],
      dividers: [rowDivider]
    }
  }

  const availW = Math.max(2, base.width - gap)
  const leftW = Math.max(1, Math.min(availW - 1, Math.round(availW * colRatio)))
  const rightW = Math.max(1, availW - leftW)
  const rightX = base.x + leftW + gap

  const colDivider: SplitDividerLayout = {
    kind: 'col',
    orientation: 'vertical',
    rect: { x: base.x + leftW, y: base.y, width: gap, height: base.height }
  }

  if (count === 2) {
    const f0: SplitRect = { x: base.x, y: base.y, width: leftW, height: base.height }
    const f1: SplitRect = { x: rightX, y: base.y, width: rightW, height: base.height }
    return {
      panes: [
        { index: 0, frame: f0, view: insetRect(f0, ring) },
        { index: 1, frame: f1, view: insetRect(f1, ring) }
      ],
      dividers: [colDivider]
    }
  }

  const availH = Math.max(2, base.height - gap)
  const topH = Math.max(1, Math.min(availH - 1, Math.round(availH * rowRatio)))
  const botH = Math.max(1, availH - topH)
  const botY = base.y + topH + gap

  if (count === 3) {
    const f0: SplitRect = { x: base.x, y: base.y, width: leftW, height: base.height }
    const f1: SplitRect = { x: rightX, y: base.y, width: rightW, height: topH }
    const f2: SplitRect = { x: rightX, y: botY, width: rightW, height: botH }
    const rowDivider: SplitDividerLayout = {
      kind: 'row',
      orientation: 'horizontal',
      rect: { x: rightX, y: base.y + topH, width: rightW, height: gap }
    }
    return {
      panes: [
        { index: 0, frame: f0, view: insetRect(f0, ring) },
        { index: 1, frame: f1, view: insetRect(f1, ring) },
        { index: 2, frame: f2, view: insetRect(f2, ring) }
      ],
      dividers: [colDivider, rowDivider]
    }
  }

  // 4 panes: 2x2 grid
  const f0: SplitRect = { x: base.x, y: base.y, width: leftW, height: topH }
  const f1: SplitRect = { x: rightX, y: base.y, width: rightW, height: topH }
  const f2: SplitRect = { x: base.x, y: botY, width: leftW, height: botH }
  const f3: SplitRect = { x: rightX, y: botY, width: rightW, height: botH }
  const rowDivider: SplitDividerLayout = {
    kind: 'row',
    orientation: 'horizontal',
    rect: { x: base.x, y: base.y + topH, width: base.width, height: gap }
  }
  return {
    panes: [
      { index: 0, frame: f0, view: insetRect(f0, ring) },
      { index: 1, frame: f1, view: insetRect(f1, ring) },
      { index: 2, frame: f2, view: insetRect(f2, ring) },
      { index: 3, frame: f3, view: insetRect(f3, ring) }
    ],
    dividers: [colDivider, rowDivider]
  }
}

/** Translates a pointer coordinate along a container axis into a clamped split ratio. */
export function ratioFromPointer(pointerPos: number, containerStart: number, containerSize: number, gap = SPLIT_GAP): number {
  const usable = containerSize - gap
  if (!Number.isFinite(pointerPos) || !Number.isFinite(usable) || usable <= 0) return DEFAULT_SPLIT_RATIO
  const rel = (pointerPos - containerStart - gap / 2) / usable
  return clampSplitRatio(rel)
}

/** Finds the split group containing `tabId`, if any. */
export function findSplitGroup(groups: readonly SplitGroup[], tabId: number | null): SplitGroup | undefined {
  if (tabId === null) return undefined
  return groups.find((g) => g.tabIds.includes(tabId))
}

export interface SplitPartnerCandidate {
  id: number
  workspaceId: string
  pinned: boolean
  lastActiveAt: number
}

/**
 * Picks the most recently used other non-pinned tab in the same workspace to partner with
 * when the user drags the active tab onto the page. Skips pinned tabs so pinned tabs are
 * never unexpectedly unpinned; returns null if no suitable partner exists.
 */
export function pickRecentSplitPartner(
  tabs: readonly SplitPartnerCandidate[],
  draggedTabId: number,
  workspaceId: string
): number | null {
  let best: SplitPartnerCandidate | null = null
  for (const t of tabs) {
    if (t.id === draggedTabId || t.workspaceId !== workspaceId || t.pinned) continue
    if (!best || t.lastActiveAt > best.lastActiveAt) {
      best = t
    }
  }
  return best ? best.id : null
}

/**
 * Reorders a workspace's tab IDs so every split group's tabs sit contiguously in group order,
 * anchored at the earliest position of any tab in that group.
 */
export function keepSplitGroupsContiguous<T>(items: readonly T[], idOf: (item: T) => number, groups: readonly SplitGroup[]): T[] {
  if (!groups.length || items.length < 2) return [...items]
  const byId = new Map<number, T>()
  for (const item of items) byId.set(idOf(item), item)

  const groupByTab = new Map<number, SplitGroup>()
  for (const g of groups) {
    for (const id of g.tabIds) groupByTab.set(id, g)
  }

  const emitted = new Set<number>()
  const out: T[] = []
  for (const item of items) {
    const id = idOf(item)
    if (emitted.has(id)) continue
    const group = groupByTab.get(id)
    if (group) {
      for (const gid of group.tabIds) {
        if (emitted.has(gid)) continue
        const member = byId.get(gid)
        if (member) {
          out.push(member)
          emitted.add(gid)
        }
      }
    } else {
      out.push(item)
      emitted.add(id)
    }
  }
  return out
}

/**
 * Splits `anchorTabId` with `otherTabId` (either creating a 2-pane group or adding `otherTabId`
 * into `anchorTabId`'s group up to MAX_SPLIT_PANES). If `otherTabId` was in another split group,
 * it is detached from that group first (dissolving it if fewer than 2 tabs remain).
 */
export function joinSplitGroup(
  groups: readonly SplitGroup[],
  anchorTabId: number,
  otherTabId: number,
  placement: SplitPlacement = 'right',
  newId: () => string = () => `split-${anchorTabId}-${otherTabId}`
): { groups: SplitGroup[]; group: SplitGroup | null } {
  if (anchorTabId === otherTabId) return { groups: groups.map((g) => ({ ...g, tabIds: [...g.tabIds] })), group: null }

  const isFirst = placement === 'left' || placement === 'top'
  const nextOrientation: SplitOrientation = placement === 'top' || placement === 'bottom' ? 'stacked' : 'side-by-side'

  const anchorExisting = groups.find((g) => g.tabIds.includes(anchorTabId))
  // Already in the same split group: reorder and update orientation for 2-pane splits.
  if (anchorExisting && anchorExisting.tabIds.includes(otherTabId)) {
    const next = groups.map((g) => {
      if (g.id !== anchorExisting.id) return { ...g, tabIds: [...g.tabIds] }
      const rest = g.tabIds.filter((id) => id !== otherTabId)
      const tabIds = isFirst ? [otherTabId, ...rest] : [...rest, otherTabId]
      return { ...g, tabIds, ...(tabIds.length === 2 ? { orientation: nextOrientation } : {}) }
    })
    return { groups: next, group: next.find((g) => g.id === anchorExisting.id) ?? null }
  }

  if (anchorExisting && anchorExisting.tabIds.length >= MAX_SPLIT_PANES) {
    return { groups: groups.map((g) => ({ ...g, tabIds: [...g.tabIds] })), group: anchorExisting }
  }

  // Detach otherTabId from any other group it belonged to.
  const cleaned: SplitGroup[] = []
  for (const g of groups) {
    if (g.id === anchorExisting?.id) {
      cleaned.push({ ...g, tabIds: [...g.tabIds] })
      continue
    }
    const remaining = g.tabIds.filter((id) => id !== otherTabId)
    if (remaining.length >= 2) cleaned.push({ ...g, tabIds: remaining })
  }

  if (anchorExisting) {
    const target = cleaned.find((g) => g.id === anchorExisting.id)!
    target.tabIds = isFirst ? [otherTabId, ...target.tabIds] : [...target.tabIds, otherTabId]
    return { groups: cleaned, group: target }
  }

  const created: SplitGroup = {
    id: newId(),
    tabIds: isFirst ? [otherTabId, anchorTabId] : [anchorTabId, otherTabId],
    colRatio: DEFAULT_SPLIT_RATIO,
    rowRatio: DEFAULT_SPLIT_RATIO,
    orientation: nextOrientation
  }
  cleaned.push(created)
  return { groups: cleaned, group: created }
}

/** Toggles a 2-pane split group between side-by-side (left/right) and stacked (top/bottom). */
export function rotateSplitGroup(groups: readonly SplitGroup[], groupId: string): SplitGroup[] {
  return groups.map((g) => {
    if (g.id !== groupId || g.tabIds.length !== 2) return { ...g, tabIds: [...g.tabIds] }
    const next: SplitOrientation = g.orientation === 'stacked' ? 'side-by-side' : 'stacked'
    return { ...g, tabIds: [...g.tabIds], orientation: next }
  })
}

/** Removes one tab from its split group, dissolving the group if fewer than 2 tabs remain. */
export function removeTabFromSplit(groups: readonly SplitGroup[], tabId: number): SplitGroup[] {
  const out: SplitGroup[] = []
  for (const g of groups) {
    const remaining = g.tabIds.filter((id) => id !== tabId)
    if (remaining.length >= 2) out.push({ ...g, tabIds: remaining })
  }
  return out
}

/** Dissolves the split group with `groupId`. */
export function dissolveSplitGroup(groups: readonly SplitGroup[], groupId: string): SplitGroup[] {
  return groups.filter((g) => g.id !== groupId).map((g) => ({ ...g, tabIds: [...g.tabIds] }))
}

/** Updates a split group's column or row ratio (clamped to valid bounds). */
export function updateSplitGroupRatio(
  groups: readonly SplitGroup[],
  groupId: string,
  kind: 'col' | 'row',
  ratio: number
): SplitGroup[] {
  const clamped = clampSplitRatio(ratio)
  return groups.map((g) =>
    g.id === groupId
      ? {
          ...g,
          tabIds: [...g.tabIds],
          colRatio: kind === 'col' ? clamped : g.colRatio,
          rowRatio: kind === 'row' ? clamped : g.rowRatio
        }
      : { ...g, tabIds: [...g.tabIds] }
  )
}
