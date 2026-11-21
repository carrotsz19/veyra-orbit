import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, EyeOff, Menu as MenuIcon, RotateCw, X } from 'lucide-react'
import type {
  Bookmark,
  BrowserState,
  HistoryEntry,
  MenuId,
  SettingsView,
  TabInfo,
  WindowButtonsStyle,
  WindowState
} from '@shared/types'
import {
  ORBIT_NEW_ISSUE_URL,
  ORBIT_RELEASES_URL,
  buildCollapsedRootMenu,
  buildMenus,
  firstSelectableIndex,
  recentHistoryItems,
  shouldCollapseMenus
} from '@shared/menu'
import { isInternalUrl } from '@shared/url'
import { Omnibox } from './Omnibox'

const api = window.veyra
const INITIAL_QUERY = new URLSearchParams(location.search)
const INITIAL_BUTTONS: WindowButtonsStyle = INITIAL_QUERY.get('buttons') === 'dots' ? 'dots' : 'windows'
const INITIAL_PLATFORM = INITIAL_QUERY.get('platform') ?? 'win32'
const INITIAL_VERSION = INITIAL_QUERY.get('version') ?? ''

/** Inline moon-on-its-orbit mark matching resources/icon-small.svg (and icon-dev-small.svg in Dev). */
function OrbitMark(): React.JSX.Element {
  const dev = __CHANNEL__ === 'dev'
  return (
    <svg className="wb-mark-svg" viewBox="0 0 128 128" width="20" height="20" aria-hidden>
      <rect x="8" y="8" width="112" height="112" rx="26" fill={dev ? '#1d1b18' : '#f3f1ec'} />
      {dev && <path d="M120 70 V94 A26 26 0 0 1 94 120 H70 Z" fill="#b3492b" />}
      <path d="M30 96 C34 66 55 44 84 39" fill="none" stroke={dev ? '#cfc8bb' : '#e3a68f'} strokeWidth="13" strokeLinecap="round" />
      <circle cx="89" cy="39" r="20" fill="#d9633e" />
      <rect
        x="8.5"
        y="8.5"
        width="111"
        height="111"
        rx="25.5"
        fill="none"
        stroke={dev ? 'rgba(243,241,236,0.18)' : 'rgba(27,26,24,0.14)'}
        strokeWidth="2"
      />
    </svg>
  )
}

/**
 * Mac-style window buttons on the right, in Windows order: minimise (yellow),
 * maximise/restore (green), close (red). Symbols show on hover; dots dim to grey when inactive.
 */
function WindowDots({ state }: { state: WindowState }): React.JSX.Element {
  return (
    <div className={`wb-dots ${state.focused ? '' : 'inactive'}`} role="group" aria-label="Window">
      <button type="button" className="wb-dot min" aria-label="Minimise" title="Minimise" onClick={() => api.winCmd('minimize')}>
        <svg viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 6h7" />
        </svg>
      </button>
      <button
        type="button"
        className="wb-dot max"
        aria-label={state.maximized ? 'Restore' : 'Maximise'}
        title={state.maximized ? 'Restore' : 'Maximise'}
        onClick={() => api.winCmd('maximize')}
      >
        {state.maximized ? (
          <svg viewBox="0 0 12 12" aria-hidden>
            <path d="M6.5 2.5v3h3M5.5 9.5v-3h-3" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" aria-hidden>
            <path d="M3 7v2h2M9 5V3H7M3 9l2.6-2.6M9 3 6.4 5.6" />
          </svg>
        )}
      </button>
      <button type="button" className="wb-dot close" aria-label="Close" title="Close" onClick={() => api.winCmd('close')}>
        <svg viewBox="0 0 12 12" aria-hidden>
          <path d="M3.3 3.3l5.4 5.4M8.7 3.3 3.3 8.7" />
        </svg>
      </button>
    </div>
  )
}

type OpenTarget = MenuId | 'collapsed' | null

interface TitleBarProps {
  state: BrowserState
  tab?: TabInfo
  settings: SettingsView | null
  winState: WindowState
  onPageShot: (shots: Record<number, string> | null) => void
  onEditingChange?: (editing: boolean) => void
  onOmniboxOpenChange?: (open: boolean) => void
  useOmniboxOverlay?: boolean
  onPointerEdge?: (inside: boolean) => void
  onNewWorkspace: () => void
  onOpenSettingsSection: (sectionId: string) => void
}

