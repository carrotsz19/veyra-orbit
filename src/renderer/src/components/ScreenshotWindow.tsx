import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Camera, Check, Copy, Crop, Download, FolderOpen, Maximize2, Monitor, X } from 'lucide-react'
import type { ScreenshotChooserPayload, ScreenshotMode, ScreenshotToastPayload } from '@shared/types'
import { applyResolvedAppearance } from '../applyAppearance'

/**
 * Floating screenshot chooser & preview toast window (src/main/screenshot.ts).
 * Runs in its own sandboxed FloatingWindow so it renders above native WebContentsViews.
 */
export function ScreenshotWindow(): React.JSX.Element | null {
  const modeParam = new URLSearchParams(location.search).get('mode') === 'toast' ? 'toast' : 'chooser'
  const [chooser, setChooser] = useState<ScreenshotChooserPayload | null>(null)
  const [toast, setToast] = useState<ScreenshotToastPayload | null>(null)
  const [saving, setSaving] = useState(false)
  const [copiedTick, setCopiedTick] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const bridge = window.veyraScreenshot!

  useEffect(() => {
    document.documentElement.classList.add('menu-window', 'shot-window')
    const offs = [
      bridge.onChooser((next) => setChooser(next)),
      bridge.onToast((next) => {
        setToast(next)
        setSaving(false)
        setSaveError(null)
      }),
      bridge.onAppearance(applyResolvedAppearance)
    ]
    bridge.ready()
    return () => {
      offs.forEach((off) => off())
      document.documentElement.classList.remove('menu-window', 'shot-window')
    }
  }, [bridge])

  useEffect(() => {
    if (!copiedTick) return
    const t = setTimeout(() => setCopiedTick(0), 1800)
    return () => clearTimeout(t)
  }, [copiedTick])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        bridge.dismiss()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [bridge])

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const dark = modeParam === 'chooser' ? chooser?.dark : toast?.dark
    const accent = modeParam === 'chooser' ? chooser?.accent : toast?.accent
    if (typeof dark === 'boolean') document.documentElement.classList.toggle('dark', dark)
    if (accent) document.documentElement.style.setProperty('--menu-accent', accent)
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      bridge.size(Math.ceil(r.width), Math.ceil(r.height))
    }
  }, [modeParam, chooser, toast, saveError, copiedTick, bridge])

  if (modeParam === 'chooser') {
    if (!chooser) return null
    const pick = (mode: ScreenshotMode): void => bridge.choose(mode)
    return (
      <div ref={boxRef} className="shot-chooser" role="dialog" aria-label="Take screenshot">
        <div className="shot-chooser-head">
          <span className="shot-chooser-title">
            <Camera size={13} strokeWidth={1.9} aria-hidden />
            <span>Take screenshot</span>
          </span>
          {chooser.shortcutLabel && <span className="shot-chooser-key">{chooser.shortcutLabel}</span>}
        </div>
        <div className="shot-chooser-list" role="menu">
          <button type="button" role="menuitem" className="shot-opt" onClick={() => pick('visible')}>
            <span className="shot-opt-ico" aria-hidden>
              <Monitor size={15} strokeWidth={1.75} />
            </span>
            <span className="shot-opt-text">
              <span className="shot-opt-label">Visible area</span>
              <span className="shot-opt-sub">What&apos;s on screen now</span>
            </span>
          </button>
          <button type="button" role="menuitem" className="shot-opt" onClick={() => pick('full')}>
            <span className="shot-opt-ico" aria-hidden>
              <Maximize2 size={15} strokeWidth={1.75} />
            </span>
            <span className="shot-opt-text">
              <span className="shot-opt-label">Full page</span>
              <span className="shot-opt-sub">
                {chooser.canFullPage ? 'Entire scrollable page' : 'Captures current Orbit view'}
              </span>
            </span>
          </button>
          <button type="button" role="menuitem" className="shot-opt" onClick={() => pick('area')}>
            <span className="shot-opt-ico" aria-hidden>
              <Crop size={15} strokeWidth={1.75} />
            </span>
            <span className="shot-opt-text">
              <span className="shot-opt-label">Select area</span>
              <span className="shot-opt-sub">Drag a rectangle to capture</span>
            </span>
          </button>
        </div>
      </div>
    )
  }

  if (!toast) return null

  const handleSave = async (): Promise<void> => {
    if (!toast.id || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await bridge.save(toast.id)
      if (!res.ok) setSaveError(res.error ?? 'Could not save screenshot.')
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = async (): Promise<void> => {
    if (!toast.id) return
    const ok = await bridge.copy(toast.id)
    if (ok) setCopiedTick((n) => n + 1)
  }

  return (
    <div
      ref={boxRef}
      className="shot-toast"
      role="status"
      aria-live="polite"
      onMouseEnter={() => bridge.setHover(true)}
      onMouseLeave={() => bridge.setHover(false)}
    >
      {toast.busy ? (
        <div className="shot-toast-simple">
          <Camera size={15} strokeWidth={1.8} className="shot-toast-accent" aria-hidden />
          <span className="shot-toast-msg">{toast.busy}</span>
        </div>
      ) : toast.error ? (
        <div className="shot-toast-simple">
          <span className="shot-toast-msg">{toast.error}</span>
          <button type="button" className="shot-close" aria-label="Dismiss" onClick={() => bridge.dismiss()}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <>
          <div className="shot-toast-top">
            {toast.previewDataUrl && (
              <img
                src={toast.previewDataUrl}
                alt="Screenshot preview"
                className="shot-thumb"
                onLoad={() => {
                  const r = boxRef.current?.getBoundingClientRect()
                  if (r && r.width > 0 && r.height > 0) bridge.size(Math.ceil(r.width), Math.ceil(r.height))
                }}
              />
            )}
            <div className="shot-toast-meta">
              <div className="shot-toast-head">
                <span className="shot-toast-title">
                  <Check size={13} strokeWidth={2.4} className="shot-toast-ok" aria-hidden />
                  <span>{copiedTick > 0 ? 'Copied again' : 'Copied to clipboard'}</span>
                </span>
                <button type="button" className="shot-close" aria-label="Dismiss" onClick={() => bridge.dismiss()}>
                  <X size={13} />
                </button>
              </div>
              {toast.width && toast.height && (
                <div className="shot-toast-dim">
                  {toast.width.toLocaleString()} × {toast.height.toLocaleString()} px
                  {toast.mode === 'full' ? ' · Full page' : toast.mode === 'area' ? ' · Selection' : ''}
                </div>
              )}
              {toast.isPrivate && !toast.savedPath && (
                <div className="shot-toast-note">Private workspace — not saved automatically.</div>
              )}
              {toast.notice && <div className="shot-toast-note">{toast.notice}</div>}
              {toast.savedFilename && (
                <div className="shot-toast-saved" title={toast.savedPath}>
                  Saved as {toast.savedFilename}
                </div>
              )}
              {saveError && <div className="shot-toast-err">{saveError}</div>}
            </div>
          </div>
          <div className="shot-toast-actions">
            {toast.savedPath ? (
              <button
                type="button"
                className="shot-btn primary"
                onClick={() => toast.id && bridge.showInFolder(toast.id)}
              >
                <FolderOpen size={13} aria-hidden />
                <span>Show in folder</span>
              </button>
            ) : (
              <button type="button" className="shot-btn primary" disabled={saving} onClick={() => void handleSave()}>
                <Download size={13} aria-hidden />
                <span>{saving ? 'Saving…' : 'Save PNG'}</span>
              </button>
            )}
            <button type="button" className="shot-btn" onClick={() => void handleCopy()}>
              <Copy size={13} aria-hidden />
              <span>Copy again</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
