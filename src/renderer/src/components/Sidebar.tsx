import { useEffect, useState } from 'react'
import {
  Bookmark,
  BookOpen,
  Briefcase,
  Clock,
  Code,
  Compass,
  EyeOff,
  FlaskConical,
  Globe,
  GraduationCap,
  Home,
  LoaderCircle,
  Lock,
  Music,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Ungroup,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import type { BrowserState, DownloadInfo, SplitGroup, TabInfo, UpdateState, WorkspaceAccentId, WorkspaceIconId, WorkspaceInfo } from '@shared/types'
import { WORKSPACE_ACCENTS, WORKSPACE_ICONS, isBuiltInWorkspaceIcon } from '@shared/workspaces'
import { displayUrl } from '@shared/url'
import { Downloads } from './Downloads'

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

function WorkspaceGlyph({ icon, size = 14 }: { icon: string; size?: number }): React.JSX.Element {
  if (icon === 'eye-off') {
    return <EyeOff size={size} strokeWidth={1.85} aria-hidden />
  }
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

function label(t: TabInfo): string {
  return t.title || displayUrl(t.url) || 'New tab'
}

function tabTooltip(t: TabInfo): string {
  const base = t.url ? `${label(t)}\n${displayUrl(t.url)}` : label(t)
  return t.sleeping ? `${base}\nSleeping — click to wake` : base
}

function Favicon({ tab }: { tab: TabInfo }): React.JSX.Element {
  const [broken, setBroken] = useState<string | null>(null)
  if (tab.loading) return <LoaderCircle className="fav spin" size={16} strokeWidth={2} />
  if (tab.url === 'orbit://history') return <Clock className="fav fav-glyph" size={15} strokeWidth={1.75} />
  if (tab.url === 'orbit://bookmarks') return <Bookmark className="fav fav-glyph" size={15} strokeWidth={1.75} />
  if (tab.url === 'orbit://settings') return <Settings className="fav fav-glyph" size={15} strokeWidth={1.75} />
  if (tab.favicon && broken !== tab.favicon) return <img className="fav" src={tab.favicon} alt="" onError={() => setBroken(tab.favicon!)} />
  return <Globe className="fav fav-glyph" size={15} strokeWidth={1.65} />
}

interface EditorState {
  mode: 'create' | 'edit'
  id?: string
  name: string
  icon: string
  accent: WorkspaceAccentId
  isolated: boolean
  confirmDelete: boolean
}

interface Props {
  state: BrowserState
  downloads: DownloadInfo[]
  downloadsOpen: boolean
  onCloseDownloads: () => void
  update: UpdateState | null
  onDismissUpdate: () => void
  onEditorOpenChange?: (open: boolean) => void
  onPointerEdge?: (inside: boolean) => void
  onDragTabChange?: (tabId: number | null) => void
  openNewWorkspaceTick?: number
}

export function Sidebar({
  state,
  downloads,
  downloadsOpen,
  onCloseDownloads,
  update,
  onDismissUpdate,
  onEditorOpenChange,
  onPointerEdge,
  onDragTabChange,
  openNewWorkspaceTick = 0
}: Props): React.JSX.Element {
  const [dragId, setDragId] = useState<number | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)

  useEffect(() => {
    onEditorOpenChange?.(editor !== null)
  }, [editor, onEditorOpenChange])

  useEffect(() => {
    if (openNewWorkspaceTick <= 0) return
    const nextAccent = WORKSPACE_ACCENTS[state.workspaces.length % WORKSPACE_ACCENTS.length].id
    setEditor({
      mode: 'create',
      name: '',
      icon: 'book-open',
      accent: nextAccent,
      isolated: false,
      confirmDelete: false
    })
  }, [openNewWorkspaceTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const pinned = state.tabs.filter((t) => t.pinned)
  const open = state.tabs.filter((t) => !t.pinned)
  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)

  // Group open tabs into single rows or combined split-group rows.
  type TabRow = { kind: 'single'; tab: TabInfo } | { kind: 'split'; group: SplitGroup; tabs: TabInfo[] }
  const openRows: TabRow[] = []
  const groupByTab = new Map<number, SplitGroup>()
  for (const g of state.splits) {
    for (const tid of g.tabIds) groupByTab.set(tid, g)
  }
  const openById = new Map(open.map((t) => [t.id, t]))
  const seenGroups = new Set<string>()
  for (const t of open) {
    const group = groupByTab.get(t.id)
    if (group) {
      if (seenGroups.has(group.id)) continue
      seenGroups.add(group.id)
      const members = group.tabIds.map((id) => openById.get(id)).filter((x): x is TabInfo => !!x)
      if (members.length >= 2) {
        openRows.push({ kind: 'split', group, tabs: members })
        continue
      }
    }
    openRows.push({ kind: 'single', tab: t })
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

  const openCreateEditor = (): void => {
    const nextAccent = WORKSPACE_ACCENTS[state.workspaces.length % WORKSPACE_ACCENTS.length].id
    setEditor({
      mode: 'create',
      name: '',
      icon: 'book-open',
      accent: nextAccent,
      isolated: false,
      confirmDelete: false
    })
  }

  const openEditEditor = (ws: WorkspaceInfo): void => {
    setEditor({
      mode: 'edit',
      id: ws.id,
      name: ws.name,
      icon: ws.icon,
      accent: ws.accent,
      isolated: ws.isolated,
      confirmDelete: false
    })
  }

  const submitEditor = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!editor) return
    if (editor.mode === 'create') {
      await api.createWorkspace({
        name: editor.name.trim() || `Space ${state.workspaces.length + 1}`,
        icon: editor.icon,
        accent: editor.accent,
        isolated: editor.isolated
      })
    } else if (editor.id) {
      await api.updateWorkspace(editor.id, {
        name: editor.name.trim() || 'Workspace',
        icon: editor.icon,
        accent: editor.accent,
        isolated: editor.isolated
      })
    }
    setEditor(null)
  }

  const confirmDeleteWorkspace = async (): Promise<void> => {
    if (!editor?.id) return
    await api.deleteWorkspace(editor.id)
    setEditor(null)
  }

  const slideClass =
    state.workspaceSwitchDir > 0 ? 'ws-slide-next' : state.workspaceSwitchDir < 0 ? 'ws-slide-prev' : 'ws-slide-none'

  return (
    <aside
      className="side"
      onMouseEnter={() => onPointerEdge?.(true)}
      onMouseLeave={() => onPointerEdge?.(false)}
    >
      {activeWorkspace && (
        <div className="ws-head">
          <span className="ws-head-badge" aria-hidden>
            <WorkspaceGlyph icon={activeWorkspace.icon} size={13} />
          </span>
          <span className="ws-head-name" title={activeWorkspace.name}>
            {activeWorkspace.name}
          </span>
          {activeWorkspace.isolated && !activeWorkspace.private && (
            <span className="ws-head-lock" title="Separate sign-ins & cookies">
              <Lock size={11} aria-hidden />
            </span>
          )}
          {activeWorkspace.private ? (
            <button
              type="button"
              className="ws-head-close"
              aria-label={`Close ${activeWorkspace.name} workspace and clear data`}
              title="Close private workspace and clear data"
              onClick={() => void api.deleteWorkspace(activeWorkspace.id)}
            >
              <X size={13} />
            </button>
          ) : (
            <button
              type="button"
              className="ws-head-edit"
              aria-label={`Edit ${activeWorkspace.name} workspace`}
              title="Edit workspace"
              onClick={() => openEditEditor(activeWorkspace)}
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
      )}

      <div key={state.activeWorkspaceId} className={`ws-pane ${slideClass}`}>
        {pinned.length > 0 && (
          <div className="pins">
            {pinned.map((t) => (
              <div
                key={t.id}
                role="tab"
                tabIndex={0}
                aria-selected={t.id === state.activeId}
                className={`pin ${t.id === state.activeId ? 'on' : ''} ${t.sleeping ? 'sleeping' : ''} ${dragId === t.id ? 'dragging' : ''}`}
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
                    className={`pin-audio ${t.muted ? 'muted' : ''}`}
                    aria-label={t.muted ? 'Unmute tab' : 'Mute tab'}
                    title={t.muted ? 'Unmute tab' : 'Mute tab'}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      api.toggleMute(t.id)
                    }}
                  >
                    {t.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="tabs" role="tablist" aria-label="Tabs">
          {openRows.map((row) => {
            if (row.kind === 'split') {
              const groupActive = row.tabs.some((t) => t.id === state.activeId)
              return (
                <div
                  key={row.group.id}
                  className={`split-row ${groupActive ? 'on' : ''} ${row.tabs.length > 2 ? 'grid' : ''}`}
                  role="group"
                  aria-label="Split tabs"
                >
                  {row.tabs.map((t) => (
                    <div
                      key={t.id}
                      role="tab"
                      tabIndex={0}
                      aria-selected={t.id === state.activeId}
                      className={`split-cell ${t.id === state.activeId ? 'focused' : ''} ${t.sleeping ? 'sleeping' : ''} ${dragId === t.id ? 'dragging' : ''}`}
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
                      <span className="tab-title">{label(t)}</span>
                      <button
                        type="button"
                        className="split-cell-close"
                        aria-label="Close pane"
                        title="Close pane"
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
                    className="split-row-unsplit"
                    aria-label="Unsplit"
                    title="Unsplit (Ctrl+Shift+\)"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      api.unsplit(row.tabs[0].id)
                    }}
                  >
                    <Ungroup size={12} />
                  </button>
                </div>
              )
            }
            const t = row.tab
            return (
              <div
                key={t.id}
                role="tab"
                tabIndex={0}
                aria-selected={t.id === state.activeId}
                className={`tab ${t.id === state.activeId ? 'on' : ''} ${t.sleeping ? 'sleeping' : ''} ${dragId === t.id ? 'dragging' : ''}`}
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
                title={tabTooltip(t)}
                {...dragProps(t)}
              >
                <Favicon tab={t} />
                {(t.audible || t.muted) && (
                  <button
                    type="button"
                    className={`tab-btn tab-audio ${t.muted ? 'muted' : ''}`}
                    aria-label={t.muted ? 'Unmute tab' : 'Mute tab'}
                    title={t.muted ? 'Unmute tab' : 'Mute tab'}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      api.toggleMute(t.id)
                    }}
                  >
                    {t.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  </button>
                )}
                <span className="tab-title">{label(t)}</span>
                <button
                  className="tab-btn"
                  aria-label="Pin tab"
                  title="Pin"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    api.togglePin(t.id)
                  }}
                >
                  {t.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                </button>
                <button
                  className="tab-btn tab-close"
                  aria-label="Close tab"
                  title="Close (Ctrl+W)"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    api.closeTab(t.id)
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
          <button className="tab new" onClick={() => api.newTab()}>
            <Plus size={16} />
            <span className="tab-title">New tab</span>
            <kbd>Ctrl T</kbd>
          </button>
        </div>
      </div>

      {downloadsOpen && <Downloads items={downloads} onClose={onCloseDownloads} />}
      {update?.status === 'ready' && (
        <div className="update-note" role="status" aria-live="polite">
          <div className="update-note-top">
            <span className="update-note-dot" aria-hidden />
            <span className="update-note-text">Update ready — restart to update</span>
            <button type="button" className="dl-btn" aria-label="Dismiss update notice" title="Dismiss" onClick={onDismissUpdate}>
              <X size={13} />
            </button>
          </div>
          <div className="update-note-actions">
            {update.availableVersion && <span className="update-note-ver">v{update.availableVersion}</span>}
            <button type="button" className="btn primary update-note-btn" onClick={() => api.installUpdate()}>
              Restart
            </button>
          </div>
        </div>
      )}

      {editor && (
        <form
          className="ws-editor"
          aria-label={editor.mode === 'create' ? 'Create workspace' : 'Edit workspace'}
          onSubmit={(e) => void submitEditor(e)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditor(null)
          }}
        >
          <div className="ws-editor-head">
            <span>{editor.mode === 'create' ? 'New workspace' : 'Edit workspace'}</span>
            <button type="button" className="dl-btn" aria-label="Close workspace editor" title="Close" onClick={() => setEditor(null)}>
              <X size={13} />
            </button>
          </div>

          <input
            className="ws-input"
            type="text"
            autoFocus
            maxLength={40}
            placeholder="Workspace name"
            aria-label="Workspace name"
            value={editor.name}
            onChange={(e) => setEditor({ ...editor, name: e.target.value })}
          />

          <div className="ws-field">
            <div className="ws-field-label">Icon or emoji</div>
            <div className="ws-icons">
              {WORKSPACE_ICONS.map((iconId) => (
                <button
                  key={iconId}
                  type="button"
                  className={`ws-icon-pick ${editor.icon === iconId ? 'on' : ''}`}
                  aria-label={`Icon ${iconId}`}
                  title={iconId.replace(/-/g, ' ')}
                  aria-pressed={editor.icon === iconId}
                  onClick={() => setEditor({ ...editor, icon: iconId })}
                >
                  <WorkspaceGlyph icon={iconId} size={13} />
                </button>
              ))}
              <input
                className="ws-emoji-input"
                type="text"
                maxLength={8}
                placeholder="Aa"
                aria-label="Custom symbol"
                title="Or type a custom character"
                value={isBuiltInWorkspaceIcon(editor.icon) ? '' : editor.icon}
                onChange={(e) => {
                  const val = e.target.value.trim()
                  setEditor({ ...editor, icon: val || 'compass' })
                }}
              />
            </div>
          </div>

          <div className="ws-field">
            <div className="ws-field-label">Accent</div>
            <div className="ws-swatches" role="radiogroup" aria-label="Workspace accent colour">
              {WORKSPACE_ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={editor.accent === a.id}
                  aria-label={a.name}
                  title={a.name}
                  className={`ws-swatch ${editor.accent === a.id ? 'on' : ''}`}
                  data-accent={a.id}
                  onClick={() => setEditor({ ...editor, accent: a.id })}
                />
              ))}
            </div>
          </div>

          <label className="ws-iso">
            <input
              type="checkbox"
              checked={editor.isolated}
              onChange={(e) => setEditor({ ...editor, isolated: e.target.checked })}
            />
            <span>
              <strong>Keep sign-ins separate</strong>
              <small>Separate cookies and logins for this workspace</small>
            </span>
          </label>

          {editor.confirmDelete && editor.id ? (
            <div className="ws-delete-confirm">
              <span>
                Delete “{editor.name || 'Workspace'}” and close {state.tabCounts[editor.id] ?? 0}{' '}
                {(state.tabCounts[editor.id] ?? 0) === 1 ? 'tab' : 'tabs'}?
              </span>
              <div className="ws-editor-actions">
                <button type="button" className="btn ws-btn" onClick={() => setEditor({ ...editor, confirmDelete: false })}>
                  Cancel
                </button>
                <button type="button" className="btn danger ws-btn" onClick={() => void confirmDeleteWorkspace()}>
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="ws-editor-actions">
              {editor.mode === 'edit' && state.workspaces.length > 1 && (
                <button
                  type="button"
                  className="dl-btn ws-del-btn"
                  aria-label="Delete workspace"
                  title="Delete workspace"
                  onClick={() => setEditor({ ...editor, confirmDelete: true })}
                >
                  <Trash2 size={13} />
                </button>
              )}
              <button type="button" className="btn ws-btn" onClick={() => setEditor(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary ws-btn">
                {editor.mode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          )}
        </form>
      )}

      <div className="ws-bar" role="tablist" aria-label="Workspaces">
        <div className="ws-dots">
          {state.workspaces.map((ws, idx) => {
            const isActive = ws.id === state.activeWorkspaceId
            const count = state.tabCounts[ws.id] ?? 0
            const shortcutHint = idx < 9 ? ` · Ctrl+Alt+${idx + 1}` : ''
            const isoHint = ws.private ? ' · Private (not saved)' : ws.isolated ? ' · Separate sign-ins' : ''
            return (
              <button
                key={ws.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={ws.name}
                data-accent={ws.accent}
                className={`ws-dot ${isActive ? 'on' : ''} ${ws.private ? 'private' : ''}`}
                title={`${ws.name} (${count} ${count === 1 ? 'tab' : 'tabs'})${shortcutHint}${isoHint}${ws.private ? '' : '\nRight-click to edit'}`}
                onClick={() => api.switchWorkspace(ws.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (!ws.private) openEditEditor(ws)
                }}
              >
                <WorkspaceGlyph icon={ws.private ? 'eye-off' : ws.icon} size={14} />
                {ws.isolated && !ws.private && <span className="ws-dot-iso" aria-hidden />}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className="ws-add"
          aria-label="New workspace"
          title="New workspace"
          onClick={() => (editor?.mode === 'create' ? setEditor(null) : openCreateEditor())}
        >
          <Plus size={14} />
        </button>
      </div>
    </aside>
  )
}
