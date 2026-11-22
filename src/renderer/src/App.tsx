import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  BrowserState,
  CompactRevealState,
  DownloadInfo,
  ExtensionInstallAsk,
  ExternalAppAsk,
  PermissionAsk,
  SettingsView,
  TabInfo,
  UpdateState,
  WindowState
} from '@shared/types'
import {
  DEFAULT_SPLIT_RATIO,
  computeSplitLayout,
  dropPlacementFromPoint,
  findSplitGroup,
  ratioFromPointer,
  type SplitPlacement
} from '@shared/split'
import { APPEARANCE_LIMITS, DEFAULT_APPEARANCE } from '@shared/appearance'
import './library.css'
import './settings.css'
import './startpage.css'
import './import-private.css'
import './extensions.css'
import { applyResolvedAppearance } from './applyAppearance'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { StartPage } from './components/StartPage'
import { ErrorPage } from './components/ErrorPage'
import { ExternalAppBar, PermissionBar } from './components/PermissionBar'
import { ExtensionInstallBar } from './components/ExtensionInstallBar'
import { FindBar } from './components/FindBar'
import { BookmarksPage, DownloadsPage, HistoryPage } from './components/Library'
import { SettingsPage } from './components/SettingsPage'

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

function renderTabSurface(
  tab: TabInfo,
  settings: SettingsView | null,
  update: UpdateState | null,
  downloads: DownloadInfo[],
  onOpenAppearance: () => void,
  shot?: string,
  isPrivate = false
): React.JSX.Element | null {
  if (!tab.url) return <StartPage tabId={tab.id} settings={settings} isPrivate={isPrivate} onOpenAppearance={onOpenAppearance} />
  if (tab.url === 'orbit://history') return <HistoryPage key={tab.id} tabId={tab.id} />
  if (tab.url === 'orbit://bookmarks') return <BookmarksPage key={tab.id} tabId={tab.id} />
  if (tab.url === 'orbit://downloads') return <DownloadsPage key={tab.id} items={downloads} />
  if (tab.url === 'orbit://settings') return <SettingsPage key={tab.id} settings={settings} update={update} />
  if (tab.error) return <ErrorPage tab={tab} />
  if (shot) return <img className="page-shot" src={shot} alt="" />
  return null
}

