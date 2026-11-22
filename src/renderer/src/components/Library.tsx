import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Search, Trash2, X } from 'lucide-react'
import type { Bookmark, HistoryEntry } from '@shared/types'
import { displayUrl } from '@shared/url'

const api = window.veyra
const PAGE = 100
const HOUR = 3_600_000

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function dayLabel(t: number): string {
  const d = new Date(t)
  const today = new Date()
  const start = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(today) - start(d)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

/** Opens a link from these pages: here, or in a new tab with the middle button or Ctrl. */
function open(tabId: number, url: string, e: React.MouseEvent): void {
  if (e.button === 1 || e.ctrlKey || e.metaKey) api.newTab(url)
  else api.navigate(tabId, url)
}

function Filter({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }): React.JSX.Element {
  return (
    <label className="lib-search">
      <Search size={15} />
      <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} />
      {value && (
        <button className="icon-btn small" aria-label="Clear search" title="Clear search" onClick={() => onChange('')}>
          <X size={14} />
        </button>
      )}
    </label>
  )
}

export function HistoryPage({ tabId }: { tabId: number }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<HistoryEntry[]>([])
  const [more, setMore] = useState(false)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async (q: string, keep: HistoryEntry[] = []) => {
    const before = keep.length ? keep[keep.length - 1].time : null
    const next = await api.history(q, before)
    setRows([...keep, ...next])
    setMore(next.length >= PAGE)
  }, [])

  useEffect(() => {
    void load(query)
  }, [query, load])
  useEffect(() => api.onDataChanged(() => void load(query)), [query, load])

  const groups = useMemo(() => {
    const out: { day: string; rows: HistoryEntry[] }[] = []
    for (const r of rows) {
      const day = dayLabel(r.time)
      if (out[out.length - 1]?.day !== day) out.push({ day, rows: [] })
      out[out.length - 1].rows.push(r)
    }
    return out
  }, [rows])

  const clear = async (msAgo: number): Promise<void> => {
    setClearing(false)
    await api.clearHistory(msAgo)
  }

  return (
    <div className="lib">
      <header className="lib-head">
        <h1>History</h1>
        <Filter value={query} onChange={setQuery} label="Search history" />
        <div className="lib-actions">
          {clearing ? (
            <div className="lib-clear" role="group" aria-label="Clear history">
              <span>Clear</span>
              <button className="btn" onClick={() => void clear(HOUR)}>
                Last hour
              </button>
              <button className="btn" onClick={() => void clear(24 * HOUR)}>
                Last day
              </button>
              <button className="btn danger" onClick={() => void clear(0)}>
                All history
              </button>
              <button className="icon-btn small" aria-label="Cancel" title="Cancel" onClick={() => setClearing(false)}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => setClearing(true)} disabled={!rows.length && !query}>
              Clear history…
            </button>
          )}
        </div>
      </header>

      {!rows.length && (
        <div className="lib-empty" role="status">
          <h2>{query ? 'No matching history' : 'No history yet'}</h2>
          <p>
            {query
              ? `Nothing in your history matched “${query}”.`
              : 'Pages you visit appear here, grouped by day.'}
          </p>
          {query && (
            <button type="button" className="btn sm" onClick={() => setQuery('')}>
              Clear search
            </button>
          )}
        </div>
      )}

      {groups.map((g) => (
        <section key={g.day} className="lib-group">
          <h2>{g.day}</h2>
          <ul>
            {g.rows.map((r) => (
              <li key={r.id} className="lib-row">
                <time>{new Date(r.time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>
                <button className="lib-link" title={r.url} onClick={(e) => open(tabId, r.url, e)} onAuxClick={(e) => e.button === 1 && open(tabId, r.url, e)}>
                  <span className="lib-title">{r.title || displayUrl(r.url)}</span>
                  <span className="lib-host">{host(r.url)}</span>
                </button>
                <button className="icon-btn small lib-del" aria-label="Remove from history" title="Remove from history" onClick={() => api.deleteHistory(r.id)}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {more && (
        <button className="btn lib-more" onClick={() => void load(query, rows)}>
          Show more
        </button>
      )}
    </div>
  )
}

export function BookmarksPage({ tabId }: { tabId: number }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [all, setAll] = useState<Bookmark[]>([])
  const [editing, setEditing] = useState<{ url: string; title: string } | null>(null)

  const load = useCallback(async () => setAll(await api.bookmarks()), [])
  useEffect(() => {
    void load()
    return api.onDataChanged(() => void load())
  }, [load])

  const q = query.trim().toLowerCase()
  const shown = q ? all.filter((b) => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) : all

  const save = async (): Promise<void> => {
    if (editing) await api.renameBookmark(editing.url, editing.title)
    setEditing(null)
  }

  return (
    <div className="lib">
      <header className="lib-head">
        <h1>Bookmarks</h1>
        <Filter value={query} onChange={setQuery} label="Search bookmarks" />
      </header>

      {!shown.length && (
        <div className="lib-empty" role="status">
          <h2>{q ? 'No matching bookmarks' : 'No bookmarks yet'}</h2>
          <p>
            {q ? (
              `Nothing in your bookmarks matched “${query}”.`
            ) : (
              <>
                Press <kbd>Ctrl D</kbd> or click the star in the address bar to save a page here.
              </>
            )}
          </p>
          {q && (
            <button type="button" className="btn sm" onClick={() => setQuery('')}>
              Clear search
            </button>
          )}
        </div>
      )}

      <ul className="lib-group">
        {shown.map((b) => (
          <li key={b.url} className="lib-row">
            {editing?.url === b.url ? (
              <form
                className="lib-edit"
                onSubmit={(e) => {
                  e.preventDefault()
                  void save()
                }}
              >
                <input autoFocus value={editing.title} onChange={(e) => setEditing({ url: b.url, title: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} aria-label="Bookmark name" />
                <button className="icon-btn small" type="submit" aria-label="Save name" title="Save">
                  <Check size={14} />
                </button>
              </form>
            ) : (
              <button className="lib-link" title={b.url} onClick={(e) => open(tabId, b.url, e)} onAuxClick={(e) => e.button === 1 && open(tabId, b.url, e)}>
                <span className="lib-title">{b.title || displayUrl(b.url)}</span>
                <span className="lib-host">{host(b.url)}</span>
              </button>
            )}
            <button className="icon-btn small lib-del" aria-label="Rename bookmark" title="Rename" onClick={() => setEditing({ url: b.url, title: b.title })}>
              <Pencil size={14} />
            </button>
            <button className="icon-btn small lib-del" aria-label="Remove bookmark" title="Remove bookmark" onClick={() => void api.removeBookmark(b.url)}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
