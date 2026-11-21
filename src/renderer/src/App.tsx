import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BrowserState, CompactRevealState, DownloadInfo, ExternalAppAsk, PermissionAsk, SettingsView, TabInfo, UpdateState } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { StartPage } from './components/StartPage'
import { ErrorPage } from './components/ErrorPage'
import { ExternalAppBar, PermissionBar } from './components/PermissionBar'
import { FindBar } from './components/FindBar'
import { BookmarksPage, HistoryPage } from './components/Library'
import { SettingsPage } from './components/SettingsPage'

const api = window.veyra

const INITIAL_STATE: BrowserState = {
  tabs: [],
  activeId: null,
  workspaces: [],
  activeWorkspaceId: 'personal',
  tabCounts: {},
  workspaceSwitchDir: 0
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<BrowserState>(INITIAL_STATE)
  const [asks, setAsks] = useState<PermissionAsk[]>([])
  const [externalAsks, setExternalAsks] = useState<ExternalAppAsk[]>([])
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [dismissedUpdateVer, setDismissedUpdateVer] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<DownloadInfo[]>([])
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [sidebarEditing, setSidebarEditing] = useState(false)
  const [omniboxEditing, setOmniboxEditing] = useState(false)
  const [compact, setCompact] = useState<CompactRevealState>({ enabled: false, sidebar: false, toolbar: false })
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusTick, setFindFocusTick] = useState(0)
  const [pageFullscreen, setPageFullscreen] = useState(false)
  /** A picture of the page, shown in its place while floating UI (suggestions) is open over it. */
  const [shot, setShot] = useState<string | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const pageFullscreenRef = useRef(false)
  const maxDownloadId = useRef(0)

  useEffect(() => {
    const offs = [
      api.onState(setState),
      api.onPermission(setAsks),
      api.onExternalApps(setExternalAsks),
      api.onSettings(setSettings),
      api.onUpdateState(setUpdate),
      api.onCompactState(setCompact),
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
      api.onFindOpen(() => {
        setFindOpen(true)
        setFindFocusTick((n) => n + 1)
      }),
      api.onFindClose(() => setFindOpen(false)),
      api.onPageFullscreen(setPageFullscreen)
    ]
    api.ready()
    return () => offs.forEach((off) => off())
  }, [])

  // Keep revealed compact panels pinned while interactive UI inside them is open.
  useEffect(() => {
    api.setCompactPin('sidebar', downloadsOpen || sidebarEditing)
  }, [downloadsOpen, sidebarEditing])

  useEffect(() => {
    api.setCompactPin('omnibox', omniboxEditing)
  }, [omniboxEditing])

  const sendBounds = useCallback((): void => {
    if (pageFullscreenRef.current) return
    const el = pageRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    api.setBounds({ x: r.left, y: r.top, width: r.width, height: r.height })
  }, [])

  // The page itself is drawn by the main process, exactly over this box.
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    const ro = new ResizeObserver(sendBounds)
    ro.observe(el)
    window.addEventListener('resize', sendBounds)
    sendBounds()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sendBounds)
    }
  }, [sendBounds])

  useLayoutEffect(() => {
    pageFullscreenRef.current = pageFullscreen
    if (pageFullscreen) return
    sendBounds()
  }, [pageFullscreen, compact.enabled, compact.sidebar, compact.toolbar, sendBounds])

  const active: TabInfo | undefined = state.tabs.find((t) => t.id === state.activeId)
  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  const tabAsks = asks.filter((a) => a.tabId === null || a.tabId === state.activeId)
  const tabExternalAsks = externalAsks.filter((a) => a.tabId === null || a.tabId === state.activeId)

  const updateKey = update?.availableVersion ?? (update?.status === 'ready' ? '__ready__' : null)
  const showUpdateNote = update?.status === 'ready' && dismissedUpdateVer !== updateKey

  const compactClasses = compact.enabled
    ? `compact ${compact.sidebar ? 'reveal-side' : ''} ${compact.toolbar ? 'reveal-bar' : ''}`
    : ''

  return (
    <div
      className={`shell ${pageFullscreen ? 'fullscreen' : ''} ${compactClasses}`}
      data-ws-accent={activeWorkspace?.accent ?? 'clay'}
    >
      {compact.enabled && !pageFullscreen && !compact.sidebar && (
        <div
          className="compact-edge compact-edge-left"
          aria-hidden
          onMouseEnter={() => api.setCompactHover('sidebar', true)}
        />
      )}
      {compact.enabled && !pageFullscreen && !compact.toolbar && (
        <div
          className="compact-edge compact-edge-top"
          aria-hidden
          onMouseEnter={() => api.setCompactHover('toolbar', true)}
        />
      )}
      <Sidebar
        state={state}
        downloads={downloads}
        downloadsOpen={downloadsOpen}
        onCloseDownloads={() => setDownloadsOpen(false)}
        update={showUpdateNote ? update : null}
        onDismissUpdate={() => setDismissedUpdateVer(updateKey)}
        onEditorOpenChange={setSidebarEditing}
        onPointerEdge={compact.enabled ? (inside) => api.setCompactHover('sidebar', inside) : undefined}
      />
      <main className="main">
        <Toolbar
          tab={active}
          onPageShot={setShot}
          onEditingChange={setOmniboxEditing}
          onPointerEdge={compact.enabled ? (inside) => api.setCompactHover('toolbar', inside) : undefined}
        />
        {tabAsks.length > 0 && <PermissionBar ask={tabAsks[0]} />}
        {tabExternalAsks.length > 0 && <ExternalAppBar ask={tabExternalAsks[0]} />}
        <FindBar open={findOpen} focusTick={findFocusTick} onClose={() => setFindOpen(false)} />
        <div
          className="page"
          ref={pageRef}
          onMouseEnter={() => {
            if (!compact.enabled) return
            api.setCompactHover('sidebar', false)
            api.setCompactHover('toolbar', false)
          }}
        >
          {active && !active.url && <StartPage tabId={active.id} />}
          {active?.url === 'orbit://history' && <HistoryPage key={active.id} tabId={active.id} />}
          {active?.url === 'orbit://bookmarks' && <BookmarksPage key={active.id} tabId={active.id} />}
          {active?.url === 'orbit://settings' && <SettingsPage key={active.id} settings={settings} update={update} />}
          {active?.error && <ErrorPage tab={active} />}
          {shot && <img className="page-shot" src={shot} alt="" />}
        </div>
      </main>
    </div>
  )
}
