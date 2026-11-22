import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronsRight, Folder, Globe, X } from 'lucide-react'
import type { Bookmark, MenuEntry, MenuPopupHeader, TabInfo } from '@shared/types'
import {
  buildBookmarkBarEntries,
  extractDroppedBookmark,
  reorderBookmarkBarEntries,
  type BookmarkBarEntry
} from '@shared/bookmarks'
import { displayUrl } from '@shared/url'

const api = window.veyra
const REORDER_MIME = 'application/x-orbit-bm-reorder'
const CUSTOM_BM_MIME = 'application/x-orbit-bookmark'
const OVERFLOW_BTN_W = 28
const ITEM_GAP = 2

type BarMenuState =
  | { kind: 'folder'; name: string; x: number; y: number }
  | { kind: 'overflow'; subFolder: string | null; x: number; y: number }
  | { kind: 'context'; bookmark: Bookmark; x: number; y: number }

interface EditState {
  url: string
  title: string
  folder: string
}

function BookmarkFavicon({ favicon }: { favicon?: string }): React.JSX.Element {
  const [broken, setBroken] = useState<string | null>(null)
  if (favicon && broken !== favicon) {
    return <img className="bm-fav" src={favicon} alt="" onError={() => setBroken(favicon)} />
  }
  return <Globe className="bm-fav-glyph" size={13} strokeWidth={1.7} aria-hidden />
}

function bookmarkLabel(b: Bookmark): string {
  return b.title.trim() || displayUrl(b.url) || b.url
}

interface Props {
  tab?: TabInfo
  inCompactPanel?: boolean
  onPointerEdge?: (inside: boolean) => void
  onEditingChange?: (editing: boolean) => void
}

