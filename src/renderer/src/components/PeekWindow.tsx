import { useEffect, useState } from 'react'
import { ArrowLeft, Columns2, ExternalLink, Globe, LoaderCircle, Lock, RotateCw, TriangleAlert, X } from 'lucide-react'
import type { PeekState } from '@shared/peek'
import { displayUrl } from '@shared/url'

/**
 * Floating Link Preview ("Peek") toolbar window.
 * The web page itself runs in a separate sandboxed WebContentsView mounted directly below
 * this 44px toolbar by the main process, with no preload and the originating workspace session.
 */
export function PeekWindow(): React.JSX.Element {
  const [state, setState] = useState<PeekState | null>(null)
  const peek = window.veyraPeek!

  useEffect(() => {
    document.documentElement.classList.add('peek-window')
    const off = peek.onState((next) => {
      const root = document.documentElement
      root.classList.toggle('dark', next.dark)
      if (next.accent) root.style.setProperty('--peek-accent', next.accent)
      setState(next)
    })
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        peek.action('close')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    peek.ready()
    return () => {
      off()
      window.removeEventListener('keydown', onKeyDown)
      document.documentElement.classList.remove('peek-window')
    }
  }, [peek])

  const url = state?.url ?? ''
  const secure = url.startsWith('https://') && !state?.error
  const insecure = !!state?.error || (url.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url))
  const shortUrl = displayUrl(url)

  return (
    <div className="peek-shell" role="dialog" aria-label="Link preview">
      <header className="peek-bar">
        <div className="peek-nav">
          <button
            type="button"
            className="icon-btn peek-icon-btn"
            aria-label="Back"
            title="Back"
            disabled={!state?.canGoBack}
            onClick={() => peek.action('back')}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            className="icon-btn peek-icon-btn"
            aria-label="Reload"
            title="Reload"
            onClick={() => peek.action('reload')}
          >
            <RotateCw size={14} className={state?.loading ? 'spin' : undefined} />
          </button>
        </div>

        <div className="peek-addr" title={url}>
          <span className={`peek-sec ${insecure ? 'warn' : ''}`} aria-hidden>
            {state?.loading ? (
              <LoaderCircle size={13} className="spin" />
            ) : secure ? (
              <Lock size={12} />
            ) : insecure ? (
              <TriangleAlert size={13} />
            ) : (
              <Globe size={13} />
            )}
          </span>
          <span className="peek-title">{state?.title || shortUrl || 'Loading…'}</span>
          {state?.title && shortUrl && <span className="peek-url">{shortUrl}</span>}
        </div>

        <div className="peek-actions">
          <button
            type="button"
            className="peek-act-btn primary"
            title="Open as tab"
            onClick={() => peek.action('open-tab')}
          >
            <ExternalLink size={13} aria-hidden />
            <span>Open tab</span>
          </button>
          <button
            type="button"
            className="peek-act-btn"
            title="Open in split view"
            onClick={() => peek.action('open-split')}
          >
            <Columns2 size={13} aria-hidden />
            <span>Split</span>
          </button>
          <button
            type="button"
            className="icon-btn peek-icon-btn"
            aria-label="Close preview"
            title="Close (Esc)"
            onClick={() => peek.action('close')}
          >
            <X size={15} />
          </button>
        </div>
      </header>
      <div className="peek-stage">
        {state?.error && (
          <div className="peek-error">
            <TriangleAlert size={22} aria-hidden />
            <p>Could not load preview ({state.error}).</p>
          </div>
        )}
      </div>
    </div>
  )
}
