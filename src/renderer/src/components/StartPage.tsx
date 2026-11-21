import { useEffect, useState } from 'react'
import { EyeOff, Search } from 'lucide-react'
import type { Bookmark } from '@shared/types'
import { FirstRunImportBanner } from './ImportCard'

const api = window.veyra

function greeting(): string {
  const h = new Date().getHours()
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

/** What a new tab shows. Later: today's tasks, the focus timer and recent notes from Veyra Study. */
export function StartPage({ tabId, isPrivate = false }: { tabId: number; isPrivate?: boolean }): React.JSX.Element {
  const [text, setText] = useState('')
  const [marks, setMarks] = useState<Bookmark[]>([])
  useEffect(() => {
    const load = (): void => void api.bookmarks().then((b) => setMarks(b.slice(0, 8)))
    load()
    return api.onDataChanged(load)
  }, [])

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className={`start ${isPrivate ? 'private-start' : ''}`}>
      {isPrivate ? (
        <>
          <div className="start-private-emblem" aria-hidden>
            <EyeOff size={22} strokeWidth={1.8} />
          </div>
          <h1 className="start-hello">Private browsing.</h1>
          <p className="start-private-note">
            Private: Orbit won&apos;t save your history, cookies or site data from this workspace.
          </p>
        </>
      ) : (
        <>
          <p className="start-date">{today}</p>
          <h1 className="start-hello">{greeting()}.</h1>
        </>
      )}
      <form
        className="start-search"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) api.navigate(tabId, text)
        }}
      >
        <Search size={18} />
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search or type a web address" aria-label="Search or type a web address" />
      </form>
      {marks.length > 0 && (
        <nav className="start-marks" aria-label="Bookmarks">
          {marks.map((b) => {
            const name = b.title || hostOf(b.url)
            return (
              <button key={b.url} className="start-mark" title={b.url} onClick={() => api.navigate(tabId, b.url)}>
                <span className="start-mark-initial" aria-hidden>
                  {name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="start-mark-name">{name}</span>
              </button>
            )
          })}
        </nav>
      )}
      {!isPrivate && <FirstRunImportBanner />}
      <p className="start-hint">
        <kbd>Ctrl L</kbd> address bar · <kbd>Ctrl T</kbd> new tab ·{' '}
        {isPrivate ? (
          <>
            <kbd>Ctrl Shift N</kbd> new private workspace
          </>
        ) : (
          <>
            <kbd>Ctrl Shift T</kbd> reopen a closed tab
          </>
        )}
      </p>
      <p className="start-links">
        <button onClick={() => api.navigate(tabId, 'orbit://history')}>History</button>
        <span aria-hidden>·</span>
        <button onClick={() => api.navigate(tabId, 'orbit://bookmarks')}>Bookmarks</button>
        <span aria-hidden>·</span>
        <button onClick={() => api.navigate(tabId, 'orbit://settings')}>Settings</button>
      </p>
    </div>
  )
}
