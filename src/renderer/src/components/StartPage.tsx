import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark as BookmarkIcon,
  Clock,
  EyeOff,
  History,
  NotebookPen,
  Pencil,
  Plus,
  Quote,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react'
import type {
  QuickLink,
  SettingsView,
  StartPageData,
  StartPagePatch,
  StartPageSettings,
  StartWidgetId
} from '@shared/types'
import {
  DEFAULT_START_PAGE,
  START_PAGE_LIMITS,
  normalizeQuickLinkUrl,
  quoteForDate,
  reorderList
} from '@shared/startpage'
import { FirstRunImportBanner } from './ImportCard'
import { StartCustomizeDrawer } from './StartCustomizeDrawer'

const api = window.veyra

function greetingForHour(h: number): string {
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function relativeTime(ts?: number): string {
  if (!ts) return ''
  const diff = Math.max(0, Date.now() - ts)
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatClock(now: Date, format: '12h' | '24h', showSeconds: boolean): { time: string; period: string } {
  const h24 = now.getHours()
  const mins = String(now.getMinutes()).padStart(2, '0')
  const secs = String(now.getSeconds()).padStart(2, '0')
  if (format === '24h') {
    const hh = String(h24).padStart(2, '0')
    return { time: showSeconds ? `${hh}:${mins}:${secs}` : `${hh}:${mins}`, period: '' }
  }
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 || 12
  return {
    time: showSeconds ? `${h12}:${mins}:${secs}` : `${h12}:${mins}`,
    period
  }
}

/** Displays a browser-cached favicon or falls back to a crisp typographic monogram (never makes new requests). */
function SiteGlyph({ favicon, label }: { favicon?: string; label: string }): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setBroken(false)
  }, [favicon])
  if (favicon && !broken) {
    return (
      <img
        className="sp-tile-fav"
        src={favicon}
        alt=""
        decoding="async"
        loading="lazy"
        onError={() => setBroken(true)}
      />
    )
  }
  return (
    <span className="sp-tile-initial" aria-hidden>
      {(label.trim().charAt(0) || '?').toUpperCase()}
    </span>
  )
}

interface LinkEditorState {
  mode: 'add' | 'edit'
  id?: string
  title: string
  url: string
  error: string | null
}

interface Props {
  tabId: number
  settings: SettingsView | null
  isPrivate?: boolean
  onOpenAppearance?: () => void
}

const EMPTY_DATA: StartPageData = {
  topSites: [],
  recentlyClosed: [],
  recentHistory: [],
  bookmarks: []
}

