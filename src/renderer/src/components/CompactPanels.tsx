import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserState, DownloadInfo, SettingsView, TabInfo, UpdateState, WindowState } from '@shared/types'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'

const api = window.veyra

const INITIAL_STATE: BrowserState = {
  tabs: [],
  activeId: null,
  splits: [],
  workspaces: [],
  activeWorkspaceId: 'personal',
  tabCounts: {},
  workspaceSwitchDir: 0,
  canReopenClosed: false
}

/**
 * Floating compact-mode sidebar window. Reuses the real Sidebar component driven by
 * the same browser state feed so the page behind it never moves or resizes.
 */
export function CompactSidebarWindow(): React.JSX.Element {
  const [state, setState] = useState<BrowserState>(INITIAL_STATE)
  const [downloads, setDownloads] = useState<DownloadInfo[]>([])
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [dismissedUpdateVer, setDismissedUpdateVer] = useState<string | null>(null)
  const [sidebarEditing, setSidebarEditing] = useState(false)
  const [newWorkspaceTick, setNewWorkspaceTick] = useState(0)
  const [visible, setVisible] = useState(false)
  const maxDownloadId = useRef(0)
  const panel = window.veyraCompactPanel!

  useEffect(() => {
    document.documentElement.classList.add('compact-panel-win')
    const offs = [
      api.onState(setState),
      api.onUpdateState(setUpdate),
      api.onDownloads((items) => {
        setDownloads(items)
        const newest = items.reduce((m, d) => Math.max(m, d.id), 0)
        if (newest > maxDownloadId.current) {
          maxDownloadId.current = newest
          setDownloadsOpen(true)
        } else if (items.length === 0) {
          setDownloadsOpen(false)
        }
      }),
      api.onToggleDownloads(() => setDownloadsOpen((v) => !v)),
      panel.onVisible(setVisible),
      panel.onNewWorkspace(() => setNewWorkspaceTick((n) => n + 1))
    ]
    panel.ready()
    return () => {
      offs.forEach((off) => off())
      document.documentElement.classList.remove('compact-panel-win')
    }
  }, [panel])

  useEffect(() => {
    api.setCompactPin('sidebar', downloadsOpen || sidebarEditing)
  }, [downloadsOpen, sidebarEditing])

  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  const updateKey = update?.availableVersion ?? (update?.status === 'ready' ? '__ready__' : null)
  const showUpdateNote = update?.status === 'ready' && dismissedUpdateVer !== updateKey

  return (
    <div
      className={`shell compact-float compact-float-side ${visible ? 'open' : ''}`}
      data-ws-accent={activeWorkspace?.accent ?? 'clay'}
    >
      <div className="compact-float-card compact-float-side-card">
        <Sidebar
          state={state}
          downloads={downloads}
          downloadsOpen={downloadsOpen}
          onCloseDownloads={() => setDownloadsOpen(false)}
          update={showUpdateNote ? update : null}
          onDismissUpdate={() => setDismissedUpdateVer(updateKey)}
          onEditorOpenChange={setSidebarEditing}
          onPointerEdge={(inside) => api.setCompactHover('sidebar', inside)}
          openNewWorkspaceTick={newWorkspaceTick}
        />
      </div>
    </div>
  )
}

/**
 * Floating compact-mode titlebar window. Reuses the real TitleBar + Omnibox components
 * above the page without changing the page's bounds.
 */
export function CompactTitlebarWindow(): React.JSX.Element {
  const [state, setState] = useState<BrowserState>(INITIAL_STATE)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [winState, setWinState] = useState<WindowState>({ focused: true, maximized: false, fullscreen: false })
  const [omniboxEditing, setOmniboxEditing] = useState(false)
  const [visible, setVisible] = useState(false)
  const panel = window.veyraCompactPanel!

  useEffect(() => {
    document.documentElement.classList.add('compact-panel-win')
    const offs = [
      api.onState(setState),
      api.onSettings(setSettings),
      api.onWinState(setWinState),
      panel.onVisible(setVisible)
    ]
    panel.ready()
    return () => {
      offs.forEach((off) => off())
      document.documentElement.classList.remove('compact-panel-win')
    }
  }, [panel])

  useEffect(() => {
    api.setCompactPin('omnibox', omniboxEditing)
  }, [omniboxEditing])

  const active: TabInfo | undefined = state.tabs.find((t) => t.id === state.activeId)
  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  const noopShot = useCallback((): void => {}, [])

  return (
    <div
      className={`shell compact-float compact-float-bar ${visible ? 'open' : ''}`}
      data-ws-accent={activeWorkspace?.accent ?? 'clay'}
    >
      <div className="compact-float-card compact-float-bar-card">
        <TitleBar
          state={state}
          tab={active}
          settings={settings}
          winState={winState}
          onPageShot={noopShot}
          onEditingChange={setOmniboxEditing}
          onOmniboxOpenChange={(open) => panel.setOmniboxOpen(open)}
          useOmniboxOverlay={false}
          onPointerEdge={(inside) => api.setCompactHover('toolbar', inside)}
          onNewWorkspace={() => panel.requestNewWorkspace()}
          onOpenSettingsSection={(sectionId) => panel.openSettingsSection(sectionId)}
        />
      </div>
    </div>
  )
}
