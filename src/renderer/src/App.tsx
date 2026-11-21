import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BrowserState, DownloadInfo, ExternalAppAsk, PermissionAsk, SettingsView, TabInfo } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { StartPage } from './components/StartPage'
import { ErrorPage } from './components/ErrorPage'
import { ExternalAppBar, PermissionBar } from './components/PermissionBar'
import { FindBar } from './components/FindBar'
import { BookmarksPage, HistoryPage } from './components/Library'
import { SettingsPage } from './components/SettingsPage'

const api = window.veyra

export function App(): React.JSX.Element {
  const [state, setState] = useState<BrowserState>({ tabs: [], activeId: null })
  const [asks, setAsks] = useState<PermissionAsk[]>([])
  const [externalAsks, setExternalAsks] = useState<ExternalAppAsk[]>([])
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [downloads, setDownloads] = useState<DownloadInfo[]>([])
  const [downloadsOpen, setDownloadsOpen] = useState(false)
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

  // The page itself is drawn by the main process, exactly over this box.
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    const send = (): void => {
      if (pageFullscreenRef.current) return
      const r = el.getBoundingClientRect()
      api.setBounds({ x: r.left, y: r.top, width: r.width, height: r.height })
    }
    const ro = new ResizeObserver(send)
    ro.observe(el)
    window.addEventListener('resize', send)
    send()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', send)
    }
  }, [])

  useLayoutEffect(() => {
    pageFullscreenRef.current = pageFullscreen
    if (pageFullscreen) return
    const el = pageRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    api.setBounds({ x: r.left, y: r.top, width: r.width, height: r.height })
  }, [pageFullscreen])

  const active: TabInfo | undefined = state.tabs.find((t) => t.id === state.activeId)
  const tabAsks = asks.filter((a) => a.tabId === null || a.tabId === state.activeId)
  const tabExternalAsks = externalAsks.filter((a) => a.tabId === null || a.tabId === state.activeId)

  return (
    <div className={`shell ${pageFullscreen ? 'fullscreen' : ''}`}>
      <Sidebar state={state} downloads={downloads} downloadsOpen={downloadsOpen} onCloseDownloads={() => setDownloadsOpen(false)} />
      <main className="main">
        <Toolbar tab={active} onPageShot={setShot} />
        {tabAsks.length > 0 && <PermissionBar ask={tabAsks[0]} />}
        {tabExternalAsks.length > 0 && <ExternalAppBar ask={tabExternalAsks[0]} />}
        <FindBar open={findOpen} focusTick={findFocusTick} onClose={() => setFindOpen(false)} />
        <div className="page" ref={pageRef}>
          {active && !active.url && <StartPage tabId={active.id} />}
          {active?.url === 'orbit://history' && <HistoryPage key={active.id} tabId={active.id} />}
          {active?.url === 'orbit://bookmarks' && <BookmarksPage key={active.id} tabId={active.id} />}
          {active?.url === 'orbit://settings' && <SettingsPage key={active.id} settings={settings} />}
          {active?.error && <ErrorPage tab={active} />}
          {shot && <img className="page-shot" src={shot} alt="" />}
        </div>
      </main>
    </div>
  )
}