/** Rich, customizable, local-first start page. Renders in < 100 ms with zero external widget network calls. */
export function StartPage({ tabId, settings, isPrivate = false, onOpenAppearance }: Props): React.JSX.Element {
  const config: StartPageSettings = settings?.startPage ?? DEFAULT_START_PAGE
  const [text, setText] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [data, setData] = useState<StartPageData>(EMPTY_DATA)
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(null)
  const [bgError, setBgError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pageHidden, setPageHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const [noteDraft, setNoteDraft] = useState(config.focusNote)
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null)
  const [dragLinkIdx, setDragLinkIdx] = useState<number | null>(null)
  const [dragWidgetIdx, setDragWidgetIdx] = useState<number | null>(null)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastBgFileRef = useRef<string>('')

  const patchStart = useCallback((patch: StartPagePatch): void => {
    void api.updateSettings({ startPage: patch })
  }, [])

  // Pause ambient animation when window/document is hidden.
  useEffect(() => {
    const onVis = (): void => setPageHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Clock ticker: 1s only when seconds are shown, otherwise 15s for minimal idle CPU.
  useEffect(() => {
    setNow(new Date())
    const ms = config.showSeconds ? 1000 : 15_000
    const timer = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(timer)
  }, [config.showSeconds])

  // Keep local note synced when changed from another tab or settings update.
  useEffect(() => {
    setNoteDraft(config.focusNote)
  }, [config.focusNote])

  useEffect(() => {
    return () => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    }
  }, [])

  // Load local start-page data in one batched IPC call (top sites, recently closed, history, bookmarks).
  useEffect(() => {
    if (isPrivate) return
    let alive = true
    const load = (): void => {
      void api.getStartPageData().then((next) => {
        if (alive && next) setData(next)
      })
    }
    load()
    return api.onDataChanged(load)
  }, [isPrivate])

  // Load app-owned custom background image if configured.
  useEffect(() => {
    if (isPrivate) return
    const file = config.backgroundImage
    if (!file) {
      lastBgFileRef.current = ''
      setBgDataUrl(null)
      return
    }
    if (file === lastBgFileRef.current && bgDataUrl) return
    lastBgFileRef.current = file
    let alive = true
    void api.getStartBackground().then((url) => {
      if (alive) setBgDataUrl(url)
    })
    return () => {
      alive = false
    }
  }, [config.backgroundImage, isPrivate]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChooseImage = useCallback(async (): Promise<void> => {
    setBgError(null)
    const res = await api.chooseStartBackground()
    if (res.canceled) return
    if (res.ok && res.dataUrl) {
      lastBgFileRef.current = res.settings?.startPage.backgroundImage ?? ''
      setBgDataUrl(res.dataUrl)
    } else if (res.error) {
      setBgError(res.error)
    }
  }, [])

  const handleRemoveImage = useCallback(async (): Promise<void> => {
    setBgError(null)
    lastBgFileRef.current = ''
    setBgDataUrl(null)
    await api.removeStartBackground()
  }, [])

  const handleNoteChange = (val: string): void => {
    const clipped = val.slice(0, START_PAGE_LIMITS.maxFocusNote)
    setNoteDraft(clipped)
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => {
      noteTimerRef.current = null
      patchStart({ focusNote: clipped })
    }, 350)
  }

  const flushNote = (): void => {
    if (noteTimerRef.current) {
      clearTimeout(noteTimerRef.current)
      noteTimerRef.current = null
    }
    if (noteDraft !== config.focusNote) patchStart({ focusNote: noteDraft })
  }

  // Favicon lookup map built purely from already-cached browser favicons.
  const faviconByHost = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of [...data.topSites, ...data.recentlyClosed, ...data.recentHistory, ...data.bookmarks]) {
      if (item.favicon) {
        try {
          map.set(new URL(item.url).host.toLowerCase(), item.favicon)
        } catch {
          /* ignore */
        }
      }
    }
    return map
  }, [data])

  const cachedFaviconFor = (url: string): string | undefined => {
    try {
      return faviconByHost.get(new URL(url).host.toLowerCase())
    } catch {
      return undefined
    }
  }

  // Resolve displayed quick links: user's saved links, or auto-populated from top history sites when not yet customized.
  const usingTopSiteDefaults = !config.quickLinksCustomized && config.quickLinks.length === 0
  const displayQuickLinks: QuickLink[] = useMemo(() => {
    if (!usingTopSiteDefaults) return config.quickLinks
    return data.topSites.slice(0, config.quickLinkColumns).map((s, i) => ({
      id: `top-${i}`,
      title: s.title || hostOf(s.url),
      url: s.url
    }))
  }, [usingTopSiteDefaults, config.quickLinks, data.topSites, config.quickLinkColumns])

  const commitQuickLinks = (next: QuickLink[]): void => {
    patchStart({ quickLinks: next, quickLinksCustomized: true })
  }

  const submitLinkEditor = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!linkEditor) return
    const normUrl = normalizeQuickLinkUrl(linkEditor.url)
    if (!normUrl) {
      setLinkEditor({ ...linkEditor, error: 'Enter a valid http(s) web address, e.g. wikipedia.org.' })
      return
    }
    const title = linkEditor.title.trim().slice(0, START_PAGE_LIMITS.maxQuickLinkTitle) || hostOf(normUrl)
    const base = displayQuickLinks
    if (linkEditor.mode === 'add') {
      if (base.length >= START_PAGE_LIMITS.maxQuickLinks) {
        setLinkEditor({ ...linkEditor, error: `You can save up to ${START_PAGE_LIMITS.maxQuickLinks} quick links.` })
        return
      }
      const id = `ql-${Date.now().toString(36)}`
      commitQuickLinks([...base, { id, title, url: normUrl }])
    } else if (linkEditor.id) {
      commitQuickLinks(base.map((l) => (l.id === linkEditor.id ? { ...l, title, url: normUrl } : l)))
    }
    setLinkEditor(null)
  }

  const removeQuickLink = (id: string): void => {
    commitQuickLinks(displayQuickLinks.filter((l) => l.id !== id))
  }

  const moveQuickLink = (from: number, to: number): void => {
    if (to < 0 || to >= displayQuickLinks.length || from === to) return
    commitQuickLinks(reorderList(displayQuickLinks, from, to))
  }

  const openUrl = (url: string, e: React.MouseEvent): void => {
    if (e.button === 1 || e.ctrlKey || e.metaKey) api.newTab(url)
    else api.navigate(tabId, url)
  }

  const today = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const clock = formatClock(now, config.clockFormat, config.showSeconds)
  const quote = useMemo(() => quoteForDate(now), [now.getFullYear(), now.getMonth(), now.getDate()]) // eslint-disable-line react-hooks/exhaustive-deps

  // Private browsing keeps a clean, distraction-free private start page.
  if (isPrivate) {
    return (
      <div className="start private-start">
        <div className="start-private-emblem" aria-hidden>
          <EyeOff size={22} strokeWidth={1.8} />
        </div>
        <h1 className="start-hello">Private browsing.</h1>
        <p className="start-private-note">
          Private: Orbit won&apos;t save your history, cookies or site data from this workspace.
        </p>
        <form
          className="start-search"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) api.navigate(tabId, text)
          }}
        >
          <Search size={18} />
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search or type a web address"
            aria-label="Search or type a web address"
          />
        </form>
        <p className="start-hint">
          <kbd>Ctrl L</kbd> address bar · <kbd>Ctrl T</kbd> new tab · <kbd>Ctrl Shift N</kbd> new private workspace
        </p>
      </div>
    )
  }

  const hasPhoto = config.background === 'image' && !!bgDataUrl
  const enabledWidgets = config.widgets.filter((w) => w.enabled)

  const handleWidgetDrop = (targetId: StartWidgetId): void => {
    if (dragWidgetIdx === null) return
    const targetIdx = config.widgets.findIndex((w) => w.id === targetId)
    if (targetIdx >= 0 && dragWidgetIdx !== targetIdx) {
      patchStart({ widgets: reorderList(config.widgets, dragWidgetIdx, targetIdx) })
    }
    setDragWidgetIdx(null)
  }

  const renderWidget = (id: StartWidgetId): React.JSX.Element | null => {
    switch (id) {
      case 'clock': {
        const greet = greetingForHour(now.getHours())
        const heading = config.userName ? `${greet}, ${config.userName}.` : `${greet}.`
        return (
          <section className="sp-widget sp-clock-widget" aria-label="Clock and greeting">
            <div className="sp-clock-time" aria-live="off">
              <span>{clock.time}</span>
              {clock.period && <span className="sp-clock-period">{clock.period}</span>}
            </div>
            <p className="start-date">{today}</p>
            <h1 className="start-hello">{heading}</h1>
          </section>
        )
      }

      case 'search':
        return (
          <section className="sp-widget sp-search-widget" aria-label="Search">
            <form
              className="start-search"
              onSubmit={(e) => {
                e.preventDefault()
                if (text.trim()) api.navigate(tabId, text)
              }}
            >
              <Search size={18} aria-hidden />
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Search or type a web address"
                aria-label="Search or type a web address"
              />
            </form>
          </section>
        )

      case 'quick-links':
        return (
          <section className="sp-widget sp-card-section sp-quick-widget" aria-label="Quick links">
            <div className="sp-section-head">
              <span className="sp-section-title">
                {usingTopSiteDefaults && displayQuickLinks.length > 0 ? 'Top sites' : 'Quick links'}
              </span>
              <button
                type="button"
                className="sp-head-action"
                onClick={() => setLinkEditor({ mode: 'add', title: '', url: '', error: null })}
              >
                <Plus size={13} aria-hidden />
                <span>Add link</span>
              </button>
            </div>

            {linkEditor && (
              <form className="sp-link-form" onSubmit={submitLinkEditor}>
                <input
                  type="text"
                  className="sp-text-input"
                  placeholder="Title (optional)"
                  aria-label="Quick link title"
                  maxLength={START_PAGE_LIMITS.maxQuickLinkTitle}
                  value={linkEditor.title}
                  onChange={(e) => setLinkEditor({ ...linkEditor, title: e.target.value, error: null })}
                />
                <input
                  type="text"
                  className="sp-text-input"
                  placeholder="https://example.com"
                  aria-label="Quick link URL"
                  autoFocus
                  value={linkEditor.url}
                  onChange={(e) => setLinkEditor({ ...linkEditor, url: e.target.value, error: null })}
                />
                <div className="sp-link-form-btns">
                  <button type="button" className="btn sm ghost" onClick={() => setLinkEditor(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn sm primary">
                    {linkEditor.mode === 'add' ? 'Add' : 'Save'}
                  </button>
                </div>
                {linkEditor.error && (
                  <p className="sp-dsec-error sp-link-err" role="alert">
                    {linkEditor.error}
                  </p>
                )}
              </form>
            )}

            {displayQuickLinks.length === 0 ? (
              <div className="sp-empty-inline">
                <span>Sites you visit often show up here, or add your own quick links.</span>
              </div>
            ) : (
              <div
                className={`sp-ql-grid size-${config.quickLinkSize}`}
                style={{ '--ql-cols': config.quickLinkColumns } as React.CSSProperties}
              >
                {displayQuickLinks.map((link, idx) => (
                  <div
                    key={link.id}
                    className={`sp-ql-tile ${dragLinkIdx === idx ? 'dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragLinkIdx(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragLinkIdx !== null && dragLinkIdx !== idx) moveQuickLink(dragLinkIdx, idx)
                      setDragLinkIdx(null)
                    }}
                    onDragEnd={() => setDragLinkIdx(null)}
                  >
                    <button
                      type="button"
                      className="sp-ql-open"
                      title={`${link.title}\n${link.url}`}
                      onClick={(e) => openUrl(link.url, e)}
                      onAuxClick={(e) => e.button === 1 && openUrl(link.url, e)}
                    >
                      <span className="sp-ql-icon">
                        <SiteGlyph favicon={cachedFaviconFor(link.url)} label={link.title} />
                      </span>
                      <span className="sp-ql-title">{link.title}</span>
                    </button>
                    <div className="sp-ql-tools">
                      <button
                        type="button"
                        className="sp-ql-tool"
                        aria-label={`Move ${link.title} left`}
                        title="Move left"
                        disabled={idx === 0}
                        onClick={() => moveQuickLink(idx, idx - 1)}
                      >
                        <ArrowLeft size={11} />
                      </button>
                      <button
                        type="button"
                        className="sp-ql-tool"
                        aria-label={`Move ${link.title} right`}
                        title="Move right"
                        disabled={idx === displayQuickLinks.length - 1}
                        onClick={() => moveQuickLink(idx, idx + 1)}
                      >
                        <ArrowRight size={11} />
                      </button>
                      <button
                        type="button"
                        className="sp-ql-tool"
                        aria-label={`Edit ${link.title}`}
                        title="Edit"
                        onClick={() =>
                          setLinkEditor({
                            mode: 'edit',
                            id: link.id,
                            title: link.title,
                            url: link.url,
                            error: null
                          })
                        }
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        className="sp-ql-tool"
                        aria-label={`Remove ${link.title}`}
                        title="Remove"
                        onClick={() => removeQuickLink(link.id)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )

      case 'recent-tabs': {
        const items = [
          ...data.recentlyClosed.map((c) => ({ ...c, closed: true })),
          ...data.recentHistory.map((h) => ({ ...h, closed: false }))
        ].slice(0, 6)
        return (
          <section className="sp-widget sp-surface-card sp-recent-widget" aria-label="Continue where you left off">
            <div className="sp-section-head">
              <span className="sp-section-title">
                <History size={13} aria-hidden />
                <span>Continue where you left off</span>
              </span>
              <div className="sp-head-group">
                {data.recentlyClosed.length > 0 && (
                  <button type="button" className="sp-head-action" onClick={() => api.reopenClosedTab()}>
                    <RotateCcw size={12} aria-hidden />
                    <span>Reopen closed</span>
                  </button>
                )}
                <button type="button" className="sp-head-action" onClick={() => api.navigate(tabId, 'orbit://history')}>
                  All history
                </button>
              </div>
            </div>
            {items.length === 0 ? (
              <div className="sp-empty-inline">
                <Clock size={14} aria-hidden />
                <span>Recently closed tabs and visited pages appear here.</span>
              </div>
            ) : (
              <ul className="sp-recent-list">
                {items.map((item) => (
                  <li key={`${item.closed ? 'c' : 'h'}:${item.url}`}>
                    <button
                      type="button"
                      className="sp-recent-row"
                      title={item.url}
                      onClick={(e) => openUrl(item.url, e)}
                      onAuxClick={(e) => e.button === 1 && openUrl(item.url, e)}
                    >
                      <span className="sp-recent-icon">
                        <SiteGlyph favicon={item.favicon} label={item.title || hostOf(item.url)} />
                      </span>
                      <span className="sp-recent-title">{item.title || hostOf(item.url)}</span>
                      <span className="sp-recent-host">{hostOf(item.url)}</span>
                      {item.closed ? (
                        <span className="sp-recent-tag">Closed</span>
                      ) : (
                        item.time && <span className="sp-recent-time">{relativeTime(item.time)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      }

      case 'bookmarks':
        return (
          <section className="sp-widget sp-surface-card sp-bookmarks-widget" aria-label="Bookmarks">
            <div className="sp-section-head">
              <span className="sp-section-title">
                <BookmarkIcon size={13} aria-hidden />
                <span>Bookmarks</span>
              </span>
              <button type="button" className="sp-head-action" onClick={() => api.navigate(tabId, 'orbit://bookmarks')}>
                Manage
              </button>
            </div>
            {data.bookmarks.length === 0 ? (
              <div className="sp-empty-inline">
                <span>
                  Press <kbd>Ctrl D</kbd> on any page to pin a bookmark here.
                </span>
              </div>
            ) : (
              <nav className="sp-bm-row" aria-label="Saved bookmarks">
                {data.bookmarks.slice(0, 10).map((b) => {
                  const name = b.title || hostOf(b.url)
                  return (
                    <button
                      key={b.url}
                      type="button"
                      className="sp-bm-pill"
                      title={b.url}
                      onClick={(e) => openUrl(b.url, e)}
                      onAuxClick={(e) => e.button === 1 && openUrl(b.url, e)}
                    >
                      <span className="sp-bm-icon">
                        <SiteGlyph favicon={b.favicon} label={name} />
                      </span>
                      <span className="sp-bm-name">{name}</span>
                    </button>
                  )
                })}
              </nav>
            )}
          </section>
        )

      case 'focus-note':
        return (
          <section className="sp-widget sp-surface-card sp-note-widget" aria-label="Focus note">
            <div className="sp-section-head">
              <span className="sp-section-title">
                <NotebookPen size={13} aria-hidden />
                <span>What are you studying today?</span>
              </span>
              {noteDraft && (
                <button
                  type="button"
                  className="sp-head-action"
                  aria-label="Clear focus note"
                  onClick={() => {
                    setNoteDraft('')
                    patchStart({ focusNote: '' })
                  }}
                >
                  <X size={12} aria-hidden />
                  <span>Clear</span>
                </button>
              )}
            </div>
            <textarea
              className="sp-note-input"
              rows={3}
              maxLength={START_PAGE_LIMITS.maxFocusNote}
              placeholder="Write your main goal, chapter, or next step…"
              aria-label="What are you studying today?"
              value={noteDraft}
              onChange={(e) => handleNoteChange(e.target.value)}
              onBlur={flushNote}
            />
          </section>
        )

      case 'quote':
        return (
          <section className="sp-widget sp-quote-widget" aria-label="Daily quote">
            <Quote size={14} className="sp-quote-mark" aria-hidden />
            <blockquote className="sp-quote-text">“{quote.text}”</blockquote>
            <cite className="sp-quote-author">— {quote.author}</cite>
          </section>
        )
    }
  }

  return (
    <div
      className={`sp-root layout-${config.layout} density-${config.density}`}
      data-bg={config.background}
      data-has-photo={hasPhoto ? 'true' : undefined}
      data-paused={pageHidden ? 'true' : undefined}
      style={
        {
          '--sp-dim': `${config.backgroundDim / 100}`,
          '--sp-blur': `${config.backgroundBlur}px`
        } as React.CSSProperties
      }
    >
      {/* Background layer */}
      {config.background === 'ambient' && (
        <div className="sp-ambient" aria-hidden>
          <span className="sp-blob sp-blob-1" />
          <span className="sp-blob sp-blob-2" />
          <span className="sp-blob sp-blob-3" />
        </div>
      )}
      {hasPhoto && bgDataUrl && (
        <div className="sp-photo-wrap" aria-hidden>
          <img className="sp-photo-img" src={bgDataUrl} alt="" decoding="async" />
          <div className="sp-photo-scrim" />
        </div>
      )}

      {/* Scrollable foreground */}
      <div className="sp-scroll">
        <div className="sp-container">
          <div className={`sp-widgets ${config.layout === 'wide' ? 'wide' : 'centered'}`}>
            {enabledWidgets.map((w) => {
              const fullIdx = config.widgets.findIndex((item) => item.id === w.id)
              const isHero = w.id === 'clock' || w.id === 'search' || w.id === 'quick-links' || w.id === 'quote'
              return (
                <div
                  key={w.id}
                  className={`sp-widget-slot ${isHero ? 'full' : ''} ${dragWidgetIdx === fullIdx ? 'dragging' : ''}`}
                  draggable={drawerOpen}
                  onDragStart={() => drawerOpen && setDragWidgetIdx(fullIdx)}
                  onDragOver={(e) => {
                    if (drawerOpen) e.preventDefault()
                  }}
                  onDrop={() => drawerOpen && handleWidgetDrop(w.id)}
                  onDragEnd={() => setDragWidgetIdx(null)}
                >
                  {renderWidget(w.id)}
                </div>
              )
            })}
          </div>

          <FirstRunImportBanner />

          <footer className="sp-footer">
            <p className="start-hint">
              <kbd>Ctrl L</kbd> address bar · <kbd>Ctrl K</kbd> command bar · <kbd>Ctrl T</kbd> new tab ·{' '}
              <kbd>Ctrl Shift T</kbd> reopen closed
            </p>
            <p className="start-links">
              <button type="button" onClick={() => api.navigate(tabId, 'orbit://history')}>
                History
              </button>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => api.navigate(tabId, 'orbit://bookmarks')}>
                Bookmarks
              </button>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => api.navigate(tabId, 'orbit://settings')}>
                Settings
              </button>
            </p>
          </footer>
        </div>
      </div>

      {/* Subtle bottom-right Customize button */}
      <button
        type="button"
        className={`sp-customize-btn ${drawerOpen ? 'on' : ''}`}
        aria-label="Customize start page"
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen((v) => !v)}
      >
        <SlidersHorizontal size={14} aria-hidden />
        <span>Customize</span>
      </button>

      <StartCustomizeDrawer
        open={drawerOpen}
        config={config}
        hasCustomImage={!!config.backgroundImage}
        bgError={bgError}
        onClose={() => setDrawerOpen(false)}
        onPatch={patchStart}
        onChooseImage={() => void handleChooseImage()}
        onRemoveImage={() => void handleRemoveImage()}
        onOpenAppearance={() => {
          if (onOpenAppearance) onOpenAppearance()
          else api.navigate(tabId, 'orbit://settings')
        }}
      />
    </div>
  )
}
