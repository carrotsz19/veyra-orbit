/*
 * Pure Ctrl+K command palette model, ranking (extending suggest.ts), ID validation,
 * and floating window positioning. Shared between main, renderer, and node:test unit tests.
 *
 * Security rule: the palette window receives display-only PaletteItem objects and sends
 * back only an item ID (or raw typed query text). Main validates every ID against the
 * authoritative action map it produced for the last render, and passes typed text through
 * toUrl() + isAllowedUrl()/isInternalUrl().
 */
import { SEARCH_URL, buildSearchUrl, displayUrl, isAllowedUrl, isInternalUrl, toUrl } from './url.ts'
import { buildEngineSearchUrl, parseKeywordSearch, type SearchEngine } from './search.ts'
import { score, scoreCommand, type Candidate } from './suggest.ts'
import { clampPopupBounds, type BoundsRect } from './menu.ts'
import type { ThemeSource } from './settings.ts'
import { formatShortcutLabel, resolveShortcuts, type ShortcutId, type ShortcutOverrides } from './shortcuts.ts'

export type PaletteMode = 'command' | 'new-tab'

export type PaletteItemKind = 'tab' | 'bookmark' | 'history' | 'command' | 'workspace' | 'setting' | 'url' | 'search'

export type PaletteItemIcon =
  | 'search'
  | 'globe'
  | 'tab'
  | 'bookmark'
  | 'history'
  | 'plus'
  | 'split'
  | 'unsplit'
  | 'compact'
  | 'workspace'
  | 'settings'
  | 'downloads'
  | 'print'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'reload'
  | 'reopen'
  | 'pin'
  | 'mute'
  | 'sleep'
  | 'close'
  | 'trash'
  | 'find'
  | 'code'
  | 'fullscreen'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'star'
  | 'camera'

export type PaletteCommandId =
  | 'new-tab'
  | 'new-workspace'
  | 'toggle-compact'
  | 'split-next'
  | 'unsplit'
  | 'reopen-closed'
  | 'reload'
  | 'hard-reload'
  | 'duplicate-tab'
  | 'pin-tab'
  | 'mute-tab'
  | 'sleep-tab'
  | 'close-tab'
  | 'toggle-bookmark'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'print'
  | 'take-screenshot'
  | 'find'
  | 'toggle-downloads'
  | 'devtools'
  | 'fullscreen'
  | 'open-history'
  | 'open-bookmarks'
  | 'open-settings'
  | 'clear-history-hour'
  | 'clear-history-day'
  | 'theme-light'
  | 'theme-dark'
  | 'theme-system'

/** Display-only row sent to the floating palette window. Never carries raw callbacks or arbitrary actions. */
export interface PaletteItem {
  id: string
  kind: PaletteItemKind
  group: string
  label: string
  sub?: string
  icon: PaletteItemIcon
  keys?: string
  badge?: string
  /** True when Ctrl+Enter can open this item in a new tab. */
  canOpenInNewTab?: boolean
}

/** Authoritative action kept in main's Map<id, PaletteAction> for validation on pick. */
export type PaletteAction =
  | { type: 'switch-tab'; tabId: number }
  | { type: 'navigate'; url: string }
  | { type: 'command'; cmd: PaletteCommandId }
  | { type: 'switch-workspace'; workspaceId: string }
  | { type: 'settings-section'; sectionId: string }

export interface PaletteOpenState {
  mode: PaletteMode
  dark: boolean
  accent: string
  items: PaletteItem[]
}

export interface PaletteResultsPayload {
  query: string
  items: PaletteItem[]
}

export interface PaletteTabInput {
  id: number
  workspaceId: string
  workspaceName: string
  url: string
  title: string
  bookmarked: boolean
  pinned: boolean
  muted: boolean
  active: boolean
}

export interface PaletteWorkspaceInput {
  id: string
  name: string
  active: boolean
}

