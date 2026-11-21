import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Lock, RotateCw, Search, TriangleAlert, X } from 'lucide-react'
import type { TabInfo } from '@shared/types'
import { displayUrl } from '@shared/url'

const api = window.veyra

export function Toolbar({ tab }: { tab?: TabInfo }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')

  const url = tab?.error?.url || tab?.url || ''
  // While you type, the page changing underneath doesn't overwrite what you typed.
  useEffect(() => {
    if (!editing) setText(displayUrl(url))
  }, [url, editing, tab?.id])

  useEffect(
    () =>
      api.onFocusOmnibox(() => {
        input.current?.focus()
        input.current?.select()
      }),
    []
  )

  // A padlock only for a page that actually loaded over https; a refused certificate gets the warning.
  const certError = !!tab?.error && /CERT|SSL/.test(tab.error.description)
  const secure = url.startsWith('https://') && !tab?.error
  const insecure = certError || (url.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url))

  return (
    <header className="bar">
      <div className="nav">
        <button className="icon-btn" aria-label="Back" title="Back (Alt+Left)" disabled={!tab?.canGoBack} onClick={() => api.back()}>
          <ArrowLeft size={17} />
        </button>
        <button className="icon-btn" aria-label="Forward" title="Forward (Alt+Right)" disabled={!tab?.canGoForward} onClick={() => api.forward()}>
          <ArrowRight size={17} />
        </button>
        {tab?.loading ? (
          <button className="icon-btn" aria-label="Stop" title="Stop" onClick={() => api.stop()}>
            <X size={17} />
          </button>
        ) : (
          <button className="icon-btn" aria-label="Reload" title="Reload (Ctrl+R)" disabled={!tab?.url} onClick={() => api.reload()}>
            <RotateCw size={16} />
          </button>
        )}
      </div>

      <form
        className={`omni ${editing ? 'editing' : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          if (tab && text.trim()) api.navigate(tab.id, text)
          input.current?.blur()
        }}
      >
        <span className={`omni-icon ${insecure ? 'warn' : ''}`} title={secure ? 'Connection is secure' : insecure ? 'Connection is not secure' : undefined}>
          {editing || !url ? <Search size={14} /> : secure ? <Lock size={13} /> : insecure ? <TriangleAlert size={14} /> : <Search size={14} />}
        </span>
        <input
          ref={input}
          value={text}
          spellCheck={false}
          placeholder="Search or type a web address"
          aria-label="Address and search bar"
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => {
            setEditing(true)
            setText(url)
            const el = e.currentTarget
            requestAnimationFrame(() => el.select())
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText(url)
              e.currentTarget.blur()
            }
          }}
        />
      </form>
      {tab && tab.zoom !== 100 && (
        <button className="zoom-pill" aria-label={`Zoom ${tab.zoom}%, click to reset`} title="Reset zoom (Ctrl+0)" onClick={() => api.resetZoom()}>
          {tab.zoom}%
        </button>
      )}
      <div className="caption-space" />
    </header>
  )
}