export function BookmarkBar({ tab, inCompactPanel = false, onPointerEdge, onEditingChange }: Props): React.JSX.Element {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [visibleCount, setVisibleCount] = useState<number>(Infinity)
  const [openMenu, setOpenMenu] = useState<BarMenuState | null>(null)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)

  const trackRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const openMenuRef = useRef<BarMenuState | null>(null)
  const lastClosedRef = useRef<{ key: string; at: number }>({ key: '', at: 0 })
  openMenuRef.current = openMenu

  const load = useCallback((): void => {
    void api.bookmarks().then(setBookmarks)
  }, [])

  useEffect(() => {
    load()
    return api.onDataChanged(load)
  }, [load])

  useEffect(() => {
    onEditingChange?.(editing !== null)
  }, [editing, onEditingChange])

  const entries = useMemo(() => buildBookmarkBarEntries(bookmarks), [bookmarks])
  const folderNames = useMemo(() => {
    const set = new Set<string>()
    for (const b of bookmarks) {
      if (b.folder) set.add(b.folder)
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [bookmarks])

  const recomputeOverflow = useCallback((): void => {
    const track = trackRef.current
    const measure = measureRef.current
    if (!track || !measure) return
    const avail = track.clientWidth
    if (avail <= 0) return

    const children = Array.from(measure.children) as HTMLElement[]
    if (children.length === 0) {
      setVisibleCount(0)
      return
    }

    const widths = children.map((el) => Math.ceil(el.getBoundingClientRect().width))
    const totalW = widths.reduce((sum, w, i) => sum + w + (i > 0 ? ITEM_GAP : 0), 0)
    if (totalW <= avail) {
      setVisibleCount(children.length)
      return
    }

    const budget = Math.max(0, avail - OVERFLOW_BTN_W - ITEM_GAP)
    let used = 0
    let fit = 0
    for (let i = 0; i < widths.length; i++) {
      const next = used + widths[i] + (i > 0 ? ITEM_GAP : 0)
      if (next <= budget) {
        used = next
        fit++
      } else {
        break
      }
    }
    setVisibleCount(fit)
  }, [])

  useLayoutEffect(() => {
    recomputeOverflow()
    const track = trackRef.current
    if (!track) return
    const ro = new ResizeObserver(recomputeOverflow)
    ro.observe(track)
    return () => ro.disconnect()
  }, [entries, editing, recomputeOverflow])

  const openBookmark = useCallback(
    (url: string, newTab: boolean): void => {
      if (newTab || !tab) api.newTab(url)
      else api.navigate(tab.id, url)
    },
    [tab]
  )

  const visibleEntries = useMemo(
    () => (Number.isFinite(visibleCount) ? entries.slice(0, visibleCount) : entries),
    [entries, visibleCount]
  )
  const overflowEntries = useMemo(
    () => (Number.isFinite(visibleCount) ? entries.slice(visibleCount) : []),
    [entries, visibleCount]
  )

  // Sync open folder / overflow / context menu to the shared floating MenuPopup.
  useEffect(() => {
    if (!openMenu) return
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--tint').trim() || '#b3492b'

    let items: MenuEntry[] = []
    let header: MenuPopupHeader | undefined

    if (openMenu.kind === 'context') {
      items = [
        { kind: 'item', id: 'bmbar:ctx:new-tab', label: 'Open in new tab' },
        { kind: 'item', id: 'bmbar:ctx:edit', label: 'Edit…' },
        { kind: 'separator' },
        { kind: 'item', id: 'bmbar:ctx:delete', label: 'Delete' }
      ]
    } else if (openMenu.kind === 'folder') {
      const folder = entries.find((e) => e.kind === 'folder' && e.name === openMenu.name)
      const list = folder && folder.kind === 'folder' ? folder.items : []
      items =
        list.length > 0
          ? list.map((b, i) => ({ kind: 'item' as const, id: `bmbar:folder-item:${i}`, label: bookmarkLabel(b) }))
          : [{ kind: 'item', id: 'bmbar:empty', label: 'Empty folder', disabled: true }]
    } else if (openMenu.kind === 'overflow') {
      if (openMenu.subFolder) {
        const folder = overflowEntries.find((e) => e.kind === 'folder' && e.name === openMenu.subFolder)
        const list = folder && folder.kind === 'folder' ? folder.items : []
        header = { label: openMenu.subFolder, backId: 'submenu-back' }
        items =
          list.length > 0
            ? list.map((b, i) => ({ kind: 'item' as const, id: `bmbar:overflow-sub:${i}`, label: bookmarkLabel(b) }))
            : [{ kind: 'item', id: 'bmbar:empty', label: 'Empty folder', disabled: true }]
      } else {
        items = overflowEntries.map((entry, i): MenuEntry =>
          entry.kind === 'folder'
            ? { kind: 'item', id: `submenu:bmbar-folder:${entry.name}`, label: entry.name, hasSubmenu: true }
            : { kind: 'item', id: `bmbar:overflow-item:${i}`, label: bookmarkLabel(entry.bookmark) }
        )
      }
    }

    api.menu.open({
      x: openMenu.x,
      y: openMenu.y,
      dark,
      accent,
      items,
      initialActive: -1,
      header
    })
  }, [openMenu, entries, overflowEntries])

  const liveRef = useRef({ entries, overflowEntries, openBookmark })
  liveRef.current = { entries, overflowEntries, openBookmark }

  useEffect(() => {
    const offPicked = api.menu.onPicked((id) => {
      const cur = openMenuRef.current
      if (!cur) return

      if (id.startsWith('submenu:bmbar-folder:') && cur.kind === 'overflow') {
        const name = id.slice('submenu:bmbar-folder:'.length)
        setOpenMenu({ ...cur, subFolder: name })
        return
      }
      if (id === 'submenu-back' && cur.kind === 'overflow') {
        setOpenMenu({ ...cur, subFolder: null })
        return
      }
      if (!id.startsWith('bmbar:')) return

      setOpenMenu(null)
      if (cur.kind === 'context') {
        if (id === 'bmbar:ctx:new-tab') {
          api.newTab(cur.bookmark.url)
        } else if (id === 'bmbar:ctx:edit') {
          setEditing({
            url: cur.bookmark.url,
            title: cur.bookmark.title,
            folder: cur.bookmark.folder ?? ''
          })
        } else if (id === 'bmbar:ctx:delete') {
          void api.removeBookmark(cur.bookmark.url)
        }
        return
      }

      if (cur.kind === 'folder' && id.startsWith('bmbar:folder-item:')) {
        const idx = Number(id.slice('bmbar:folder-item:'.length))
        const folder = liveRef.current.entries.find((e) => e.kind === 'folder' && e.name === cur.name)
        const target = folder && folder.kind === 'folder' ? folder.items[idx] : undefined
        if (target) liveRef.current.openBookmark(target.url, false)
        return
      }

      if (cur.kind === 'overflow' && id.startsWith('bmbar:overflow-sub:')) {
        const idx = Number(id.slice('bmbar:overflow-sub:'.length))
        const folder = liveRef.current.overflowEntries.find((e) => e.kind === 'folder' && e.name === cur.subFolder)
        const target = folder && folder.kind === 'folder' ? folder.items[idx] : undefined
        if (target) liveRef.current.openBookmark(target.url, false)
        return
      }

      if (cur.kind === 'overflow' && id.startsWith('bmbar:overflow-item:')) {
        const idx = Number(id.slice('bmbar:overflow-item:'.length))
        const entry = liveRef.current.overflowEntries[idx]
        if (entry?.kind === 'bookmark') liveRef.current.openBookmark(entry.bookmark.url, false)
      }
    })

    const offClosed = api.menu.onClosed(() => {
      const cur = openMenuRef.current
      if (!cur) return
      const key = cur.kind === 'folder' ? `folder:${cur.name}` : cur.kind === 'overflow' ? 'overflow' : 'context'
      lastClosedRef.current = { key, at: Date.now() }
      setOpenMenu(null)
    })

    return () => {
      offPicked()
      offClosed()
    }
  }, [])

  const toggleAnchoredMenu = (key: string, next: BarMenuState): void => {
    if (lastClosedRef.current.key === key && Date.now() - lastClosedRef.current.at < 260) {
      lastClosedRef.current = { key: '', at: 0 }
      return
    }
    if (
      (openMenu?.kind === 'overflow' && key === 'overflow') ||
      (openMenu?.kind === 'folder' && key === `folder:${openMenu.name}`)
    ) {
      setOpenMenu(null)
      api.menu.close()
      return
    }
    setOpenMenu(next)
  }

  const handleBarDragOver = (e: React.DragEvent<HTMLElement>): void => {
    const types = Array.from(e.dataTransfer.types)
    const canDrop =
      dragKey !== null ||
      types.includes(REORDER_MIME) ||
      types.includes(CUSTOM_BM_MIME) ||
      types.includes('text/uri-list') ||
      types.includes('text/plain') ||
      types.includes('text/html')
    if (!canDrop) return
    e.preventDefault()
    e.dataTransfer.dropEffect = dragKey !== null ? 'move' : 'copy'
    if (dragKey === null && !dropActive) setDropActive(true)
  }

  const handleBarDrop = (e: React.DragEvent<HTMLElement>, targetKey?: string): void => {
    e.preventDefault()
    e.stopPropagation()
    const internalKey = dragKey || e.dataTransfer.getData(REORDER_MIME)
    setDragKey(null)
    setDragOverKey(null)
    setDropActive(false)

    if (internalKey && targetKey && internalKey !== targetKey) {
      const updates = reorderBookmarkBarEntries(bookmarks, internalKey, targetKey)
      if (updates) void api.reorderBookmarks(updates)
      return
    }
    if (internalKey) return

    const dropped = extractDroppedBookmark({
      customJson: e.dataTransfer.getData(CUSTOM_BM_MIME),
      uriList: e.dataTransfer.getData('text/uri-list'),
      html: e.dataTransfer.getData('text/html'),
      plain: e.dataTransfer.getData('text/plain')
    })
    if (dropped) {
      void api.addBookmark(dropped.url, dropped.title)
    }
  }

  const saveEdit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!editing) return
    await api.renameBookmark(editing.url, editing.title, editing.folder)
    setEditing(null)
  }

  const renderEntry = (entry: BookmarkBarEntry, isMeasure = false): React.JSX.Element => {
    if (entry.kind === 'folder') {
      const isOpen = !isMeasure && openMenu?.kind === 'folder' && openMenu.name === entry.name
      return (
        <button
          key={entry.key}
          type="button"
          className={`bm-item bm-folder ${isOpen ? 'open' : ''} ${!isMeasure && dragOverKey === entry.key ? 'drag-over' : ''}`}
          title={`${entry.name} (${entry.items.length})`}
          tabIndex={isMeasure ? -1 : 0}
          aria-hidden={isMeasure || undefined}
          draggable={!isMeasure}
          onDragStart={
            isMeasure
              ? undefined
              : (e) => {
                  e.dataTransfer.setData(REORDER_MIME, entry.key)
                  e.dataTransfer.effectAllowed = 'move'
                  setDragKey(entry.key)
                }
          }
          onDragEnd={
            isMeasure
              ? undefined
              : () => {
                  setDragKey(null)
                  setDragOverKey(null)
                }
          }
          onDragOver={
            isMeasure
              ? undefined
              : (e) => {
                  e.preventDefault()
                  if (dragKey && dragKey !== entry.key) setDragOverKey(entry.key)
                }
          }
          onDrop={isMeasure ? undefined : (e) => handleBarDrop(e, entry.key)}
          onMouseDown={
            isMeasure
              ? undefined
              : (e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  toggleAnchoredMenu(`folder:${entry.name}`, {
                    kind: 'folder',
                    name: entry.name,
                    x: r.left,
                    y: r.bottom + 4
                  })
                }
          }
        >
          <Folder size={13} strokeWidth={1.8} className="bm-folder-icon" aria-hidden />
          <span className="bm-label">{entry.name}</span>
          <ChevronDown size={11} strokeWidth={2} className="bm-caret" aria-hidden />
        </button>
      )
    }

    const b = entry.bookmark
    return (
      <button
        key={entry.key}
        type="button"
        className={`bm-item ${!isMeasure && dragOverKey === entry.key ? 'drag-over' : ''} ${!isMeasure && dragKey === entry.key ? 'dragging' : ''}`}
        title={`${bookmarkLabel(b)}\n${displayUrl(b.url)}`}
        tabIndex={isMeasure ? -1 : 0}
        aria-hidden={isMeasure || undefined}
        draggable={!isMeasure}
        onDragStart={
          isMeasure
            ? undefined
            : (e) => {
                e.dataTransfer.setData(REORDER_MIME, entry.key)
                e.dataTransfer.setData('text/uri-list', b.url)
                e.dataTransfer.setData('text/plain', b.url)
                e.dataTransfer.effectAllowed = 'move'
                setDragKey(entry.key)
              }
        }
        onDragEnd={
          isMeasure
            ? undefined
            : () => {
                setDragKey(null)
                setDragOverKey(null)
              }
        }
        onDragOver={
          isMeasure
            ? undefined
            : (e) => {
                e.preventDefault()
                if (dragKey && dragKey !== entry.key) setDragOverKey(entry.key)
              }
        }
        onDrop={isMeasure ? undefined : (e) => handleBarDrop(e, entry.key)}
        onClick={
          isMeasure
            ? undefined
            : (e) => {
                openBookmark(b.url, e.ctrlKey || e.metaKey)
              }
        }
        onAuxClick={
          isMeasure
            ? undefined
            : (e) => {
                if (e.button === 1) {
                  e.preventDefault()
                  openBookmark(b.url, true)
                }
              }
        }
        onContextMenu={
          isMeasure
            ? undefined
            : (e) => {
                e.preventDefault()
                setOpenMenu({
                  kind: 'context',
                  bookmark: b,
                  x: e.clientX,
                  y: e.clientY + 4
                })
              }
        }
      >
        <BookmarkFavicon favicon={b.favicon} />
        <span className="bm-label">{bookmarkLabel(b)}</span>
      </button>
    )
  }

  return (
    <nav
      className={`bm-bar ${inCompactPanel ? 'compact' : ''} ${dropActive ? 'drop-target' : ''}`}
      aria-label="Bookmark bar"
      onMouseEnter={() => onPointerEdge?.(true)}
      onMouseLeave={() => onPointerEdge?.(false)}
      onDragOver={handleBarDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDropActive(false)
          setDragOverKey(null)
        }
      }}
      onDrop={(e) => handleBarDrop(e)}
    >
      {editing ? (
        <form
          className="bm-edit-form"
          onSubmit={(e) => void saveEdit(e)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(null)
          }}
        >
          <input
            className="bm-edit-input"
            autoFocus
            type="text"
            placeholder="Title"
            aria-label="Bookmark title"
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
          />
          <input
            className="bm-edit-input bm-edit-folder"
            type="text"
            list="bm-folder-suggestions"
            placeholder="Folder (optional)"
            aria-label="Bookmark folder"
            value={editing.folder}
            onChange={(e) => setEditing({ ...editing, folder: e.target.value })}
          />
          <datalist id="bm-folder-suggestions">
            {folderNames.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <button type="submit" className="dl-btn bm-edit-save" aria-label="Save bookmark" title="Save">
            <Check size={13} />
          </button>
          <button type="button" className="dl-btn" aria-label="Cancel editing" title="Cancel" onClick={() => setEditing(null)}>
            <X size={13} />
          </button>
        </form>
      ) : (
        <>
          <div className="bm-track" ref={trackRef}>
            {entries.length === 0 ? (
              <span className="bm-empty">Drag links or the site icon here to add bookmarks</span>
            ) : (
              visibleEntries.map((entry) => renderEntry(entry, false))
            )}
          </div>

          {overflowEntries.length > 0 && (
            <button
              type="button"
              className={`bm-item bm-overflow ${openMenu?.kind === 'overflow' ? 'open' : ''}`}
              aria-label={`More bookmarks (${overflowEntries.length})`}
              aria-haspopup="menu"
              aria-expanded={openMenu?.kind === 'overflow'}
              title={`More bookmarks (${overflowEntries.length})`}
              onMouseDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                toggleAnchoredMenu('overflow', {
                  kind: 'overflow',
                  subFolder: null,
                  x: r.left,
                  y: r.bottom + 4
                })
              }}
            >
              <ChevronsRight size={14} strokeWidth={1.9} aria-hidden />
            </button>
          )}

          {/* Off-flow hidden measurement row to compute overflow cleanly without layout flicker. */}
          <div className="bm-measure" ref={measureRef} aria-hidden>
            {entries.map((entry) => renderEntry(entry, true))}
          </div>
        </>
      )}
    </nav>
  )
}