export function TitleBar({
  state,
  tab,
  settings,
  winState,
  onPageShot,
  onEditingChange,
  onOmniboxOpenChange,
  useOmniboxOverlay = true,
  onPointerEdge,
  onNewWorkspace,
  onOpenSettingsSection
}: TitleBarProps): React.JSX.Element {
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [openTarget, setOpenTarget] = useState<OpenTarget>(null)
  const [collapsedSub, setCollapsedSub] = useState<MenuId | null>(null)
  const [openViaKeyboard, setOpenViaKeyboard] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  const btnRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const menusNavRef = useRef<HTMLElement>(null)
  const lastClosedRef = useRef<{ target: string; at: number }>({ target: '', at: 0 })

  const activeWindowButtons: WindowButtonsStyle = settings?.activeWindowButtons ?? INITIAL_BUTTONS
  const isWin = INITIAL_PLATFORM === 'win32'
  const collapsed = shouldCollapseMenus(windowWidth, {
    windowButtons: activeWindowButtons,
    isDev: __CHANNEL__ === 'dev'
  })

  useEffect(() => {
    const onResize = (): void => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Close open menu if layout flips between expanded and collapsed.
  useEffect(() => {
    if (openTarget && ((collapsed && openTarget !== 'collapsed') || (!collapsed && openTarget === 'collapsed'))) {
      setOpenTarget(null)
      setCollapsedSub(null)
      api.menu.close()
    }
  }, [collapsed, openTarget])

  const refreshLibraryData = useCallback((): void => {
    void api.history('', null).then((list) => setHistory(list.slice(0, 32)))
    void api.bookmarks().then(setBookmarks)
  }, [])

  useEffect(() => {
    refreshLibraryData()
    return api.onDataChanged(refreshLibraryData)
  }, [refreshLibraryData])

  const sections = useMemo(
    () =>
      buildMenus({
        activeTab: tab
          ? {
              id: tab.id,
              url: tab.url,
              canGoBack: tab.canGoBack,
              canGoForward: tab.canGoForward,
              zoom: tab.zoom,
              bookmarked: tab.bookmarked,
              hasError: !!tab.error
            }
          : null,
        workspaces: state.workspaces.map((w) => ({ id: w.id, name: w.name, private: w.private })),
        activeWorkspaceId: state.activeWorkspaceId,
        compactMode: !!settings?.compactMode,
        isSplit: !!tab && state.splits.some((g) => g.tabIds.includes(tab.id)),
        isFullscreen: winState.fullscreen,
        canReopenClosed: state.canReopenClosed,
        history: history.map((h) => ({ url: h.url, title: h.title })),
        bookmarks: bookmarks.map((b) => ({ url: b.url, title: b.title })),
        appVersion: INITIAL_VERSION,
        isDev: __CHANNEL__ === 'dev'
      }),
    [tab, state.workspaces, state.activeWorkspaceId, state.splits, state.canReopenClosed, settings?.compactMode, winState.fullscreen, history, bookmarks]
  )

  const recentUrls = useMemo(() => recentHistoryItems(history.map((h) => ({ url: h.url, title: h.title }))), [history])

  const openUrlInTab = useCallback(
    (url: string): void => {
      if (tab && !tab.url) api.navigate(tab.id, url)
      else api.newTab(url)
    },
    [tab]
  )

  const runAction = useCallback(
    (id: string): void => {
      if (id.startsWith('submenu:')) {
        const subId = id.slice('submenu:'.length) as MenuId
        if (subId === 'history' || subId === 'bookmarks') refreshLibraryData()
        setCollapsedSub(subId)
        setOpenViaKeyboard(true)
        return
      }
      if (id === 'submenu-back') {
        setCollapsedSub(null)
        setOpenViaKeyboard(true)
        return
      }

      setOpenTarget(null)
      setCollapsedSub(null)

      if (id.startsWith('history:open:')) {
        const idx = Number(id.slice('history:open:'.length))
        const entry = recentUrls[idx]
        if (entry?.url) openUrlInTab(entry.url)
        return
      }
      if (id.startsWith('bookmarks:open:')) {
        const idx = Number(id.slice('bookmarks:open:'.length))
        const mark = bookmarks[idx]
        if (mark?.url) openUrlInTab(mark.url)
        return
      }
      if (id.startsWith('workspaces:switch:')) {
        const wsId = id.slice('workspaces:switch:'.length)
        if (wsId) api.switchWorkspace(wsId)
        return
      }

      switch (id) {
        case 'file:new-tab':
          api.newTab()
          return
        case 'file:new-workspace':
        case 'workspaces:new':
          onNewWorkspace()
          return
        case 'file:new-private-workspace':
        case 'workspaces:new-private':
          void api.createPrivateWorkspace()
          return
        case 'workspaces:close-private':
          if (state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.private) {
            void api.deleteWorkspace(state.activeWorkspaceId)
          }
          return
        case 'file:reopen-closed':
          api.reopenClosedTab()
          return
        case 'file:print':
          api.print()
          return
        case 'file:settings':
          api.openInternal('orbit://settings')
          return
        case 'file:close-tab':
          if (tab) api.closeTab(tab.id)
          return
        case 'file:quit':
          api.winCmd('quit')
          return
        case 'edit:undo':
          api.winCmd('undo')
          return
        case 'edit:redo':
          api.winCmd('redo')
          return
        case 'edit:cut':
          api.winCmd('cut')
          return
        case 'edit:copy':
          api.winCmd('copy')
          return
        case 'edit:paste':
          api.winCmd('paste')
          return
        case 'edit:select-all':
          api.winCmd('selectAll')
          return
        case 'edit:find':
          api.openFind()
          return
        case 'view:palette':
          api.openPalette('command')
          return
        case 'view:compact':
          api.toggleCompactMode()
          return
        case 'view:split':
          api.splitWithNext()
          return
        case 'view:zoom-in':
          api.zoomIn()
          return
        case 'view:zoom-out':
          api.zoomOut()
          return
        case 'view:zoom-reset':
          api.resetZoom()
          return
        case 'view:fullscreen':
          api.winCmd('fullscreen')
          return
        case 'view:reload':
          api.reload()
          return
        case 'view:devtools':
          api.toggleDevTools()
          return
        case 'view:downloads':
          api.toggleDownloads()
          return
        case 'history:back':
          api.back()
          return
        case 'history:forward':
          api.forward()
          return
        case 'history:all':
          api.openInternal('orbit://history')
          return
        case 'bookmarks:toggle':
          api.toggleBookmark()
          return
        case 'bookmarks:all':
          api.openInternal('orbit://bookmarks')
          return
        case 'help:check-updates':
          onOpenSettingsSection('set-updates')
          void api.checkForUpdates()
          return
        case 'help:whats-new':
          openUrlInTab(ORBIT_RELEASES_URL)
          return
        case 'help:report-bug':
          openUrlInTab(ORBIT_NEW_ISSUE_URL)
          return
        case 'help:about':
          onOpenSettingsSection('set-updates')
          return
      }
    },
    [bookmarks, onNewWorkspace, onOpenSettingsSection, openUrlInTab, recentUrls, refreshLibraryData, state.activeWorkspaceId, state.workspaces, tab]
  )

  const liveRef = useRef({ openTarget, sections, runAction, collapsed })
  liveRef.current = { openTarget, sections, runAction, collapsed }

  // Sync open menu spec to the floating acrylic BrowserWindow.
  useEffect(() => {
    if (!openTarget) {
      api.menu.close()
      return
    }
    const btn = btnRefs.current.get(openTarget)
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--tint').trim() || '#b3492b'

    let items
    let header
    if (openTarget === 'collapsed') {
      if (collapsedSub) {
        const sec = sections.find((s) => s.id === collapsedSub)
        items = sec?.items ?? []
        header = { label: sec?.label ?? 'Menu', backId: 'submenu-back' }
      } else {
        items = buildCollapsedRootMenu(sections)
      }
    } else {
      items = sections.find((s) => s.id === openTarget)?.items ?? []
    }

    api.menu.open({
      x: rect.left,
      y: rect.bottom + 4,
      dark,
      accent,
      items,
      initialActive: openViaKeyboard ? firstSelectableIndex(items) : -1,
      header
    })
  }, [openTarget, collapsedSub, openViaKeyboard, sections, settings?.theme])

  const toggleMenuBarFocus = useCallback((): void => {
    if (liveRef.current.openTarget) {
      setOpenTarget(null)
      setCollapsedSub(null)
      api.menu.close()
      return
    }
    const activeEl = document.activeElement
    if (activeEl && menusNavRef.current?.contains(activeEl)) {
      ;(activeEl as HTMLElement).blur()
      return
    }
    const firstKey = liveRef.current.collapsed ? 'collapsed' : liveRef.current.sections[0]?.id
    if (firstKey) {
      requestAnimationFrame(() => btnRefs.current.get(firstKey)?.focus())
    }
  }, [])

  // Subscribe to floating menu window events and Alt-to-focus.
  useEffect(() => {
    let altSolo = false
    const onWinKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Alt' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat) {
        altSolo = true
      } else {
        altSolo = false
      }
    }
    const onWinKeyUp = (e: KeyboardEvent): void => {
      if (e.key === 'Alt' && altSolo) {
        altSolo = false
        e.preventDefault()
        toggleMenuBarFocus()
      }
    }
    const onWinBlur = (): void => {
      altSolo = false
    }
    window.addEventListener('keydown', onWinKeyDown, true)
    window.addEventListener('keyup', onWinKeyUp, true)
    window.addEventListener('blur', onWinBlur)

    const offs = [
      api.menu.onPicked((id) => liveRef.current.runAction(id)),
      api.menu.onClosed(() => {
        lastClosedRef.current = { target: liveRef.current.openTarget ?? '', at: Date.now() }
        setOpenTarget(null)
        setCollapsedSub(null)
      }),
      api.menu.onStep((by) => {
        const cur = liveRef.current.openTarget
        if (!cur || cur === 'collapsed') return
        const ids = liveRef.current.sections.map((s) => s.id)
        const idx = ids.indexOf(cur)
        if (idx < 0) return
        const nextId = ids[(idx + by + ids.length) % ids.length]
        if (nextId === 'history' || nextId === 'bookmarks') refreshLibraryData()
        setOpenViaKeyboard(true)
        setOpenTarget(nextId)
      }),
      api.onFocusMenuBar(() => {
        altSolo = false
        toggleMenuBarFocus()
      })
    ]
    return () => {
      window.removeEventListener('keydown', onWinKeyDown, true)
      window.removeEventListener('keyup', onWinKeyUp, true)
      window.removeEventListener('blur', onWinBlur)
      offs.forEach((off) => off())
    }
  }, [refreshLibraryData, toggleMenuBarFocus])

  const openMenu = (target: MenuId | 'collapsed', viaKeyboard: boolean): void => {
    if (target === 'history' || target === 'bookmarks' || target === 'collapsed') refreshLibraryData()
    setCollapsedSub(null)
    setOpenViaKeyboard(viaKeyboard)
    setOpenTarget(target)
  }

  const handleMenuBtnMouseDown = (e: React.MouseEvent, target: MenuId | 'collapsed'): void => {
    e.preventDefault()
    // Clicking the open menu's own button closes it (its floating window already hid on blur).
    if (lastClosedRef.current.target === target && Date.now() - lastClosedRef.current.at < 300) {
      lastClosedRef.current = { target: '', at: 0 }
      return
    }
    if (openTarget === target) {
      setOpenTarget(null)
      setCollapsedSub(null)
    } else {
      openMenu(target, false)
    }
  }

  const handleMenuBtnKeyDown = (e: React.KeyboardEvent, idx: number, target: MenuId | 'collapsed'): void => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openMenu(target, true)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpenTarget(null)
      setCollapsedSub(null)
      ;(e.currentTarget as HTMLElement).blur()
      return
    }
    if (!collapsed && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      const delta = e.key === 'ArrowRight' ? 1 : -1
      const next = sections[(idx + delta + sections.length) % sections.length]
      btnRefs.current.get(next.id)?.focus()
    }
  }

  const titlebarClasses = [
    'titlebar',
    isWin && activeWindowButtons === 'windows' ? 'native-buttons' : '',
    isWin && activeWindowButtons === 'dots' ? 'dots-buttons' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header
      className={titlebarClasses}
      onMouseEnter={() => onPointerEdge?.(true)}
      onMouseLeave={() => onPointerEdge?.(false)}
    >
      <div className="tb-left">
        <div className="wb-brand">
          <OrbitMark />
          <span className="wb-brand-name">
            Veyra <span className="brand-sub">Orbit</span>
          </span>
          {__CHANNEL__ === 'dev' && (
            <span className="brand-dev" title="Veyra Orbit Dev test build">
              DEV
            </span>
          )}
        </div>

        <nav ref={menusNavRef} className="wb-menus" aria-label="Menu">
          {collapsed ? (
            <button
              type="button"
              ref={(el) => void btnRefs.current.set('collapsed', el)}
              className={`wb-menu-btn wb-menu-hamburger ${openTarget === 'collapsed' ? 'open' : ''}`}
              aria-label="Menu"
              aria-haspopup="menu"
              aria-expanded={openTarget === 'collapsed'}
              title="Menu (Alt)"
              onMouseDown={(e) => handleMenuBtnMouseDown(e, 'collapsed')}
              onKeyDown={(e) => handleMenuBtnKeyDown(e, 0, 'collapsed')}
            >
              <MenuIcon size={15} strokeWidth={2} aria-hidden />
            </button>
          ) : (
            sections.map((sec, idx) => (
              <button
                key={sec.id}
                type="button"
                ref={(el) => void btnRefs.current.set(sec.id, el)}
                className={`wb-menu-btn ${openTarget === sec.id ? 'open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={openTarget === sec.id}
                onMouseDown={(e) => handleMenuBtnMouseDown(e, sec.id)}
                onMouseEnter={() => {
                  if (openTarget && openTarget !== sec.id && openTarget !== 'collapsed') {
                    openMenu(sec.id, false)
                  }
                }}
                onKeyDown={(e) => handleMenuBtnKeyDown(e, idx, sec.id)}
              >
                {sec.label}
              </button>
            ))
          )}
        </nav>
      </div>

      <div className="tb-drag" />

      <div className="tb-center">
        <div className="nav">
          <button
            type="button"
            className="icon-btn"
            aria-label="Back"
            title="Back (Alt+Left)"
            disabled={!tab?.canGoBack}
            onClick={() => api.back()}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Forward"
            title="Forward (Alt+Right)"
            disabled={!tab?.canGoForward}
            onClick={() => api.forward()}
          >
            <ArrowRight size={16} />
          </button>
          {tab?.loading ? (
            <button type="button" className="icon-btn" aria-label="Stop" title="Stop" onClick={() => api.stop()}>
              <X size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="icon-btn"
              aria-label="Reload"
              title="Reload (Ctrl+R)"
              disabled={!tab?.url || isInternalUrl(tab.url)}
              onClick={() => api.reload()}
            >
              <RotateCw size={15} />
            </button>
          )}
        </div>

        <Omnibox
          tab={tab}
          onPageShot={onPageShot}
          onEditingChange={onEditingChange}
          onOpenChange={onOmniboxOpenChange}
          useOverlay={useOmniboxOverlay}
        />
        {state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.private && (
          <span className="private-pill" title="Private workspace — history, cookies and site data are not saved">
            <EyeOff size={12} aria-hidden />
            <span>Private</span>
          </span>
        )}
        {tab && tab.zoom !== 100 && (
          <button
            type="button"
            className="zoom-pill"
            aria-label={`Zoom ${tab.zoom}%, click to reset`}
            title="Reset zoom (Ctrl+0)"
            onClick={() => api.resetZoom()}
          >
            {tab.zoom}%
          </button>
        )}
      </div>

      <div className="tb-drag" />

      {isWin && activeWindowButtons === 'dots' ? (
        <WindowDots state={winState} />
      ) : isWin ? (
        <div className="caption-space" />
      ) : null}
    </header>
  )
}
