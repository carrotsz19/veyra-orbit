import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bookmark,
  BookOpen,
  Briefcase,
  ChevronDown,
  Clock,
  Code,
  Compass,
  Download,
  EyeOff,
  FlaskConical,
  Globe,
  GraduationCap,
  Home,
  LoaderCircle,
  Music,
  Plus,
  Settings,
  Sparkles,
  Star,
  Ungroup,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type {
  BrowserState,
  DownloadInfo,
  MenuEntry,
  SettingsView,
  SplitGroup,
  TabInfo,
  WorkspaceIconId,
  WorkspaceInfo
} from '@shared/types'
import { isBuiltInWorkspaceIcon } from '@shared/workspaces'
import { displayUrl } from '@shared/url'
import { formatShortcutLabel, resolveShortcuts } from '@shared/shortcuts'
import { DownloadTriggerButton } from './Downloads'

const api = window.veyra

const ICON_COMPONENTS: Record<WorkspaceIconId, typeof Home> = {
  home: Home,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  briefcase: Briefcase,
  code: Code,
  'flask-conical': FlaskConical,
  compass: Compass,
  sparkles: Sparkles,
  music: Music,
  star: Star
}

function WsIcon({ icon, size = 13 }: { icon: string; size?: number }): React.JSX.Element {
  if (icon === 'eye-off') return <EyeOff size={size} strokeWidth={1.85} aria-hidden />
  if (isBuiltInWorkspaceIcon(icon)) {
    const Icon = ICON_COMPONENTS[icon]
    return <Icon size={size} strokeWidth={1.85} aria-hidden />
  }
  return (
    <span className="ws-emoji" aria-hidden>
      {icon}
    </span>
  )
}

function tabLabel(t: TabInfo): string {
  return t.title || displayUrl(t.url) || 'New tab'
}

function tabTooltip(t: TabInfo): string {
  const base = t.url ? `${tabLabel(t)}\n${displayUrl(t.url)}` : tabLabel(t)
  return t.sleeping ? `${base}\nSleeping — click to wake` : base
}

function Favicon({ tab }: { tab: TabInfo }): React.JSX.Element {
  const [broken, setBroken] = useState<string | null>(null)
  if (tab.loading) return <LoaderCircle className="fav spin" size={14} strokeWidth={2} />
  if (tab.url === 'orbit://history') return <Clock className="fav fav-glyph" size={14} strokeWidth={1.75} />
  if (tab.url === 'orbit://bookmarks') return <Bookmark className="fav fav-glyph" size={14} strokeWidth={1.75} />
  if (tab.url === 'orbit://downloads') return <Download className="fav fav-glyph" size={14} strokeWidth={1.75} />
  if (tab.url === 'orbit://settings') return <Settings className="fav fav-glyph" size={14} strokeWidth={1.75} />
  if (tab.favicon && broken !== tab.favicon) return <img className="fav" src={tab.favicon} alt="" onError={() => setBroken(tab.favicon!)} />
  return <Globe className="fav fav-glyph" size={14} strokeWidth={1.65} />
}

interface TopTabBarProps {
  state: BrowserState
  settings: SettingsView | null
  downloads: DownloadInfo[]
  downloadsOpen: boolean
  hasUnseenDownloads: boolean
  downloadPulseTick: number
  onToggleDownloads: () => void
  onDragTabChange?: (tabId: number | null) => void
  onNewWorkspace: () => void
  onEditWorkspace?: (ws: WorkspaceInfo) => void
}

