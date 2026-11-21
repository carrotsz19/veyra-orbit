/*
 * Workspaces model, accents, partition resolution and session migration.
 * Pure, so it can be shared between main, renderer and unit tests.
 */
import { isAllowedUrl, isInternalUrl } from './url.ts'

export const DEFAULT_WEB_PARTITION = 'persist:web'
export const PRIVATE_WORKSPACE_ICON = 'eye-off'

export const WORKSPACE_ACCENTS = [
  { id: 'clay', name: 'Clay', light: '#b3492b', dark: '#d9633e' },
  { id: 'sage', name: 'Sage', light: '#3f6b4a', dark: '#7fae87' },
  { id: 'sky', name: 'Sky', light: '#2e648f', dark: '#6da8d6' },
  { id: 'plum', name: 'Plum', light: '#78497a', dark: '#b884bb' },
  { id: 'sand', name: 'Sand', light: '#9a6a12', dark: '#d8a54a' },
  { id: 'slate', name: 'Slate', light: '#4f5d6b', dark: '#8fa1b3' }
] as const

export type WorkspaceAccentId = (typeof WORKSPACE_ACCENTS)[number]['id']

export const WORKSPACE_ICONS = [
  'home',
  'book-open',
  'graduation-cap',
  'briefcase',
  'code',
  'flask-conical',
  'compass',
  'sparkles',
  'music',
  'star'
] as const

export type WorkspaceIconId = (typeof WORKSPACE_ICONS)[number]

export interface WorkspaceInfo {
  id: string
  name: string
  /** Either a built-in Lucide icon id (WORKSPACE_ICONS), 'eye-off' for private workspaces, or a short emoji string. */
  icon: string
  accent: WorkspaceAccentId
  /** When true, tabs in this workspace use persist:ws-<id> instead of the shared web session. */
  isolated: boolean
  /** When true, this workspace uses a non-persistent in-memory partition and records no history or session restore. */
  private?: boolean
}

export interface WorkspaceCreateInput {
  name: string
  icon?: string
  accent?: WorkspaceAccentId
  isolated?: boolean
}

export interface WorkspaceUpdateInput {
  name?: string
  icon?: string
  accent?: WorkspaceAccentId
  isolated?: boolean
}

export interface SavedTab {
  url: string
  title: string
  pinned: boolean
}

export interface SavedWorkspace extends WorkspaceInfo {
  tabs: SavedTab[]
  active: number
}

export interface SavedSession {
  version: 2
  activeWorkspaceId: string
  workspaces: SavedWorkspace[]
}

const ACCENT_SET = new Set<string>(WORKSPACE_ACCENTS.map((a) => a.id))
const ICON_SET = new Set<string>(WORKSPACE_ICONS)
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

export function isWorkspaceAccent(v: unknown): v is WorkspaceAccentId {
  return typeof v === 'string' && ACCENT_SET.has(v)
}

export function isBuiltInWorkspaceIcon(v: string): v is WorkspaceIconId {
  return ICON_SET.has(v)
}

export function sanitizeWorkspaceId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const clean = v.trim().toLowerCase()
  return ID_RE.test(clean) ? clean : null
}

export function sanitizeWorkspaceName(v: unknown, fallback = 'Workspace'): string {
  if (typeof v !== 'string') return fallback
  const clean = v.replace(/[\r\n\t\0]+/g, ' ').trim().slice(0, 40)
  return clean || fallback
}

export function sanitizeWorkspaceIcon(v: unknown, fallback: string = 'compass'): string {
  if (typeof v !== 'string') return fallback
  const clean = v.replace(/[\r\n\t\0]+/g, '').trim()
  if (!clean) return fallback
  if (ICON_SET.has(clean)) return clean
  // Allow short emoji / symbol strings (up to 4 grapheme-like code points / 16 UTF-16 units) without ASCII letters/digits
  // that look like unknown icon ids.
  const chars = [...clean]
  if (chars.length >= 1 && chars.length <= 6 && clean.length <= 16 && !/^[a-zA-Z0-9_-]+$/.test(clean)) {
    return clean
  }
  return fallback
}

export function createDefaultWorkspace(): WorkspaceInfo {
  return {
    id: 'personal',
    name: 'Personal',
    icon: 'home',
    accent: 'clay',
    isolated: false
  }
}

/** Returns the Electron session partition string for a workspace. */
export function workspacePartition(ws: Pick<WorkspaceInfo, 'id' | 'isolated' | 'private'>): string {
  if (ws.private) {
    const id = sanitizeWorkspaceId(ws.id) ?? `priv-${Date.now().toString(36)}`
    return `private-ws-${id}`
  }
  if (!ws.isolated) return DEFAULT_WEB_PARTITION
  const id = sanitizeWorkspaceId(ws.id)
  return id ? `persist:ws-${id}` : DEFAULT_WEB_PARTITION
}

