import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AppWindow,
  Bookmark,
  Clock,
  Code2,
  Columns2,
  CornerDownLeft,
  Download,
  Globe,
  Layers,
  Maximize2,
  Monitor,
  Moon,
  PanelLeftClose,
  Pin,
  Plus,
  Printer,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
  Ungroup,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from 'lucide-react'
import type { PaletteItem, PaletteItemIcon, PaletteMode } from '@shared/palette'
import { searchTerms } from '@shared/suggest'

const ICONS: Record<PaletteItemIcon, LucideIcon> = {
  search: Search,
  globe: Globe,
  tab: AppWindow,
  bookmark: Bookmark,
  history: Clock,
  plus: Plus,
  split: Columns2,
  unsplit: Ungroup,
  compact: PanelLeftClose,
  workspace: Layers,
  settings: Settings,
  downloads: Download,
  print: Printer,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
  'zoom-reset': RotateCcw,
  reload: RotateCw,
  reopen: RotateCcw,
  pin: Pin,
  mute: VolumeX,
  sleep: Moon,
  close: X,
  trash: Trash2,
  find: Search,
  code: Code2,
  fullscreen: Maximize2,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  star: Star
}

/** Highlights matched search terms inside palette labels and subtitles. */
function Marked({ text, terms }: { text: string; terms: string[] }): React.JSX.Element {
  if (!terms.length) return <>{text}</>
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean)
  if (!escaped.length) return <>{text}</>
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="pal-mark">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}

/**
 * Floating acrylic Ctrl+K command palette window (Arc + Veyra Study style).
 * Never navigates itself and holds no privileged APIs: sends only typed text or
 * validated item IDs back to the main process.
 */
export function PaletteWindow(): React.JSX.Element {
  const [mode, setMode] = useState<PaletteMode>('command')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<PaletteItem[]>([])
  const [active, setActive] = useState(0)
  const [resultQuery, setResultQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const palette = window.veyraPalette!

  useEffect(() => {
    document.documentElement.classList.add('palette-window')
    const offOpen = palette.onOpen((init) => {
      const root = document.documentElement
      root.classList.toggle('dark', init.dark)
      if (init.accent) root.style.setProperty('--pal-accent', init.accent)
      setMode(init.mode)
      setQuery('')
      setResultQuery('')
      setItems(init.items)
      setActive(0)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    })
    const offResults = palette.onResults((payload) => {
      setResultQuery(payload.query)
      setItems(payload.items)
      setActive(0)
    })
    palette.ready()
    return () => {
      offOpen()
      offResults()
      document.documentElement.classList.remove('palette-window')
    }
  }, [palette])

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const h = Math.ceil(el.getBoundingClientRect().height)
    if (h > 0) palette.size(h)
  }, [items, mode, palette])

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const terms = useMemo(() => searchTerms(query), [query])

  const runSelected = (openInNewTab: boolean): void => {
    const item = items[active]
    // If results lag behind the latest keystrokes, let main safely resolve the typed text.
    if (query.trim() && resultQuery !== query.trim()) {
      palette.submitText(query, openInNewTab || mode === 'new-tab')
      return
    }
    if (item) {
      palette.pick(item.id, openInNewTab || mode === 'new-tab')
    } else if (query.trim()) {
      palette.submitText(query, openInNewTab || mode === 'new-tab')
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      palette.dismiss()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      palette.dismiss()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (items.length ? (i + 1) % items.length : 0))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      setActive(Math.max(0, items.length - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      runSelected(mod)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
    }
  }

  let lastGroup = ''
  return (
    <div ref={boxRef} className="pal-win" role="dialog" aria-label="Command bar" onKeyDown={onKeyDown}>
      <div className="pal-input">
        <Search size={17} className="pal-search-icon" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          spellCheck={false}
          autoFocus
          placeholder={
            mode === 'new-tab'
              ? 'Search, enter a web address, or run a command (new tab)…'
              : 'Search tabs, bookmarks, history, or type a command…'
          }
          aria-label="Command bar search"
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls="pal-list"
          aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined}
          onChange={(e) => {
            const v = e.target.value
            setQuery(v)
            palette.query(v)
          }}
        />
        {mode === 'new-tab' && <span className="pal-mode-pill">New tab</span>}
        <kbd>Esc</kbd>
      </div>

      <div className="pal-list" id="pal-list" role="listbox" ref={listRef}>
        {items.map((it, i) => {
          const head = it.group !== lastGroup ? it.group : null
          lastGroup = it.group
          const Icon = ICONS[it.icon] ?? Search
          const isSelected = i === active
          return (
            <div key={it.id}>
              {head && <div className="pal-group">{head}</div>}
              <button
                type="button"
                id={`pal-${it.id}`}
                data-i={i}
                role="option"
                aria-selected={isSelected}
                className={`pal-row ${isSelected ? 'active' : ''}`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={(e) => palette.pick(it.id, e.ctrlKey || e.metaKey || mode === 'new-tab')}
              >
                <span className="pal-icon" aria-hidden>
                  <Icon size={15} strokeWidth={1.9} />
                </span>
                <span className="pal-text">
                  <span className="pal-label">
                    {it.kind === 'search' ? it.label : <Marked text={it.label} terms={terms} />}
                  </span>
                  {it.sub && (
                    <span className="pal-sub">
                      <Marked text={it.sub} terms={terms} />
                    </span>
                  )}
                </span>
                {it.badge && <span className="pal-badge">{it.badge}</span>}
                {it.keys && <span className="pal-keys">{it.keys}</span>}
                {isSelected && <CornerDownLeft size={13} className="pal-enter" aria-hidden />}
              </button>
            </div>
          )
        })}
        {items.length === 0 && <div className="pal-empty">Type to search the web, tabs, or commands.</div>}
      </div>

      <div className="pal-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>Enter</kbd> {mode === 'new-tab' ? 'open in new tab' : 'open'}
        </span>
        <span>
          <kbd>Ctrl</kbd>
          <kbd>Enter</kbd> new tab
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
    </div>
  )
}
