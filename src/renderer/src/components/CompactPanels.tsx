import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserState, DownloadInfo, SettingsView, TabInfo, UpdateState, WindowState } from '@shared/types'
import '../extensions.css'
import { applyResolvedAppearance } from '../applyAppearance'
import { shouldShowBookmarkBar } from '@shared/bookmarks'
import { BookmarkBar } from './BookmarkBar'
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
  const [hasUnseenDownloads, setHasUnseenDownloads] = useState(false)
  const [downloadPulseTick, setDownloadPulseTick] = useState(0)
  const [sidebarEditing, setSidebarEditing] = useState(false)
  const [draggingTab, setDraggingTab] = useState(false)
  const [newWorkspaceTick, setNewWorkspaceTick] = useState(0)
  const [visible, setVisible] = useState(false)
  const maxDownloadId = useRef(0)
  const downloadsOpenRef = useRef(false)
  downloadsOpenRef.current = downloadsOpen
  const panel = window.veyraCompactPanel!

  useEffect(() => {
    document.documentElement.classList.add('compact-panel-win')
    const offs = [
      api.onState(setState),
      api.onAppearance(applyResolvedAppearance),
      api.onDownloads((items) => {
        setDownloads(items)
        const newest = items.reduce((m, d) => Math.max(m, d.id), 0)
        if (newest > maxDownloadId.current) {
          maxDownloadId.current = newest
          setDownloadPulseTick((n) => n + 1)
          if (!downloadsOpenRef.current) setHasUnseenDownloads(true)
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
    api.setCompactPin('sidebar', downloadsOpen || sidebarEditing || draggingTab)
  }, [downloadsOpen, sidebarEditing, draggingTab])

  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)

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
          hasUnseenDownloads={hasUnseenDownloads}
          downloadPulseTick={downloadPulseTick}
          onToggleDownloads={() => {
            setDownloadsOpen((v) => {
              if (!v) setHasUnseenDownloads(false)
              return !v
            })
          }}
          onCloseDownloads={() => setDownloadsOpen(false)}
          onEditorOpenChange={setSidebarEditing}
          onPointerEdge={(inside) => api.setCompactHover('sidebar', inside)}
          onDragTabChange={(id) => {
            setDraggingTab(id !== null)
            if (id !== null) panel.startTabDrag(id)
            else panel.endTabDrag()
          }}
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
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [winState, setWinState] = useState<WindowState>({ focused: true, maximized: false, fullscreen: false })
  const [omniboxEditing, setOmniboxEditing] = useState(false)
  const [bmEditing, setBmEditing] = useState(false)
  const [visible, setVisible] = useState(false)
  const panel = window.veyraCompactPanel!

  useEffect(() => {
    document.documentElement.classList.add('compact-panel-win')
    const offs = [
      api.onState(setState),
      api.onSettings(setSettings),
      api.onUpdateState(setUpdate),
      api.onAppearance(applyResolvedAppearance),
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
    api.setCompactPin('omnibox', omniboxEditing || bmEditing)
  }, [omniboxEditing, bmEditing])

  const active: TabInfo | undefined = state.tabs.find((t) => t.id === state.activeId)
  const showBookmarkBar = shouldShowBookmarkBar(
    settings?.appearance.bookmarkBar ?? 'start-page',
    !!active && !active.url && !active.error,
    winState.fullscreen
  )
  const activeWorkspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId)
  const noopShot = useCallback((): void => {}, [])
  const draggingRef = useRef(false)
  const moveRafRef = useRef(0)

  useEffect(() => {
    const finishDrag = (): void => {
      if (!draggingRef.current) return
      draggingRef.current = false
      if (moveRafRef.current) {
        cancelAnimationFrame(moveRafRef.current)
        moveRafRef.current = 0
      }
      panel.endWindowDrag()
    }
    const onPointerMove = (): void => {
      if (!draggingRef.current) return
      if (!moveRafRef.current) {
        moveRafRef.current = requestAnimationFrame(() => {
          moveRafRef.current = 0
          if (draggingRef.current) panel.moveWindowDrag()
        })
      }
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', finishDrag)
    window.addEventListener('blur', finishDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', finishDrag)
      window.removeEventListener('blur', finishDrag)
      finishDrag()
    }
  }, [panel])

  const handleCompactDragStart = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      e.preventDefault()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* ignore if capture unavailable */
      }
      draggingRef.current = true
      panel.startWindowDrag()
    },
    [panel]
  )

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
          update={update}
          winState={winState}
          onPageShot={noopShot}
          onEditingChange={setOmniboxEditing}
          onOmniboxOpenChange={(open) => panel.setOmniboxOpen(open)}
          useOmniboxOverlay={false}
          onPointerEdge={(inside) => api.setCompactHover('toolbar', inside)}
          onNewWorkspace={() => panel.requestNewWorkspace()}
          onOpenSettingsSection={(sectionId) => panel.openSettingsSection(sectionId)}
          inCompactPanel
          onCompactDragStart={handleCompactDragStart}
          onCompactDragDoubleClick={() => api.winCmd('maximize')}
        />
        {showBookmarkBar && (
          <BookmarkBar
            tab={active}
            inCompactPanel
            onPointerEdge={(inside) => api.setCompactHover('toolbar', inside)}
            onEditingChange={setBmEditing}
          />
        )}
      </div>
    </div>
  )
}