export function isPrivatePartition(partition: string): boolean {
  return partition.startsWith('private-ws-') && !partition.startsWith('persist:')
}

/** Creates a new ephemeral private workspace with a unique id and non-persistent partition. */
export function createPrivateWorkspaceEntry(
  existing: readonly WorkspaceInfo[],
  uniqueToken?: string
): { workspaces: WorkspaceInfo[]; created: WorkspaceInfo } {
  const usedIds = new Set(existing.map((w) => w.id))
  const existingPrivateCount = existing.filter((w) => w.private).length
  const name = existingPrivateCount === 0 ? 'Private' : `Private ${existingPrivateCount + 1}`

  const rawToken =
    (uniqueToken ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '')
      .slice(0, 24) || '1'
  let id = `private-${rawToken}`
  for (let n = 2; usedIds.has(id); n++) {
    id = `private-${rawToken.slice(0, 18)}-${n}`
  }

  const created: WorkspaceInfo = {
    id,
    name,
    icon: PRIVATE_WORKSPACE_ICON,
    accent: 'slate',
    isolated: true,
    private: true
  }
  return { workspaces: [...existing, created], created }
}

function slugifyId(name: string, existing: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'space'
  if (!existing.has(base)) return base
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${base}-${n}`
    if (!existing.has(candidate)) return candidate
  }
  return `space-${Date.now().toString(36)}`
}

export function createWorkspaceEntry(
  existing: readonly WorkspaceInfo[],
  input: WorkspaceCreateInput
): { workspaces: WorkspaceInfo[]; created: WorkspaceInfo } {
  const usedIds = new Set(existing.map((w) => w.id))
  const name = sanitizeWorkspaceName(input.name, `Space ${existing.length + 1}`)
  const created: WorkspaceInfo = {
    id: slugifyId(name, usedIds),
    name,
    icon: sanitizeWorkspaceIcon(input.icon, 'compass'),
    accent: isWorkspaceAccent(input.accent) ? input.accent : WORKSPACE_ACCENTS[existing.length % WORKSPACE_ACCENTS.length].id,
    isolated: input.isolated === true
  }
  return { workspaces: [...existing, created], created }
}

export function updateWorkspaceEntry(
  existing: readonly WorkspaceInfo[],
  id: string,
  patch: WorkspaceUpdateInput
): { workspaces: WorkspaceInfo[]; updated: WorkspaceInfo | null; isolationChanged: boolean } {
  const idx = existing.findIndex((w) => w.id === id)
  if (idx < 0) return { workspaces: [...existing], updated: null, isolationChanged: false }
  const cur = existing[idx]
  if (cur.private) {
    return { workspaces: [...existing], updated: cur, isolationChanged: false }
  }
  const next: WorkspaceInfo = {
    ...cur,
    name: patch.name !== undefined ? sanitizeWorkspaceName(patch.name, cur.name) : cur.name,
    icon: patch.icon !== undefined ? sanitizeWorkspaceIcon(patch.icon, cur.icon) : cur.icon,
    accent: patch.accent !== undefined && isWorkspaceAccent(patch.accent) ? patch.accent : cur.accent,
    isolated: typeof patch.isolated === 'boolean' ? patch.isolated : cur.isolated
  }
  const workspaces = existing.map((w, i) => (i === idx ? next : w))
  return { workspaces, updated: next, isolationChanged: next.isolated !== cur.isolated }
}

export function deleteWorkspaceEntry(
  existing: readonly WorkspaceInfo[],
  id: string,
  activeId: string
): { workspaces: WorkspaceInfo[]; deleted: boolean; nextActiveId: string } {
  if (existing.length <= 1) return { workspaces: [...existing], deleted: false, nextActiveId: activeId }
  const idx = existing.findIndex((w) => w.id === id)
  if (idx < 0) return { workspaces: [...existing], deleted: false, nextActiveId: activeId }
  const target = existing[idx]
  // Never allow deleting the last non-private workspace while only private workspaces remain.
  if (!target.private && existing.filter((w) => !w.private).length <= 1) {
    return { workspaces: [...existing], deleted: false, nextActiveId: activeId }
  }
  const workspaces = existing.filter((w) => w.id !== id)
  let nextActiveId = activeId
  if (activeId === id || !workspaces.some((w) => w.id === activeId)) {
    const fallback = workspaces[Math.min(idx, workspaces.length - 1)] ?? workspaces[0]
    nextActiveId = fallback.id
  }
  return { workspaces, deleted: true, nextActiveId }
}

export function nextWorkspaceId(workspaces: readonly WorkspaceInfo[], activeId: string, dir: -1 | 1): string | null {
  if (workspaces.length <= 1) return null
  const idx = workspaces.findIndex((w) => w.id === activeId)
  if (idx < 0) return workspaces[0].id
  return workspaces[(idx + dir + workspaces.length) % workspaces.length].id
}

export function workspaceAtShortcut(workspaces: readonly WorkspaceInfo[], digit: number): WorkspaceInfo | null {
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return null
  return workspaces[digit - 1] ?? null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function sanitizeSavedTabs(raw: unknown): SavedTab[] {
  if (!Array.isArray(raw)) return []
  const out: SavedTab[] = []
  for (const item of raw) {
    if (!isPlainObject(item)) continue
    const url = typeof item.url === 'string' ? item.url : ''
    if (!url || (!isAllowedUrl(url) && !isInternalUrl(url))) continue
    out.push({
      url,
      title: typeof item.title === 'string' ? item.title.slice(0, 512) : '',
      pinned: item.pinned === true
    })
  }
  return out
}

function clampActive(raw: unknown, count: number): number {
  if (count <= 0) return 0
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0
  return Math.max(0, Math.min(n, count - 1))
}

/**
 * Parses session.json (V2 with workspaces, or legacy V1 flat tab list) into a safe SavedSession.
 * Legacy V1 sessions migrate cleanly into a single default "Personal" workspace.
 */
export function parseSavedSession(raw: unknown): SavedSession {
  const def = createDefaultWorkspace()
  if (!isPlainObject(raw)) {
    return { version: 2, activeWorkspaceId: def.id, workspaces: [{ ...def, tabs: [], active: 0 }] }
  }

  // V2 workspace-aware session
  if (raw.version === 2 && Array.isArray(raw.workspaces)) {
    const usedIds = new Set<string>()
    const workspaces: SavedWorkspace[] = []
    for (const entry of raw.workspaces) {
      if (!isPlainObject(entry)) continue
      if (entry.private === true) continue
      const name = sanitizeWorkspaceName(entry.name, `Space ${workspaces.length + 1}`)
      const rawId = sanitizeWorkspaceId(entry.id)
      const id = rawId && !usedIds.has(rawId) ? rawId : slugifyId(name, usedIds)
      usedIds.add(id)
      const tabs = sanitizeSavedTabs(entry.tabs)
      workspaces.push({
        id,
        name,
        icon: sanitizeWorkspaceIcon(entry.icon, workspaces.length === 0 ? 'home' : 'compass'),
        accent: isWorkspaceAccent(entry.accent) ? entry.accent : WORKSPACE_ACCENTS[workspaces.length % WORKSPACE_ACCENTS.length].id,
        isolated: entry.isolated === true,
        tabs,
        active: clampActive(entry.active, tabs.length)
      })
    }
    if (!workspaces.length) {
      return { version: 2, activeWorkspaceId: def.id, workspaces: [{ ...def, tabs: [], active: 0 }] }
    }
    const requestedActive = typeof raw.activeWorkspaceId === 'string' ? raw.activeWorkspaceId : ''
    const activeWorkspaceId = workspaces.some((w) => w.id === requestedActive) ? requestedActive : workspaces[0].id
    return { version: 2, activeWorkspaceId, workspaces }
  }

  // Legacy V1 flat session: { tabs: [...], active: number }
  const legacyTabs = sanitizeSavedTabs(raw.tabs)
  return {
    version: 2,
    activeWorkspaceId: def.id,
    workspaces: [
      {
        ...def,
        tabs: legacyTabs,
        active: clampActive(raw.active, legacyTabs.length)
      }
    ]
  }
}

/**
 * Serializes workspaces and tabs for session.json, excluding every private workspace and its tabs.
 * If the active workspace is private, activeWorkspaceId falls back to the first saved workspace.
 */
export function buildSavedSession(
  workspaces: readonly WorkspaceInfo[],
  activeWorkspaceId: string,
  getTabs: (wsId: string) => { tabs: SavedTab[]; active: number }
): SavedSession {
  const persistent = workspaces.filter((ws) => !ws.private)
  const list = persistent.length > 0 ? persistent : [createDefaultWorkspace()]
  const savedActiveId = list.some((ws) => ws.id === activeWorkspaceId) ? activeWorkspaceId : list[0].id
  return {
    version: 2,
    activeWorkspaceId: savedActiveId,
    workspaces: list.map((ws) => {
      const { tabs, active } = getTabs(ws.id)
      return {
        id: ws.id,
        name: ws.name,
        icon: ws.icon,
        accent: ws.accent,
        isolated: ws.isolated,
        tabs,
        active: clampActive(active, tabs.length)
      }
    })
  }
}
