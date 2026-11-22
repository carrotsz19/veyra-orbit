/*
 * Memory usage snapshot types and pure process-to-bucket aggregation.
 * Exposes only the numbers and tab labels shown in Settings -> Performance (no raw PIDs or system paths).
 */

export interface MemoryTabItem {
  id: number
  title: string
  /** Approximate memory in MB (rounded to 1 decimal), or null when sleeping/unloaded. */
  memoryMB: number | null
  sleeping: boolean
  canSleep: boolean
}

export interface MemoryUsageSnapshot {
  totalMB: number
  uiMB: number
  extensionsMB: number
  extensionCount: number
  tabs: MemoryTabItem[]
}

export interface ProcessMetricInput {
  pid: number
  workingSetKB: number
  privateKB?: number
}

export interface TabMetricInput {
  id: number
  title: string
  pid: number | null
  sleeping: boolean
  canSleep: boolean
}

function roundMb(kb: number): number {
  if (!Number.isFinite(kb) || kb <= 0) return 0
  return Math.round((kb / 1024) * 10) / 10
}

function processKb(p: ProcessMetricInput): number {
  if (Number.isFinite(p.workingSetKB) && p.workingSetKB > 0) return p.workingSetKB
  if (p.privateKB !== undefined && Number.isFinite(p.privateKB) && p.privateKB > 0) return p.privateKB
  return 0
}

/**
 * Attributes Electron's app.getAppMetrics() across Total, Orbit UI, Tabs, and Extensions.
 * - Multiple live tabs sharing one Chromium renderer PID split that PID's memory evenly.
 * - Extension PIDs are attributed to Extensions (never double-counted with tabs).
 * - All remaining processes (browser main, UI renderers, GPU, network/storage utilities) count as Orbit UI.
 */
export function computeMemorySnapshot(
  metrics: ProcessMetricInput[],
  tabInputs: TabMetricInput[],
  extensionPids: Iterable<number>,
  extensionCount: number
): MemoryUsageSnapshot {
  const kbByPid = new Map<number, number>()
  let totalKB = 0
  for (const m of metrics) {
    const kb = processKb(m)
    kbByPid.set(m.pid, (kbByPid.get(m.pid) ?? 0) + kb)
    totalKB += kb
  }

  // Count how many live tabs share each renderer PID.
  const tabCountByPid = new Map<number, number>()
  for (const t of tabInputs) {
    if (!t.sleeping && t.pid !== null && kbByPid.has(t.pid)) {
      tabCountByPid.set(t.pid, (tabCountByPid.get(t.pid) ?? 0) + 1)
    }
  }

  const attributedTabPids = new Set<number>()
  const tabs: MemoryTabItem[] = tabInputs.map((t) => {
    if (t.sleeping || t.pid === null) {
      return { id: t.id, title: t.title, memoryMB: null, sleeping: t.sleeping, canSleep: t.canSleep }
    }
    const pidKb = kbByPid.get(t.pid)
    const shareCount = tabCountByPid.get(t.pid) ?? 0
    if (pidKb === undefined || shareCount <= 0) {
      return { id: t.id, title: t.title, memoryMB: null, sleeping: false, canSleep: t.canSleep }
    }
    attributedTabPids.add(t.pid)
    return {
      id: t.id,
      title: t.title,
      memoryMB: roundMb(pidKb / shareCount),
      sleeping: false,
      canSleep: t.canSleep
    }
  })

  // Sort live tabs by memory descending, then unloaded/sleeping tabs at the bottom.
  tabs.sort((a, b) => {
    if (a.sleeping !== b.sleeping) return a.sleeping ? 1 : -1
    const ma = a.memoryMB ?? -1
    const mb = b.memoryMB ?? -1
    if (ma !== mb) return mb - ma
    return a.id - b.id
  })

  const attributedExtPids = new Set<number>()
  let extensionsKB = 0
  for (const pid of extensionPids) {
    if (attributedTabPids.has(pid) || attributedExtPids.has(pid)) continue
    const kb = kbByPid.get(pid)
    if (kb !== undefined) {
      attributedExtPids.add(pid)
      extensionsKB += kb
    }
  }

  let uiKB = 0
  for (const [pid, kb] of kbByPid) {
    if (!attributedTabPids.has(pid) && !attributedExtPids.has(pid)) {
      uiKB += kb
    }
  }

  return {
    totalMB: roundMb(totalKB),
    uiMB: roundMb(uiKB),
    extensionsMB: roundMb(extensionsKB),
    extensionCount: Math.max(0, Math.trunc(extensionCount)),
    tabs
  }
}
