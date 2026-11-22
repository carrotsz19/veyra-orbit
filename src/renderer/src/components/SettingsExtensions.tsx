import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FolderOpen,
  Pin,
  PinOff,
  Puzzle,
  ShieldAlert,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import type { ExtensionSummary, ExtensionsState } from '@shared/types'
import { CHROME_WEB_STORE_URL } from '@shared/extensions'

const api = window.veyra

export function SettingsExtensions(): React.JSX.Element {
  const [extState, setExtState] = useState<ExtensionsState>({ extensions: [], developerMode: false })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [storeInput, setStoreInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const refresh = useCallback((): void => {
    void api.extensions.getState().then(setExtState)
  }, [])

  useEffect(() => {
    refresh()
    const off = api.extensions.onState(setExtState)
    // Refresh live memory readout gently while Settings -> Extensions is visible; pause when hidden.
    let timer: ReturnType<typeof setInterval> | null = null
    const start = (): void => {
      if (timer || document.hidden) return
      timer = setInterval(refresh, 3000)
    }
    const stop = (): void => {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
    const onVis = (): void => {
      if (document.hidden) {
        stop()
      } else {
        refresh()
        start()
      }
    }
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      off()
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refresh])

  const handleInstallById = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const trimmed = storeInput.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setStatusMsg(null)
    try {
      const res = await api.extensions.installFromStore(trimmed)
      if (res.ok) {
        setStoreInput('')
        setStatusMsg({ kind: 'ok', text: 'Extension installed.' })
      } else if (res.error) {
        setStatusMsg({ kind: 'err', text: res.error })
      }
    } finally {
      setBusy(false)
    }
  }

  const handleLoadUnpacked = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setStatusMsg(null)
    try {
      const res = await api.extensions.installUnpacked()
      if (res.ok) {
        setStatusMsg({ kind: 'ok', text: 'Unpacked extension loaded.' })
      } else if (!res.canceled && res.error) {
        setStatusMsg({ kind: 'err', text: res.error })
      }
    } finally {
      setBusy(false)
    }
  }

  const toggleDevMode = (): void => {
    void api.extensions.setDeveloperMode(!extState.developerMode).then(() => refresh())
  }

  const renderCard = (ext: ExtensionSummary): React.JSX.Element => {
    const expanded = expandedId === ext.id
    const confirming = confirmRemoveId === ext.id

    return (
      <li key={ext.id} className={`set-row stack ext-item ${ext.enabled ? '' : 'disabled'}`}>
        <div className="ext-item-top">
          <div className="ext-item-left">
            {ext.iconDataUrl ? (
              <img className="ext-item-icon" src={ext.iconDataUrl} alt="" />
            ) : (
              <span className="ext-item-icon ext-item-icon-fallback" aria-hidden>
                <Puzzle size={18} />
              </span>
            )}
            <div className="set-row-info">
              <div className="set-label ext-item-title">
                <span>{ext.name}</span>
                {ext.version && <span className="set-version">{ext.version}</span>}
                {ext.source === 'unpacked' && <span className="ext-tag">Unpacked</span>}
                {ext.enabled && ext.memoryMB !== null && (
                  <span className="ext-mem" title="Approximate memory used by this extension">
                    {ext.memoryMB.toFixed(1)} MB
                  </span>
                )}
              </div>
              {ext.description && <div className="set-desc">{ext.description}</div>}
              {ext.error && <div className="set-note">{ext.error}</div>}
            </div>
          </div>

          <div className="set-row-actions">
            {ext.enabled && (
              <button
                type="button"
                className={`icon-btn small ${ext.pinned ? 'ext-pinned-on' : ''}`}
                title={ext.pinned ? 'Unpin from toolbar' : 'Pin to toolbar'}
                aria-label={ext.pinned ? `Unpin ${ext.name} from toolbar` : `Pin ${ext.name} to toolbar`}
                aria-pressed={ext.pinned}
                onClick={() => void api.extensions.setPinned(ext.id, !ext.pinned)}
              >
                {ext.pinned ? <Pin size={14} /> : <PinOff size={14} />}
              </button>
            )}
            <button
              type="button"
              className="btn set-icon-btn ext-details-btn"
              aria-expanded={expanded}
              onClick={() => setExpandedId(expanded ? null : ext.id)}
            >
              <span>Details</span>
              {expanded ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={ext.enabled}
              aria-label={`Enable ${ext.name}`}
              className={`set-switch ${ext.enabled ? 'on' : ''}`}
              onClick={() => void api.extensions.setEnabled(ext.id, !ext.enabled)}
            >
              <span className="set-switch-thumb" />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="ext-details">
            <div className="ext-details-meta">
              <span className="ext-detail-id">ID: {ext.id}</span>
              {ext.unpackedPath && <span className="ext-detail-path">Folder: {ext.unpackedPath}</span>}
            </div>

            <div className="ext-details-perms">
              <div className="ext-details-heading">Permissions</div>
              {ext.permissions.length === 0 ? (
                <div className="set-desc">No special permissions requested.</div>
              ) : (
                <ul className="ext-perm-list">
                  {ext.permissions.map((p) => (
                    <li key={p.key} className={`ext-perm-item ${p.risk}`}>
                      {p.risk === 'high' && <ShieldAlert size={13} className="ext-perm-warn" aria-hidden />}
                      <span>{p.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ext-details-actions">
              {ext.enabled && ext.optionsUrl && (
                <button
                  type="button"
                  className="btn set-icon-btn"
                  onClick={() => api.extensions.openOptions(ext.id)}
                >
                  <SlidersHorizontal size={13} aria-hidden />
                  <span>Extension options</span>
                </button>
              )}
              {confirming ? (
                <div className="set-confirm">
                  <span>Remove {ext.name}?</span>
                  <button type="button" className="btn" onClick={() => setConfirmRemoveId(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      setConfirmRemoveId(null)
                      void api.extensions.uninstall(ext.id)
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn set-icon-btn"
                  onClick={() => setConfirmRemoveId(ext.id)}
                >
                  <Trash2 size={13} aria-hidden />
                  <span>Remove</span>
                </button>
              )}
            </div>
          </div>
        )}
      </li>
    )
  }

  return (
    <section className="set-section" id="set-extensions" aria-labelledby="set-extensions-h">
      <h2 id="set-extensions-h">Extensions</h2>
      <div className="set-card">
        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Chrome Web Store</div>
            <div className="set-desc">
              Install Manifest V3 extensions directly from the Chrome Web Store. Extensions never run in private workspaces.
            </div>
          </div>
          <div className="set-row-actions">
            <button
              type="button"
              className="btn primary set-icon-btn"
              onClick={() => api.newTab(CHROME_WEB_STORE_URL)}
            >
              <ExternalLink size={14} aria-hidden />
              <span>Open Chrome Web Store</span>
            </button>
          </div>
        </div>

        <div className="set-row stack">
          <form className="ext-store-form" onSubmit={(e) => void handleInstallById(e)}>
            <input
              type="text"
              className="ext-store-input"
              placeholder="Paste a Chrome Web Store link or extension ID…"
              value={storeInput}
              onChange={(e) => {
                setStoreInput(e.target.value)
                setStatusMsg(null)
              }}
              disabled={busy}
            />
            <button type="submit" className="btn" disabled={busy || !storeInput.trim()}>
              {busy ? 'Installing…' : 'Install'}
            </button>
          </form>
          {statusMsg && (
            <div className={statusMsg.kind === 'err' ? 'set-note' : 'set-status'}>{statusMsg.text}</div>
          )}
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Developer mode</div>
            <div className="set-desc">Allow loading unpacked Manifest V3 extensions from a local folder.</div>
          </div>
          <div className="set-row-actions">
            {extState.developerMode && (
              <button type="button" className="btn set-icon-btn" onClick={() => void handleLoadUnpacked()} disabled={busy}>
                <FolderOpen size={14} aria-hidden />
                <span>Load unpacked…</span>
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={extState.developerMode}
              aria-label="Developer mode"
              className={`set-switch ${extState.developerMode ? 'on' : ''}`}
              onClick={toggleDevMode}
            >
              <span className="set-switch-thumb" />
            </button>
          </div>
        </div>
      </div>

      <div className="set-card ext-list-card">
        {extState.extensions.length === 0 ? (
          <div className="set-empty">
            <Puzzle size={16} aria-hidden />
            <span>No extensions installed yet. Visit the Chrome Web Store to add extensions like uBlock Origin Lite or Bitwarden.</span>
          </div>
        ) : (
          <ul className="set-perms">{extState.extensions.map(renderCard)}</ul>
        )}
      </div>
    </section>
  )
}