export interface PaletteContext {
  mode: PaletteMode
  tabs: readonly PaletteTabInput[]
  candidates: readonly Candidate[]
  workspaces: readonly PaletteWorkspaceInput[]
  activeTab: {
    id: number
    url: string
    hasError: boolean
    pinned: boolean
    muted: boolean
    bookmarked: boolean
    zoom: number
  } | null
  isSplit: boolean
  compactMode: boolean
  isFullscreen: boolean
  canReopenClosed: boolean
  theme: ThemeSource
  searchUrl?: string
  searchEngines?: readonly SearchEngine[]
  shortcuts?: ShortcutOverrides
  now?: number
  maxItems?: number
}

interface CommandDef {
  cmd: PaletteCommandId
  label: string
  sub?: string
  keywords: string
  icon: PaletteItemIcon
  keys?: string
  showWhenEmpty?: boolean
  enabled?: boolean
  boost?: number
}

const SETTINGS_SECTIONS: readonly { id: string; label: string; keywords: string }[] = [
  { id: 'set-general', label: 'General & tab behaviour settings', keywords: 'startup pinned new tab position close tab external links confirm window behaviour behavior' },
  { id: 'set-search', label: 'Search engines & shortcuts', keywords: 'search engine bang keyword custom google duckduckgo wikipedia' },
  { id: 'set-appearance', label: 'Appearance settings', keywords: 'theme light dark compact mode window buttons dots' },
  { id: 'set-shortcuts', label: 'Keyboard shortcuts', keywords: 'hotkeys keybindings rebind shortcuts keys' },
  { id: 'set-performance', label: 'Performance & sleeping tabs', keywords: 'memory sleep inactive tabs pinned' },
  { id: 'set-downloads', label: 'Downloads settings', keywords: 'folder save location ask' },
  { id: 'set-privacy', label: 'Privacy & clear browsing data', keywords: 'clear history cookies cache site data delete' },
  { id: 'set-permissions', label: 'Site permissions settings', keywords: 'camera microphone notifications location allow block' },
  { id: 'set-updates', label: 'Updates & about Orbit', keywords: 'version update check release' }
]

