import { useEffect, useRef, useState } from 'react'
import { AppWindow, Bookmark, Clock, Globe, Lock, Search, Star, TriangleAlert } from 'lucide-react'
import type { Suggestion, TabInfo } from '@shared/types'
import { displayUrl, isInternalUrl, resolveOmniboxSync } from '@shared/url'

const api = window.veyra

/**
 * The address bar. While its suggestions are open, the page (a native view that would cover
 * them) is swapped for a picture of itself, passed up through onPageShot.
 */
export function Omnibox({
  tab,
  onPageShot,
  onEditingChange,
  onOpenChange,
  useOverlay = true,
  showStar = true
}: {
  tab?: TabInfo
  onPageShot: (shots: Record<number, string> | null) => void
  onEditingChange?: (editing: boolean) => void
  onOpenChange?: (open: boolean) => void
  useOverlay?: boolean
  showStar?: boolean
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [list, setList] = useState<Suggestion[]>([])
  const [sel, setSel] = useState(0)
  /** Whether the dropdown should be open; requests that come back late check it. */
  const wantOverlay = useRef(false)
  const overlayOn = useRef(false)
  const query = useRef(0)
  const prevTabId = useRef<number | undefined>(tab?.id)

  const url = tab?.error?.url || tab?.url || ''
  // While you type on the same tab, the page changing underneath doesn't overwrite what you typed.
  // Switching to another tab always exits editing and displays the new tab's own URL.
  useEffect(() => {
    const sync = resolveOmniboxSync({
      prevTabId: prevTabId.current,
      nextTabId: tab?.id,
      url,
      editing
    })
    prevTabId.current = tab?.id
    if (sync.resetEditing) {
      setEditing(false)
      query.current++
      setList([])
      if (document.activeElement === input.current) {
        input.current?.blur()
      }
    }
    if (sync.nextText !== null) {
      setText(sync.nextText)
    }
  }, [url, editing, tab?.id])

  useEffect(() => {
    onEditingChange?.(editing)
  }, [editing, onEditingChange])

  useEffect(
    () =>
      api.onFocusOmnibox(() => {
        requestAnimationFrame(() => {
          input.current?.focus()
          input.current?.select()
        })
      }),
    []
  )

  const open = editing && list.length > 0

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  // Take the page out (showing its picture) while the list is open; put it back after.
  useEffect(() => {
    if (!useOverlay) return
    wantOverlay.current = open
    if (open && !overlayOn.current) {
      overlayOn.current = true
      void api.overlay(true).then((shots) => {
        if (!wantOverlay.current) return
        onPageShot(shots)
        // Two frames: the picture is on screen before the real page goes.
        requestAnimationFrame(() => requestAnimationFrame(() => wantOverlay.current && api.hidePageForOverlay()))
      })
    } else if (!open && overlayOn.current) {
      overlayOn.current = false
      void api.overlay(false).then(() => onPageShot(null))
    }
  }, [open, onPageShot, useOverlay])

  const lookup = (value: string): void => {
    const n = ++query.current
    if (!value.trim()) {
      setList([])
      return
    }
    void api.suggest(value).then((s) => {
      if (n !== query.current) return
      setList(s)
      setSel(0)
    })
  }

  const close = (): void => {
    query.current++
    setList([])
  }

  const pick = (s: Suggestion | undefined): void => {
    if (!tab) return
    if (!s) {
      if (text.trim()) api.navigate(tab.id, text)
    } else if (s.kind === 'tab') api.activate(s.tabId)
    else api.navigate(tab.id, s.url)
    close()
    input.current?.blur()
  }

  // A padlock only for a page that actually loaded over https; a refused certificate gets the warning.
  const certError = !!tab?.error && /CERT|SSL/.test(tab.error.description)
  const secure = url.startsWith('https://') && !tab?.error
  const insecure = certError || (url.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url))
  const canStar = !!tab && /^https?:/.test(url) && !tab.error

  return (
    <div className={`omni-wrap ${open ? 'open' : ''}`}>
      <form
        className={`omni ${editing ? 'editing' : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          pick(list[sel])
        }}
      >
        <span
          className={`omni-icon ${insecure ? 'warn' : ''} ${canStar && !editing ? 'draggable' : ''}`}
          draggable={canStar && !editing}
          title={
            canStar && !editing
              ? `${secure ? 'Connection is secure' : insecure ? 'Connection is not secure' : 'Site info'} · Drag to bookmark bar`
              : secure
                ? 'Connection is secure'
                : insecure
                  ? 'Connection is not secure'
                  : undefined
          }
          onDragStart={(e) => {
            if (!canStar || !tab) return
            e.dataTransfer.setData(
              'application/x-orbit-bookmark',
              JSON.stringify({ url, title: tab.title || displayUrl(url) })
            )
            e.dataTransfer.setData('text/uri-list', url)
            e.dataTransfer.setData('text/plain', url)
            e.dataTransfer.effectAllowed = 'copyLink'
          }}
        >
          {editing || !url ? <Search size={14} /> : secure ? <Lock size={13} /> : insecure ? <TriangleAlert size={14} /> : isInternalUrl(url) ? <AppWindow size={14} /> : <Search size={14} />}
        </span>
        <input
          ref={input}
          value={text}
          spellCheck={false}
          placeholder="Search or type a web address"
          aria-label="Address and search bar"
          role="combobox"
          aria-expanded={open}
          aria-controls="omni-list"
          aria-activedescendant={open ? `omni-${sel}` : undefined}
          onChange={(e) => {
            setText(e.target.value)
            lookup(e.target.value)
          }}
          onFocus={(e) => {
            setEditing(true)
            setText(url)
            const el = e.currentTarget
            requestAnimationFrame(() => {
              if (document.activeElement === el) el.select()
            })
          }}
          onBlur={() => {
            setEditing(false)
            close()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (open) close()
              else {
                setText(url)
                e.currentTarget.blur()
              }
              e.preventDefault()
            } else if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              setSel((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length)
            }
          }}
        />
        {showStar && canStar && !editing && (
          <button
            type="button"
            className={`omni-star ${tab.bookmarked ? 'on' : ''}`}
            aria-label={tab.bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            aria-pressed={tab.bookmarked}
            title={tab.bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
            onClick={() => api.toggleBookmark()}
          >
            <Star size={14} fill={tab.bookmarked ? 'currentColor' : 'none'} />
          </button>
        )}
      </form>

      {open && (
        <ul className="omni-list" id="omni-list" role="listbox">
          {list.map((s, i) => (
            <li
              key={`${s.kind}:${s.url}`}
              id={`omni-${i}`}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? 'sel' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(s)}
            >
              <Row s={s} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ s }: { s: Suggestion }): React.JSX.Element {
  if (s.kind === 'search')
    return (
      <>
        <Search size={15} className="omni-row-icon" />
        <span className="omni-row-main">{s.text}</span>
        <span className="omni-row-side">Search</span>
      </>
    )
  if (s.kind === 'url')
    return (
      <>
        <Globe size={15} className="omni-row-icon" />
        <span className="omni-row-main">{displayUrl(s.url)}</span>
        <span className="omni-row-side">Go to site</span>
      </>
    )
  const Icon = s.kind === 'tab' ? AppWindow : s.bookmarked ? Bookmark : Clock
  return (
    <>
      <Icon size={15} className="omni-row-icon" />
      <span className="omni-row-main">{s.title}</span>
      <span className="omni-row-url">{displayUrl(s.url)}</span>
      {s.kind === 'tab' && <span className="omni-row-side">Switch to tab</span>}
    </>
  )
}