export function App(): React.JSX.Element {
  const [state, setState] = useState<BrowserState>(INITIAL_STATE)
  const [asks, setAsks] = useState<PermissionAsk[]>([])
  const [externalAsks, setExternalAsks] = useState<ExternalAppAsk[]>([])
  const [extInstallAsks, setExtInstallAsks] = useState<ExtensionInstallAsk[]>([])
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [dismissedUpdateVer, setDismissedUpdateVer] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<DownloadInfo[]>([])
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [hasUnseenDownloads, setHasUnseenDownloads] = useState(false)
  const [downloadPulseTick, setDownloadPulseTick] = useState(0)
  const [dlFly, setDlFly] = useState<{ key: number; fromX: number; fromY: number; toX: number; toY: number } | null>(null)
  const [sidebarEditing, setSidebarEditing] = useState(false)
  const [omniboxEditing, setOmniboxEditing] = useState(false)
  const [compact, setCompact] = useState<CompactRevealState>({ enabled: false, sidebar: false, toolbar: false })
  const [winState, setWinState] = useState<WindowState>({ focused: true, maximized: false, fullscreen: false })
  const [newWorkspaceTick, setNewWorkspaceTick] = useState(0)
  const [findOpen, setFindOpen] = useState(false)
  const [findFocusTick, setFindFocusTick] = useState(0)
  const [pageFullscreen, setPageFullscreen] = useState(false)
  /** Screenshots of visible panes while an in-window overlay (omnibox list or tab-drag drop zone) is open. */
  const [shots, setShots] = useState<Record<number, string> | null>(null)
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [dragTabId, setDragTabId] = useState<number | null>(null)
  const [dropSide, setDropSide] = useState<SplitPlacement | null>(null)
  const [compactDragTabId, setCompactDragTabId] = useState<number | null>(null)
  const [compactDropSide, setCompactDropSide] = useState<SplitPlacement | null>(null)
  const [resizingKind, setResizingKind] = useState<'col' | 'row' | null>(null)
  const [resizingSidebar, setResizingSidebar] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const pageFullscreenRef = useRef(false)
  const maxDownloadId = useRef(0)
  const downloadsOpenRef = useRef(false)
  downloadsOpenRef.current = downloadsOpen
  const dragOverlayActive = useRef(false)
  const dragTabRef = useRef<number | null>(null)
  const compactDragRef = useRef<number | null>(null)
  const lastTokensRef = useRef<import('@shared/types').ResolvedAppearance | null>(null)
  dragTabRef.current = dragTabId
  compactDragRef.current = compactDragTabId

  useEffect(() => {
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMotionChange = (): void => {
      if (lastTokensRef.current) applyResolvedAppearance(lastTokensRef.current)
    }
    mqMotion.addEventListener('change', onMotionChange)
    const offs = [
      api.onState(setState),
      api.onPermission(setAsks),
      api.onExternalApps(setExternalAsks),
      api.extensions.onInstallAsk(setExtInstallAsks),
      api.onSettings(setSettings),
      api.onAppearance((tokens) => {
        lastTokensRef.current = tokens
        applyResolvedAppearance(tokens)
      }),
      api.onUpdateState(setUpdate),
      api.onCompactState(setCompact),
      api.onWinState(setWinState),
      api.onDownloads((items) => {
        setDownloads(items)
        const newest = items.reduce((m, d) => Math.max(m, d.id), 0)
        if (newest > maxDownloadId.current) {
          maxDownloadId.current = newest
          setDownloadPulseTick((n) => n + 1)
          if (!downloadsOpenRef.current) setHasUnseenDownloads(true)
          const pageEl = pageRef.current
          if (pageEl) {
            const pr = pageEl.getBoundingClientRect()
            const trigEl = document.querySelector<HTMLElement>('.dl-trigger')
            const tr = trigEl && trigEl.offsetParent !== null ? trigEl.getBoundingClientRect() : null
            const sideRight = document.documentElement.dataset.sidebarSide === 'right'
            const fromX = Math.round(pr.left + pr.width * 0.5)
            const fromY = Math.round(pr.top + Math.min(120, pr.height * 0.28))
            const toX = tr ? Math.round(tr.left + tr.width / 2) : sideRight ? window.innerWidth - 24 : 24
            const toY = tr ? Math.round(tr.top + tr.height / 2) : window.innerHeight - 24
            setDlFly({ key: newest, fromX, fromY, toX, toY })
          }
        } else if (items.length === 0) {
          setDownloadsOpen(false)
          setHasUnseenDownloads(false)
        }
      }),
      api.onToggleDownloads(() => {
        setDownloadsOpen((v) => {
          if (!v) setHasUnseenDownloads(false)
          return !v
        })
      }),
      api.onFindOpen(() => {
        setFindOpen(true)
        setFindFocusTick((n) => n + 1)
      }),
      api.onFindClose(() => setFindOpen(false)),
      api.onPageFullscreen(setPageFullscreen),
      api.onCompactTabDrag((drag) => {
        if (drag.active && drag.tabId !== null) {
          compactDragRef.current = drag.tabId
          setCompactDragTabId(drag.tabId)
          setCompactDropSide(drag.placement)
          if (drag.shots !== undefined) {
            setShots(drag.shots)
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (compactDragRef.current !== null) api.hidePageForOverlay()
              })
            )
          }
        } else {
          compactDragRef.current = null
          setCompactDragTabId(null)
          setCompactDropSide(null)
          setShots(null)
        }
      }),
      api.onNewWorkspaceRequest(() => setNewWorkspaceTick((n) => n + 1)),
      api.onOpenSettingsSection((sectionId) => {
        sessionStorage.setItem('orbit.settingsSection', sectionId)
        window.dispatchEvent(new CustomEvent('orbit:settings-section', { detail: sectionId }))
      })
    ]
    api.ready()
    return () => {
      mqMotion.removeEventListener('change', onMotionChange)
      offs.forEach((off) => off())
    }
  }, [])

  // Clear the download-start fly animation after it finishes.
  useEffect(() => {
    if (!dlFly) return
    const timer = setTimeout(() => setDlFly(null), 540)
    return () => clearTimeout(timer)
  }, [dlFly])

  // Keep revealed compact panels pinned while interactive UI inside them is open.
  useEffect(() => {
    api.setCompactPin('sidebar', downloadsOpen || sidebarEditing)
  }, [downloadsOpen, sidebarEditing])

  useEffect(() => {
    api.setCompactPin('omnibox', omniboxEditing)
  }, [omniboxEditing])

  // While dragging a tab from the sidebar, temporarily swap native page views for screenshots
  // so HTML5 dragover/drop events reach `.page` cleanly to split left or right.
  useEffect(() => {
    if (dragTabId !== null && !dragOverlayActive.current) {
      dragOverlayActive.current = true
      void api.overlay(true).then((captured) => {
        if (dragTabRef.current === null) return
        setShots(captured)
        requestAnimationFrame(() => requestAnimationFrame(() => dragTabRef.current !== null && api.hidePageForOverlay()))
      })
    } else if (dragTabId === null && dragOverlayActive.current) {
      dragOverlayActive.current = false
      setDropSide(null)
      void api.overlay(false).then(() => setShots(null))
    }
  }, [dragTabId])

  const sendBounds = useCallback((): void => {
    if (pageFullscreenRef.current) return
    const el = pageRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPageSize((prev) => (prev.width === Math.round(r.width) && prev.height === Math.round(r.height) ? prev : { width: Math.round(r.width), height: Math.round(r.height) }))
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

  const appearance = settings?.appearance ?? DEFAULT_APPEARANCE

  useLayoutEffect(() => {
    pageFullscreenRef.current = pageFullscreen
    if (pageFullscreen) return
    sendBounds()
    const raf = requestAnimationFrame(sendBounds)
    return () => cancelAnimationFrame(raf)
  }, [
    pageFullscreen,
    compact.enabled,
    asks.length,
    externalAsks.length,
    extInstallAsks.length,
    findOpen,
    appearance.sidebarSide,
    appearance.sidebarWidth,
    appearance.pageGap,
    appearance.density,
    appearance.textScale,
    sendBounds
  ])

  const active: TabInfo | undefined = state.tabs.find((t) => t.id === state.activeId)
  const activeSplit = useMemo(() => findSplitGroup(state.splits, state.activeId), [state.splits, state.activeId])
  const visiblePanes: TabInfo[] = useMemo(() => {
    if (!active) return []
    if (!activeSplit) return [active]
    const byId = new Map(state.tabs.map((t) => [t.id, t]))
    const list = activeSplit.tabIds.map((id) => byId.get(id)).filter((t): t is TabInfo => !!t)
    return list.length >= 2 ? list : [active]
  }, [active, activeSplit, state.tabs])
  const isSplitView = visiblePanes.length >= 2 && !!activeSplit && !pageFullscreen

  const splitLayout = useMemo(() => {
    if (!isSplitView || !activeSplit || pageSize.width <= 0 || pageSize.height <= 0) return null
    return computeSplitLayout(
      { x: 0, y: 0, width: pageSize.width, height: pageSize.height },
      visiblePanes.length,
      { colRatio: activeSplit.colRatio, rowRatio: activeSplit.rowRatio, orientation: activeSplit.orientation }
    )
  }, [isSplitView, activeSplit, pageSize.width, pageSize.height, visiblePanes.length])

  const visibleTabIds = useMemo(() => new Set(visiblePanes.map((t) => t.id)), [visiblePanes])
  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  const tabAsks = asks.filter((a) => a.tabId === null || a.tabId === -1 || visibleTabIds.has(a.tabId))
  const tabExternalAsks = externalAsks.filter((a) => a.tabId === null || a.tabId === -1 || visibleTabIds.has(a.tabId))

  const updateKey = update?.availableVersion ?? (update?.status === 'ready' ? '__ready__' : null)
  const showUpdateNote = update?.status === 'ready' && dismissedUpdateVer !== updateKey

  const handleNewWorkspace = useCallback((): void => {
    setNewWorkspaceTick((n) => n + 1)
  }, [])

  const handleOpenSettingsSection = useCallback((sectionId: string): void => {
    sessionStorage.setItem('orbit.settingsSection', sectionId)
    api.openInternal('orbit://settings')
    window.dispatchEvent(new CustomEvent('orbit:settings-section', { detail: sectionId }))
  }, [])

  const startDividerDrag = (e: React.PointerEvent<HTMLDivElement>, groupId: string, kind: 'col' | 'row'): void => {
    if (e.button !== 0 || !pageRef.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setResizingKind(kind)
    const rect = pageRef.current.getBoundingClientRect()
    const updateFromEvent = (ev: PointerEvent): void => {
      const next =
        kind === 'col'
          ? ratioFromPointer(ev.clientX, rect.left, rect.width)
          : ratioFromPointer(ev.clientY, rect.top, rect.height)
      api.setSplitRatio(groupId, kind, next)
    }
    const onMove = (ev: PointerEvent): void => updateFromEvent(ev)
    const onUp = (): void => {
      setResizingKind(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const hasOtherUnpinnedTab = useMemo(
    () => state.tabs.some((t) => !t.pinned && t.id !== state.activeId),
    [state.tabs, state.activeId]
  )

  const handlePageDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    const effectiveDragId = dragTabId ?? compactDragTabId
    if (effectiveDragId === null || state.activeId === null) return
    if (effectiveDragId === state.activeId && !activeSplit && !hasOtherUnpinnedTab) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = e.currentTarget.getBoundingClientRect()
    const side = dropPlacementFromPoint(e.clientX, e.clientY, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    })
    if (dragTabId !== null && side !== dropSide) setDropSide(side)
    if (compactDragTabId !== null && side !== compactDropSide) setCompactDropSide(side)
  }

  const handlePageDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('text/x-orbit-tab')
    const droppedId = dragTabId ?? compactDragTabId ?? (raw ? Number(raw) : null)
    const rect = e.currentTarget.getBoundingClientRect()
    const fallbackSide = dropPlacementFromPoint(e.clientX, e.clientY, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    })
    const side: SplitPlacement = dropSide ?? compactDropSide ?? fallbackSide ?? 'right'
    setDropSide(null)
    setDragTabId(null)
    setCompactDropSide(null)
    setCompactDragTabId(null)
    if (droppedId === null || !Number.isFinite(droppedId) || state.activeId === null) return
    api.splitDrop(droppedId, side)
  }

  const activeDropSide = dragTabId !== null ? dropSide : compactDragTabId !== null ? compactDropSide : null
  const dropZoneLabel =
    activeDropSide === 'left'
      ? 'Split left'
      : activeDropSide === 'right'
        ? 'Split right'
        : activeDropSide === 'top'
          ? 'Split top'
          : 'Split bottom'

  const startSidebarResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setResizingSidebar(true)
    const isRight = appearance.sidebarSide === 'right'
    const startX = e.clientX
    const startW = appearance.sidebarWidth
    let latestW = startW
    let raf = 0

    const applyWidth = (w: number): void => {
      const clamped = Math.min(APPEARANCE_LIMITS.sidebarWidth.max, Math.max(APPEARANCE_LIMITS.sidebarWidth.min, Math.round(w)))
      latestW = clamped
      document.documentElement.style.setProperty('--side', `${clamped}px`)
      sendBounds()
    }

    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX
      const target = isRight ? startW - dx : startW + dx
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0
          applyWidth(target)
        })
      }
    }
    const onUp = (): void => {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
      setResizingSidebar(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (latestW !== startW) {
        void api.updateSettings({ appearance: { sidebarWidth: latestW } })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const handleSidebarResizeKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const isRight = appearance.sidebarSide === 'right'
    let delta = 0
    if (e.key === 'ArrowLeft') delta = isRight ? 12 : -12
    else if (e.key === 'ArrowRight') delta = isRight ? -12 : 12
    else if (e.key === 'Home') {
      e.preventDefault()
      void api.updateSettings({ appearance: { sidebarWidth: APPEARANCE_LIMITS.sidebarWidth.default } })
      return
    } else return
    e.preventDefault()
    const next = Math.min(APPEARANCE_LIMITS.sidebarWidth.max, Math.max(APPEARANCE_LIMITS.sidebarWidth.min, appearance.sidebarWidth + delta))
    void api.updateSettings({ appearance: { sidebarWidth: next } })
  }

  // In compact mode, the main window always keeps the page full-size; sidebar and titlebar
  // float above the page in dedicated overlay windows so the page never jumps or resizes.
  const compactClasses = compact.enabled ? 'compact' : ''

  return (
    <div
      className={`shell ${pageFullscreen ? 'fullscreen' : ''} ${compactClasses} ${resizingSidebar ? 'resizing-side' : ''}`}
      data-ws-accent={activeWorkspace?.accent ?? 'clay'}
      data-ws-private={activeWorkspace?.private ? 'true' : undefined}
    >
      {compact.enabled && !pageFullscreen && (
        <>
          <div
            className={`compact-edge ${appearance.sidebarSide === 'right' ? 'compact-edge-right' : 'compact-edge-left'}`}
            aria-hidden
            onMouseEnter={() => api.setCompactHover('sidebar', true)}
          />
          <div
            className="compact-edge compact-edge-top"
            aria-hidden
            onMouseEnter={() => api.setCompactHover('toolbar', true)}
          />
        </>
      )}
      <TitleBar
        state={state}
        tab={active}
        settings={settings}
        winState={winState}
        onPageShot={setShots}
        onEditingChange={setOmniboxEditing}
        onPointerEdge={compact.enabled ? (inside) => api.setCompactHover('toolbar', inside) : undefined}
        onNewWorkspace={handleNewWorkspace}
        onOpenSettingsSection={handleOpenSettingsSection}
      />
      <Sidebar
        state={state}
        downloads={downloads}
        downloadsOpen={downloadsOpen}
        hasUnseenDownloads={hasUnseenDownloads}
        downloadPulseTick={downloadPulseTick}
        onToggleDownloads={() => {
          setDownloadsOpen((v) => {
            if (!v) setHasUnseenDownloads(false)
            return !v
          })
        }}
        onCloseDownloads={() => setDownloadsOpen(false)}
        update={showUpdateNote ? update : null}
        onDismissUpdate={() => setDismissedUpdateVer(updateKey)}
        onEditorOpenChange={setSidebarEditing}
        onPointerEdge={compact.enabled ? (inside) => api.setCompactHover('sidebar', inside) : undefined}
        onDragTabChange={setDragTabId}
        openNewWorkspaceTick={newWorkspaceTick}
      />
      {!compact.enabled && !pageFullscreen && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={APPEARANCE_LIMITS.sidebarWidth.min}
          aria-valuemax={APPEARANCE_LIMITS.sidebarWidth.max}
          aria-valuenow={appearance.sidebarWidth}
          title="Drag to resize sidebar · Double-click to reset"
          className={`side-resizer ${appearance.sidebarSide === 'right' ? 'right' : 'left'} ${resizingSidebar ? 'dragging' : ''}`}
          onPointerDown={startSidebarResize}
          onDoubleClick={() => void api.updateSettings({ appearance: { sidebarWidth: APPEARANCE_LIMITS.sidebarWidth.default } })}
          onKeyDown={handleSidebarResizeKey}
        />
      )}
      <main className="main">
        {tabAsks.length > 0 && <PermissionBar ask={tabAsks[0]} />}
        {tabExternalAsks.length > 0 && <ExternalAppBar ask={tabExternalAsks[0]} />}
        {extInstallAsks.length > 0 && <ExtensionInstallBar ask={extInstallAsks[0]} />}
        <FindBar open={findOpen} focusTick={findFocusTick} onClose={() => setFindOpen(false)} />
        <div
          className={`page ${isSplitView ? 'split' : ''}`}
          ref={pageRef}
          onMouseEnter={() => {
            if (!compact.enabled) return
            api.setCompactHover('sidebar', false)
            api.setCompactHover('toolbar', false)
          }}
          onDragOver={handlePageDragOver}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropSide(null)
          }}
          onDrop={handlePageDrop}
        >
          {isSplitView && splitLayout && activeSplit ? (
            <>
              {visiblePanes.map((pane, idx) => {
                const slot = splitLayout.panes[idx]
                if (!slot) return null
                const focused = pane.id === state.activeId
                return (
                  <div
                    key={pane.id}
                    className={`split-pane ${focused ? 'focused' : ''}`}
                    style={{
                      left: slot.frame.x,
                      top: slot.frame.y,
                      width: slot.frame.width,
                      height: slot.frame.height
                    }}
                    onMouseDown={() => {
                      if (!focused) api.activate(pane.id)
                    }}
                  >
                    <div className="split-pane-inner">
                      {renderTabSurface(pane, settings, update, downloads, () => handleOpenSettingsSection('set-appearance'), shots?.[pane.id], !!activeWorkspace?.private)}
                    </div>
                  </div>
                )
              })}
              {splitLayout.dividers.map((div) => (
                <div
                  key={div.kind}
                  role="separator"
                  aria-orientation={div.orientation}
                  aria-label={div.kind === 'col' ? 'Resize panes horizontally' : 'Resize panes vertically'}
                  title="Drag to resize · Double-click to reset"
                  className={`split-divider ${div.orientation} ${resizingKind === div.kind ? 'dragging' : ''}`}
                  style={{
                    left: div.rect.x,
                    top: div.rect.y,
                    width: div.rect.width,
                    height: div.rect.height
                  }}
                  onPointerDown={(e) => startDividerDrag(e, activeSplit.id, div.kind)}
                  onDoubleClick={() => api.setSplitRatio(activeSplit.id, div.kind, DEFAULT_SPLIT_RATIO)}
                >
                  <span className="split-divider-pill" aria-hidden />
                </div>
              ))}
            </>
          ) : (
            active && renderTabSurface(active, settings, update, downloads, () => handleOpenSettingsSection('set-appearance'), shots?.[active.id], !!activeWorkspace?.private)
          )}

          {activeDropSide && (
            <div className={`split-drop-zone ${activeDropSide}`} aria-hidden>
              <div className="split-drop-card">
                <span>{dropZoneLabel}</span>
              </div>
            </div>
          )}
        </div>
      </main>
      {dlFly && (
        <div
          key={dlFly.key}
          className="dl-fly-chip"
          aria-hidden
          style={
            {
              '--dl-from-x': `${dlFly.fromX}px`,
              '--dl-from-y': `${dlFly.fromY}px`,
              '--dl-to-x': `${dlFly.toX}px`,
              '--dl-to-y': `${dlFly.toY}px`
            } as React.CSSProperties
          }
        />
      )}
    </div>
  )
}