function buildCommandDefs(ctx: PaletteContext): CommandDef[] {
  const tab = ctx.activeTab
  const isWeb = !!tab && !!tab.url && !tab.hasError && !isInternalUrl(tab.url)
  const canBookmark = !!tab && /^https?:/.test(tab.url) && !tab.hasError
  const resolved = resolveShortcuts(ctx.shortcuts)
  const k = (id: ShortcutId): string | undefined => formatShortcutLabel(resolved[id])

  return [
    {
      cmd: 'new-tab',
      label: 'New tab',
      keywords: 'open blank start page create tab',
      icon: 'plus',
      keys: k('new-tab'),
      showWhenEmpty: true,
      boost: 6
    },
    {
      cmd: ctx.isSplit ? 'unsplit' : 'split-next',
      label: ctx.isSplit ? 'Unsplit view' : 'Split view with next tab',
      keywords: 'split pane side by side tile unsplit',
      icon: ctx.isSplit ? 'unsplit' : 'split',
      keys: k('split-view'),
      showWhenEmpty: true,
      enabled: !!tab,
      boost: 6
    },
    {
      cmd: 'toggle-compact',
      label: ctx.compactMode ? 'Turn off compact mode' : 'Turn on compact mode',
      keywords: 'compact mode hide sidebar toolbar zen focus',
      icon: 'compact',
      keys: k('compact-mode'),
      showWhenEmpty: true,
      boost: 5
    },
    {
      cmd: 'new-workspace',
      label: 'New workspace',
      keywords: 'create space subject profile container',
      icon: 'workspace',
      showWhenEmpty: true,
      boost: 4
    },
    {
      cmd: 'open-settings',
      label: 'Open Settings',
      keywords: 'preferences options config orbit://settings',
      icon: 'settings',
      keys: k('settings'),
      showWhenEmpty: true,
      boost: 4
    },
    {
      cmd: 'open-history',
      label: 'Open History',
      keywords: 'recent pages visited orbit://history',
      icon: 'history',
      keys: k('history'),
      showWhenEmpty: true
    },
    {
      cmd: 'open-bookmarks',
      label: 'Open Bookmarks',
      keywords: 'saved favorites stars orbit://bookmarks',
      icon: 'bookmark',
      keys: k('bookmarks'),
      showWhenEmpty: true
    },
    {
      cmd: 'toggle-downloads',
      label: 'Toggle Downloads',
      keywords: 'files saved downloads panel',
      icon: 'downloads',
      keys: k('downloads'),
      showWhenEmpty: true
    },
    {
      cmd: 'take-screenshot',
      label: 'Take screenshot',
      keywords: 'screenshot capture snap photo screen full page area png',
      icon: 'camera',
      keys: k('screenshot'),
      enabled: !!tab
    },
    {
      cmd: 'reopen-closed',
      label: 'Reopen closed tab',
      keywords: 'undo close restore tab',
      icon: 'reopen',
      keys: k('reopen-closed-tab'),
      enabled: ctx.canReopenClosed,
      showWhenEmpty: ctx.canReopenClosed
    },
    {
      cmd: 'toggle-bookmark',
      label: tab?.bookmarked ? 'Remove bookmark' : 'Bookmark this page',
      keywords: 'star save favorite bookmark',
      icon: 'star',
      keys: k('bookmark-toggle'),
      enabled: canBookmark
    },
    {
      cmd: 'reload',
      label: 'Reload page',
      keywords: 'refresh tab',
      icon: 'reload',
      keys: k('reload'),
      enabled: isWeb
    },
    {
      cmd: 'hard-reload',
      label: 'Hard reload (ignore cache)',
      keywords: 'force refresh cache clear reload',
      icon: 'reload',
      keys: k('hard-reload'),
      enabled: isWeb
    },
    {
      cmd: 'duplicate-tab',
      label: 'Duplicate tab',
      keywords: 'clone copy tab',
      icon: 'tab',
      enabled: !!tab?.url
    },
    {
      cmd: 'pin-tab',
      label: tab?.pinned ? 'Unpin tab' : 'Pin tab',
      keywords: 'stick pin unpin tab',
      icon: 'pin',
      enabled: !!tab
    },
    {
      cmd: 'mute-tab',
      label: tab?.muted ? 'Unmute tab' : 'Mute tab',
      keywords: 'audio sound silence mute unmute',
      icon: 'mute',
      enabled: !!tab
    },
    {
      cmd: 'close-tab',
      label: 'Close tab',
      keywords: 'close current tab',
      icon: 'close',
      keys: k('close-tab'),
      enabled: !!tab
    },
    {
      cmd: 'find',
      label: 'Find in page',
      keywords: 'search text page',
      icon: 'find',
      keys: k('find'),
      enabled: isWeb
    },
    {
      cmd: 'print',
      label: 'Print page',
      keywords: 'pdf print document',
      icon: 'print',
      keys: k('print'),
      enabled: isWeb
    },
    {
      cmd: 'zoom-in',
      label: 'Zoom in',
      keywords: 'magnify larger text scale',
      icon: 'zoom-in',
      keys: k('zoom-in'),
      enabled: isWeb
    },
    {
      cmd: 'zoom-out',
      label: 'Zoom out',
      keywords: 'smaller text scale',
      icon: 'zoom-out',
      keys: k('zoom-out'),
      enabled: isWeb
    },
    {
      cmd: 'zoom-reset',
      label: 'Reset zoom',
      keywords: 'zoom 100 default normal scale',
      icon: 'zoom-reset',
      keys: k('zoom-reset'),
      enabled: isWeb && (tab?.zoom ?? 100) !== 100
    },
    {
      cmd: 'devtools',
      label: 'Toggle Developer Tools',
      keywords: 'inspect console elements debugger devtools',
      icon: 'code',
      keys: k('devtools'),
      enabled: isWeb
    },
    {
      cmd: 'fullscreen',
      label: ctx.isFullscreen ? 'Exit full screen' : 'Enter full screen',
      keywords: 'fullscreen maximize window',
      icon: 'fullscreen',
      keys: k('fullscreen')
    },
    {
      cmd: 'clear-history-hour',
      label: 'Clear history (last hour)',
      keywords: 'delete erase recent browsing history privacy',
      icon: 'trash'
    },
    {
      cmd: 'clear-history-day',
      label: 'Clear history (last 24 hours)',
      keywords: 'delete erase today browsing history privacy',
      icon: 'trash'
    },
    {
      cmd: 'theme-dark',
      label: 'Switch to dark theme',
      keywords: 'appearance dark night mode',
      icon: 'moon',
      enabled: ctx.theme !== 'dark'
    },
    {
      cmd: 'theme-light',
      label: 'Switch to light theme',
      keywords: 'appearance light day mode',
      icon: 'sun',
      enabled: ctx.theme !== 'light'
    },
    {
      cmd: 'theme-system',
      label: 'Match system theme',
      keywords: 'appearance auto system theme',
      icon: 'monitor',
      enabled: ctx.theme !== 'system'
    }
  ]
}

