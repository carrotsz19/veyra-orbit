import { useState } from 'react'
import { Bookmark, Clock, Globe, LoaderCircle, Pin, PinOff, Plus, Settings, Volume2, VolumeX, X } from 'lucide-react'
import type { BrowserState, DownloadInfo, TabInfo } from '@shared/types'
import { displayUrl } from '@shared/url'
import { Downloads } from './Downloads'

const api = window.veyra

function label(t: TabInfo): string {
  return t.title || displayUrl(t.url) || 'New tab'
}

function Favicon({ tab }: { tab: TabInfo }): React.JSX.Element {
  const [broken, setBroken] = useState<string | null>(null)
  if (tab.loading) return <LoaderCircle className="fav spin" size={16} strokeWidth={2} />
  if (tab.url === 'orbit://history') return <Clock className="fav" size={16} strokeWidth={1.75} />
  if (tab.url === 'orbit://bookmarks') return <Bookmark className="fav" size={16} strokeWidth={1.75} />
  if (tab.url === 'orbit://settings') return <Settings className="fav" size={16} strokeWidth={1.75} />
  if (tab.favicon && broken !== tab.favicon) return <img className="fav" src={tab.favicon} alt="" onError={() => setBroken(tab.favicon!)} />
  return <Globe className="fav" size={16} strokeWidth={1.75} />
}

interface Props {
  state: BrowserState
  downloads: DownloadInfo[]
  downloadsOpen: boolean
  onCloseDownloads: () => void
}

export function Sidebar({ state, downloads, downloadsOpen, onCloseDownloads }: Props): React.JSX.Element {
  const [dragId, setDragId] = useState<number | null>(null)
  const pinned = state.tabs.filter((t) => t.pinned)
  const open = state.tabs.filter((t) => !t.pinned)

  const drop = (target: TabInfo): void => {
    if (dragId === null || dragId === target.id) return
    api.move(dragId, state.tabs.findIndex((t) => t.id === target.id))
    setDragId(null)
  }
  const dragProps = (t: TabInfo) => ({
    draggable: true,
    onDragStart: () => setDragId(t.id),
    onDragEnd: () => setDragId(null),
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDrop: () => drop(t)
  })

  return (
    <aside className="side">
      <div className="side-top">
        <span className="brand">
          <span className="brand-dot" />
          Veyra <span className="brand-sub">Orbit</span>
          {__CHANNEL__ === 'dev' && <span className="brand-dev">DEV</span>}
        </span>
      </div>

      {pinned.length > 0 && (
        <div className="pins">
          {pinned.map((t) => (
            <div
              key={t.id}
              role="tab"
              tabIndex={0}
              aria-selected={t.id === state.activeId}
              className={`pin ${t.id === state.activeId ? 'on' : ''} ${dragId === t.id ? 'dragging' : ''}`}
              title={label(t)}
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
        {open.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === state.activeId}
            className={`tab ${t.id === state.activeId ? 'on' : ''} ${dragId === t.id ? 'dragging' : ''}`}
            onMouseDown={(e) => e.button === 0 && api.activate(t.id)}
            onAuxClick={(e) => e.button === 1 && api.closeTab(t.id)}
            onContextMenu={(e) => {
              e.preventDefault()
              api.tabMenu(t.id)
            }}
            title={t.url ? `${label(t)}\n${displayUrl(t.url)}` : label(t)}
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
            <button className="tab-btn" aria-label="Pin tab" title="Pin" onMouseDown={(e) => e.stopPropagation()} onClick={() => api.togglePin(t.id)}>
              {t.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
            <button className="tab-btn tab-close" aria-label="Close tab" title="Close (Ctrl+W)" onMouseDown={(e) => e.stopPropagation()} onClick={() => api.closeTab(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
        <button className="tab new" onClick={() => api.newTab()}>
          <Plus size={16} />
          <span className="tab-title">New tab</span>
          <kbd>Ctrl T</kbd>
        </button>
      </div>
      {downloadsOpen && <Downloads items={downloads} onClose={onCloseDownloads} />}
    </aside>
  )
}