export function TopTabBar({
  state,
  settings,
  downloads,
  downloadsOpen,
  hasUnseenDownloads,
  downloadPulseTick,
  onToggleDownloads,
  onDragTabChange,
  onNewWorkspace,
  onEditWorkspace
}: TopTabBarProps): React.JSX.Element {
  const [dragId, setDragId] = useState<number | null>(null)
  const [wsMenuOpen, setWsMenuOpen] = useState(false)
  const wsBtnRef = useRef<HTMLButtonElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const pinned = state.tabs.filter((t) => t.pinned)
  const open = state.tabs.filter((t) => !t.pinned)
  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  const resolvedShortcuts = useMemo(() => resolveShortcuts(settings?.shortcuts), [settings?.shortcuts])

  type TabItem = { kind: 'single'; tab: TabInfo } | { kind: 'split'; group: SplitGroup; tabs: TabInfo[] }
  const openItems = useMemo<TabItem[]>(() => {
    const out: TabItem[] = []
    const groupByTab = new Map<number, SplitGroup>()
    for (const g of state.splits) {
      for (const tid of g.tabIds) groupByTab.set(tid, g)
    }
    const openById = new Map(open.map((t) => [t.id, t]))
    const seen = new Set<string>()
    for (const t of open) {
      const group = groupByTab.get(t.id)
      if (group) {
        if (seen.has(group.id)) continue
        seen.add(group.id)
        const members = group.tabIds.map((id) => openById.get(id)).filter((x): x is TabInfo => !!x)
        if (members.length >= 2) {
          out.push({ kind: 'split', group, tabs: members })
          continue
        }
      }
      out.push({ kind: 'single', tab: t })
    }
    return out
  }, [open, state.splits])

  useEffect(() => {
    const offPicked = api.menu.onPicked((id) => {
      if (!id.startsWith('toptab-ws:')) return
      setWsMenuOpen(false)
      if (id.startsWith('toptab-ws:switch:')) {
        const wsId = id.slice('toptab-ws:switch:'.length)
        if (wsId) api.switchWorkspace(wsId)
        return
      }
      if (id === 'toptab-ws:new') {
        onNewWorkspace()
        return
      }
      if (id === 'toptab-ws:new-private') {
        void api.createPrivateWorkspace()
        return
      }
      if (id === 'toptab-ws:edit' && activeWorkspace && !activeWorkspace.private) {
        onEditWorkspace?.(activeWorkspace)
        return
      }
      if (id === 'toptab-ws:close-private' && activeWorkspace?.private) {
        void api.deleteWorkspace(activeWorkspace.id)
      }
    })
    const offClosed = api.menu.onClosed(() => setWsMenuOpen(false))
    return () => {
      offPicked()
      offClosed()
    }
  }, [activeWorkspace, onEditWorkspace, onNewWorkspace])

  const openWorkspaceMenu = (): void => {
    const btn = wsBtnRef.current
    if (!btn) return
    if (wsMenuOpen) {
      setWsMenuOpen(false)
      api.menu.close()
      return
    }
    const rect = btn.getBoundingClientRect()
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--tint').trim() || '#b3492b'
    const items: MenuEntry[] = [
      ...state.workspaces.map(
        (ws, idx): MenuEntry => ({
          kind: 'item',
          id: `toptab-ws:switch:${ws.id}`,
          label: `${ws.name} (${state.tabCounts[ws.id] ?? 0})`,
          checked: ws.id === state.activeWorkspaceId,
          keys: idx < 9 ? `Ctrl+Alt+${idx + 1}` : undefined
        })
      ),
      { kind: 'separator' },
      ...(activeWorkspace && !activeWorkspace.private
        ? [{ kind: 'item' as const, id: 'toptab-ws:edit', label: `Edit “${activeWorkspace.name}”…` }]
        : []),
      ...(activeWorkspace?.private
        ? [{ kind: 'item' as const, id: 'toptab-ws:close-private', label: 'Close private workspace' }]
        : []),
      { kind: 'item', id: 'toptab-ws:new', label: 'New workspace…' },
      {
        kind: 'item',
        id: 'toptab-ws:new-private',
        label: 'New private workspace',
        keys: formatShortcutLabel(resolvedShortcuts['new-private-workspace'])
      }
    ]
    setWsMenuOpen(true)
    api.menu.open({
      x: rect.left,
      y: rect.bottom + 4,
      dark,
      accent,
      items
    })
  }

  const drop = (target: TabInfo): void => {
    if (dragId === null || dragId === target.id) return
    api.move(dragId, state.tabs.findIndex((t) => t.id === target.id))
    setDragId(null)
    onDragTabChange?.(null)
  }

  const dragProps = (t: TabInfo) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/x-orbit-tab', String(t.id))
      e.dataTransfer.effectAllowed = 'move'
      setDragId(t.id)
      onDragTabChange?.(t.id)
    },
    onDragEnd: () => {
      setDragId(null)
      onDragTabChange?.(null)
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: () => drop(t)
  })

  const newTabKey = formatShortcutLabel(resolvedShortcuts['new-tab'])
  const closeTabKey = formatShortcutLabel(resolvedShortcuts['close-tab'])
  const unsplitKey = formatShortcutLabel(resolvedShortcuts['split-view'])

  return (
    <div className="top-tabbar" role="region" aria-label="Tab strip">
      {activeWorkspace && (
        <button
          ref={wsBtnRef}
          type="button"
          className={`top-ws-btn ${wsMenuOpen ? 'open' : ''} ${activeWorkspace.private ? 'private' : ''}`}
          aria-label={`Workspace: ${activeWorkspace.name}`}
          aria-haspopup="menu"
          aria-expanded={wsMenuOpen}
          title={`${activeWorkspace.name} — Click to switch workspace${activeWorkspace.private ? '' : ', right-click to edit'}`}
          onClick={openWorkspaceMenu}
          onContextMenu={(e) => {
            e.preventDefault()
            if (!activeWorkspace.private) onEditWorkspace?.(activeWorkspace)
          }}
        >
          <WsIcon icon={activeWorkspace.private ? 'eye-off' : activeWorkspace.icon} size={13} />
          <span className="top-ws-name">{activeWorkspace.name}</span>
          <ChevronDown size={11} className="top-ws-caret" aria-hidden />
        </button>
      )}

      {pinned.length > 0 && (
        <div className="top-pins" role="tablist" aria-label="Pinned tabs">
          {pinned.map((t) => (
            <div
              key={t.id}
              role="tab"
              tabIndex={0}
              aria-selected={t.id === state.activeId}
              className={`top-pin ${t.id === state.activeId ? 'on' : ''} ${t.sleeping ? 'sleeping' : ''} ${dragId === t.id ? 'dragging' : ''}`}
              title={tabTooltip(t)}
              onClick={() => api.activate(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  api.activate(t.id)
                }
              }}
              onAuxClick={(e) => e.button === 1 && api.closeTab(t.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                api.tabMenu(t.id)
              }}
              {...dragProps(t)}
            >
              <Favicon tab={t} />
              {(t.audible || t.muted) && (
                <button
                  type="button"
                  className={`top-pin-audio ${t.muted ? 'muted' : ''}`}
                  aria-label={t.muted ? 'Unmute tab' : 'Mute tab'}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    api.toggleMute(t.id)
                  }}
                >
                  {t.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        ref={trackRef}
        className="top-tabs-track"
        role="tablist"
        aria-label="Open tabs"
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && trackRef.current) {
            trackRef.current.scrollLeft += e.deltaY
          }
        }}
      >
        {openItems.map((item) => {
          if (item.kind === 'split') {
            const groupActive = item.tabs.some((t) => t.id === state.activeId)
            return (
              <div
                key={item.group.id}
                className={`top-split-group ${groupActive ? 'on' : ''}`}
                role="group"
                aria-label="Split tabs"
              >
                {item.tabs.map((t) => (
                  <div
                    key={t.id}
                    role="tab"
                    tabIndex={0}
                    aria-selected={t.id === state.activeId}
                    className={`top-tab top-split-pane ${t.id === state.activeId ? 'on' : ''} ${t.sleeping ? 'sleeping' : ''} ${dragId === t.id ? 'dragging' : ''}`}
                    title={tabTooltip(t)}
                    onClick={() => api.activate(t.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        api.activate(t.id)
                      }
                    }}
                    onAuxClick={(e) => e.button === 1 && api.closeTab(t.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      api.tabMenu(t.id)
                    }}
                    {...dragProps(t)}
                  >
                    <Favicon tab={t} />
                    <span className="top-tab-title">{tabLabel(t)}</span>
                    <button
                      type="button"
                      className="top-tab-close"
                      aria-label="Close pane"
                      title={closeTabKey ? `Close (${closeTabKey})` : 'Close'}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        api.closeTab(t.id)
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="top-split-unsplit"
                  aria-label="Unsplit"
                  title={unsplitKey ? `Unsplit (${unsplitKey})` : 'Unsplit'}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    api.unsplit(item.tabs[0].id)
                  }}
                >
                  <Ungroup size={12} />
                </button>
              </div>
            )
          }

          const t = item.tab
          return (
            <div
              key={t.id}
              role="tab"
              tabIndex={0}
              aria-selected={t.id === state.activeId}
              className={`top-tab ${t.id === state.activeId ? 'on' : ''} ${t.sleeping ? 'sleeping' : ''} ${dragId === t.id ? 'dragging' : ''}`}
              title={tabTooltip(t)}
              onClick={() => api.activate(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  api.activate(t.id)
                }
              }}
              onAuxClick={(e) => e.button === 1 && api.closeTab(t.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                api.tabMenu(t.id)
              }}
              {...dragProps(t)}
            >
              <Favicon tab={t} />
              {(t.audible || t.muted) && (
                <button
                  type="button"
                  className={`top-tab-audio ${t.muted ? 'muted' : ''}`}
                  aria-label={t.muted ? 'Unmute tab' : 'Mute tab'}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    api.toggleMute(t.id)
                  }}
                >
                  {t.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
              )}
              <span className="top-tab-title">{tabLabel(t)}</span>
              <button
                type="button"
                className="top-tab-close"
                aria-label="Close tab"
                title={closeTabKey ? `Close (${closeTabKey})` : 'Close'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  api.closeTab(t.id)
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}

        <button
          type="button"
          className="top-tab-new"
          aria-label="New tab"
          title={newTabKey ? `New tab (${newTabKey})` : 'New tab'}
          onClick={() => api.newTab()}
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="top-tabbar-end">
        <DownloadTriggerButton
          items={downloads}
          open={downloadsOpen}
          hasUnseen={hasUnseenDownloads}
          pulseTick={downloadPulseTick}
          onToggle={onToggleDownloads}
        />
      </div>
    </div>
  )
}