interface ScoredRow {
  item: PaletteItem
  action: PaletteAction
  score: number
}

/**
 * Ranks open tabs (all workspaces), bookmarks, history, Orbit commands, workspaces,
 * settings sections, and direct URL / web search actions for the Ctrl+K command palette.
 */
export function buildPaletteResults(
  rawInput: string,
  ctx: PaletteContext
): { items: PaletteItem[]; actions: Map<string, PaletteAction> } {
  const input = rawInput.trim()
  const searchUrl = ctx.searchUrl ?? SEARCH_URL
  const now = ctx.now ?? Date.now()
  const maxItems = Math.max(4, Math.min(20, ctx.maxItems ?? 12))
  const actions = new Map<string, PaletteAction>()
  const out: PaletteItem[] = []

  const add = (item: PaletteItem, action: PaletteAction): void => {
    if (actions.has(item.id)) return
    actions.set(item.id, action)
    out.push(item)
  }

  const commands = buildCommandDefs(ctx).filter((c) => c.enabled !== false)
  const multiWs = ctx.workspaces.length > 1

  if (!input) {
    // Empty query: show immediately useful tabs / bookmarks / quick commands.
    if (ctx.mode === 'new-tab') {
      const seenUrls = new Set<string>()
      const topCands = [...ctx.candidates]
        .filter((c) => isAllowedUrl(c.url))
        .sort((a, b) => (b.bookmarked ? 1 : 0) - (a.bookmarked ? 1 : 0) || b.last - a.last)
      for (const c of topCands) {
        if (out.length >= 5) break
        if (seenUrls.has(c.url)) continue
        seenUrls.add(c.url)
        add(
          {
            id: `${c.bookmarked ? 'bm' : 'hist'}:${out.length}`,
            kind: c.bookmarked ? 'bookmark' : 'history',
            group: c.bookmarked ? 'Bookmarks' : 'Recent',
            label: c.title || displayUrl(c.url),
            sub: displayUrl(c.url),
            icon: c.bookmarked ? 'bookmark' : 'history',
            canOpenInNewTab: true
          },
          { type: 'navigate', url: c.url }
        )
      }
    }

    const otherTabs = ctx.tabs.filter((t) => !t.active && (t.url || t.title)).slice(0, ctx.mode === 'new-tab' ? 3 : 4)
    for (const t of otherTabs) {
      add(
        {
          id: `tab:${t.id}`,
          kind: 'tab',
          group: 'Open tabs',
          label: t.title || displayUrl(t.url) || 'New tab',
          sub: t.url ? displayUrl(t.url) : undefined,
          icon: 'tab',
          badge: multiWs ? t.workspaceName : 'Switch'
        },
        { type: 'switch-tab', tabId: t.id }
      )
    }

    for (const c of commands.filter((d) => d.showWhenEmpty)) {
      if (out.length >= maxItems) break
      add(
        {
          id: `cmd:${c.cmd}`,
          kind: 'command',
          group: 'Commands',
          label: c.label,
          sub: c.sub,
          icon: c.icon,
          keys: c.keys
        },
        { type: 'command', cmd: c.cmd }
      )
    }

    return { items: out.slice(0, maxItems), actions }
  }

  // Non-empty query: score everything with suggest.ts scoring.
  const kwMatch = ctx.searchEngines?.length ? parseKeywordSearch(rawInput, ctx.searchEngines) : null
  const target = toUrl(rawInput, searchUrl, ctx.searchEngines)
  const defaultSearchUrl = buildSearchUrl(input, searchUrl)
  const isDirectUrl = !kwMatch?.query && !!target && target !== defaultSearchUrl && (isAllowedUrl(target) || isInternalUrl(target))

  const scored: ScoredRow[] = []
  const seenUrls = new Set<string>()

  // 1. Open tabs across all workspaces
  for (const t of ctx.tabs) {
    if (!t.url && !t.title) continue
    const cand: Candidate = {
      url: t.url || 'about:blank',
      title: t.title || displayUrl(t.url) || 'New tab',
      visits: 0,
      typed: 0,
      last: now,
      bookmarked: t.bookmarked,
      tabId: t.id
    }
    let s = score(cand, input, now)
    if (s === 0 && multiWs) {
      const wsScore = scoreCommand(`${t.title} ${t.workspaceName}`, t.url, input)
      if (wsScore > 0) s = wsScore * 0.7
    }
    if (s <= 0) continue
    if (t.url) seenUrls.add(t.url)
    scored.push({
      score: s + (t.active ? -4 : 6),
      item: {
        id: `tab:${t.id}`,
        kind: 'tab',
        group: 'Open tabs',
        label: t.title || displayUrl(t.url) || 'New tab',
        sub: t.url ? displayUrl(t.url) : undefined,
        icon: 'tab',
        badge: multiWs ? t.workspaceName : 'Switch to tab'
      },
      action: { type: 'switch-tab', tabId: t.id }
    })
  }

  // 2. Orbit commands
  for (const c of commands) {
    const s = scoreCommand(c.label, c.keywords, input, c.boost ?? 0)
    if (s <= 0) continue
    scored.push({
      score: s,
      item: {
        id: `cmd:${c.cmd}`,
        kind: 'command',
        group: 'Commands',
        label: c.label,
        sub: c.sub,
        icon: c.icon,
        keys: c.keys
      },
      action: { type: 'command', cmd: c.cmd }
    })
  }

  // 3. Workspaces
  ctx.workspaces.forEach((ws, idx) => {
    const s = scoreCommand(`Switch to ${ws.name}`, `workspace space ${ws.name}`, input, ws.active ? -6 : 4)
    if (s <= 0) return
    scored.push({
      score: s,
      item: {
        id: `ws:${ws.id}`,
        kind: 'workspace',
        group: 'Workspaces',
        label: `Switch workspace: ${ws.name}`,
        icon: 'workspace',
        keys: idx < 9 ? `Ctrl+Alt+${idx + 1}` : undefined,
        badge: ws.active ? 'Current' : undefined
      },
      action: { type: 'switch-workspace', workspaceId: ws.id }
    })
  })

  // 4. Settings sections
  for (const sec of SETTINGS_SECTIONS) {
    const s = scoreCommand(sec.label, sec.keywords, input, -2)
    if (s <= 0) continue
    scored.push({
      score: s,
      item: {
        id: `setting:${sec.id}`,
        kind: 'setting',
        group: 'Settings',
        label: sec.label,
        icon: 'settings'
      },
      action: { type: 'settings-section', sectionId: sec.id }
    })
  }

  // 5. Bookmarks and history candidates
  const byUrl = new Map<string, Candidate>()
  for (const c of ctx.candidates) {
    if (!isAllowedUrl(c.url) || seenUrls.has(c.url)) continue
    const had = byUrl.get(c.url)
    byUrl.set(
      c.url,
      had
        ? {
            url: c.url,
            title: had.title || c.title,
            visits: Math.max(had.visits, c.visits),
            typed: Math.max(had.typed, c.typed),
            last: Math.max(had.last, c.last),
            bookmarked: had.bookmarked || c.bookmarked
          }
        : c
    )
  }
  let pageIdx = 0
  for (const c of byUrl.values()) {
    const s = score(c, input, now)
    if (s <= 0) continue
    scored.push({
      score: s,
      item: {
        id: `${c.bookmarked ? 'bm' : 'hist'}:${pageIdx++}`,
        kind: c.bookmarked ? 'bookmark' : 'history',
        group: c.bookmarked ? 'Bookmarks' : 'History',
        label: c.title || displayUrl(c.url),
        sub: displayUrl(c.url),
        icon: c.bookmarked ? 'bookmark' : 'history',
        canOpenInNewTab: true
      },
      action: { type: 'navigate', url: c.url }
    })
  }

  scored.sort((a, b) => b.score - a.score)

  const searchActionUrl =
    kwMatch && kwMatch.query ? buildEngineSearchUrl(kwMatch.query, kwMatch.engine) : buildSearchUrl(input, searchUrl)
  const searchRow: ScoredRow = {
    score: 0,
    item: {
      id: 'search:web',
      kind: 'search',
      group: 'Web',
      label:
        kwMatch && kwMatch.query
          ? `Search ${kwMatch.engine.name} for “${kwMatch.query}”`
          : `Search the web for “${input}”`,
      icon: 'search',
      badge: kwMatch && kwMatch.query ? kwMatch.engine.name : ctx.mode === 'new-tab' ? 'New tab' : 'Search',
      canOpenInNewTab: true
    },
    action: { type: 'navigate', url: searchActionUrl }
  }

  const urlRow: ScoredRow | null =
    isDirectUrl && target
      ? {
          score: 1000,
          item: {
            id: 'url:direct',
            kind: 'url',
            group: 'Go to',
            label: `Go to ${displayUrl(target)}`,
            sub: target,
            icon: 'globe',
            badge: ctx.mode === 'new-tab' ? 'New tab' : 'Open',
            canOpenInNewTab: true
          },
          action: { type: 'navigate', url: target }
        }
      : null

  if (urlRow) {
    add(urlRow.item, urlRow.action)
    for (const row of scored) {
      if (out.length >= maxItems - 1) break
      if (row.action.type === 'navigate' && row.action.url === target) continue
      add(row.item, row.action)
    }
    add(searchRow.item, searchRow.action)
  } else {
    const topScore = scored[0]?.score ?? 0
    const strongHit = topScore >= 26
    if (!strongHit) add(searchRow.item, searchRow.action)
    for (const row of scored) {
      if (out.length >= (strongHit ? maxItems - 1 : maxItems)) break
      add(row.item, row.action)
    }
    if (strongHit) add(searchRow.item, searchRow.action)
  }

  return { items: out.slice(0, maxItems), actions }
}

