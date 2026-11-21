import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BrowserState, PermissionAsk, TabInfo } from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { StartPage } from './components/StartPage'
import { ErrorPage } from './components/ErrorPage'
import { PermissionBar } from './components/PermissionBar'
import { BookmarksPage, HistoryPage } from './components/Library'

const api = window.veyra

export function App(): React.JSX.Element {
  const [state, setState] = useState<BrowserState>({ tabs: [], activeId: null })
  const [asks, setAsks] = useState<PermissionAsk[]>([])
  /** A picture of the page, shown in its place while floating UI (suggestions) is open over it. */
  const [shot, setShot] = useState<string | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const offs = [api.onState(setState), api.onPermission(setAsks)]
    api.ready()
    return () => offs.forEach((off) => off())
  }, [])

  // The page itself is drawn by the main process, exactly over this box.
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    const send = (): void => {
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

  const active: TabInfo | undefined = state.tabs.find((t) => t.id === state.activeId)
  const tabAsks = asks.filter((a) => a.tabId === null || a.tabId === state.activeId)

  return (
    <div className="shell">
      <Sidebar state={state} />
      <main className="main">
        <Toolbar tab={active} onPageShot={setShot} />
        {tabAsks.length > 0 && <PermissionBar ask={tabAsks[0]} />}
        <div className="page" ref={pageRef}>
          {active && !active.url && <StartPage tabId={active.id} />}
          {active?.url === 'orbit://history' && <HistoryPage key={active.id} tabId={active.id} />}
          {active?.url === 'orbit://bookmarks' && <BookmarksPage key={active.id} tabId={active.id} />}
          {active?.error && <ErrorPage tab={active} />}
          {shot && <img className="page-shot" src={shot} alt="" />}
        </div>
      </main>
    </div>
  )
}