/**
 * Validates an item ID returned by the floating palette window against the exact
 * authoritative action map that main produced for the current list.
 */
export function validatePalettePick(actions: ReadonlyMap<string, PaletteAction>, id: unknown): PaletteAction | null {
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) return null
  return actions.get(id) ?? null
}

/**
 * Validates raw typed text submitted from the palette window, ensuring it passes
 * through toUrl() and isAllowedUrl()/isInternalUrl() (never file:/javascript:/data:).
 */
export function resolveTypedPaletteText(
  text: unknown,
  searchUrl = SEARCH_URL,
  searchEngines?: readonly SearchEngine[]
): string | null {
  if (typeof text !== 'string' || text.length > 4096) return null
  const url = toUrl(text, searchUrl, searchEngines)
  if (!url) return null
  return isAllowedUrl(url) || isInternalUrl(url) ? url : null
}

/** Computes centred top-anchored bounds for the floating Ctrl+K command palette. */
export function computePaletteBounds(
  parentContent: BoundsRect,
  workArea: BoundsRect,
  contentHeight: number,
  zoom = 1
): BoundsRect {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const widthCss = Math.min(620, Math.max(360, Math.round(parentContent.width / z) - 48))
  const heightCss = Math.min(520, Math.max(58, Math.ceil(contentHeight)))
  const width = Math.round(widthCss * z)
  const height = Math.round(heightCss * z)
  const x = Math.round(parentContent.x + (parentContent.width - width) / 2)
  const y = Math.round(parentContent.y + Math.min(72 * z, Math.max(44 * z, parentContent.height * 0.1)))
  return clampPopupBounds({ x, y }, { width, height }, workArea, 8)
}
