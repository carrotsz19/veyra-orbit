import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, Download, Lock, RefreshCw, X } from 'lucide-react'
import type { ImportProfile, ImportResult, ImportStatus } from '@shared/types'
import { formatImportSummary } from '@shared/importer'

const api = window.veyra

function profileLabel(p: ImportProfile): string {
  return `${p.browserName} · ${p.profileName}`
}

interface ImportFormProps {
  profiles: ImportProfile[]
  compact?: boolean
  onRefresh?: () => void
  onImported?: (result: ImportResult) => void
}

function ImportForm({ profiles, compact = false, onRefresh, onImported }: ImportFormProps): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string>(() => profiles[0]?.id ?? '')
  const [wantBookmarks, setWantBookmarks] = useState(true)
  const [wantHistory, setWantHistory] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const selected = profiles.find((p) => p.id === selectedId) ?? profiles[0] ?? null

  useEffect(() => {
    if (!selected && profiles[0]) {
      setSelectedId(profiles[0].id)
    } else if (selected && selected.id !== selectedId) {
      setSelectedId(selected.id)
    }
  }, [profiles, selected, selectedId])

  useEffect(() => {
    if (!selected) return
    setWantBookmarks(selected.hasBookmarks)
    setWantHistory(selected.hasHistory)
    setResult(null)
  }, [selected?.id, selected?.hasBookmarks, selected?.hasHistory])

  const canImport =
    !!selected && !running && ((wantBookmarks && selected.hasBookmarks) || (wantHistory && selected.hasHistory))

  const run = async (): Promise<void> => {
    if (!selected || !canImport) return
    setRunning(true)
    setResult(null)
    try {
      const res = await api.runImport({
        profileId: selected.id,
        bookmarks: wantBookmarks && selected.hasBookmarks,
        history: wantHistory && selected.hasHistory
      })
      setResult(res)
      onImported?.(res)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={`imp-form ${compact ? 'compact' : ''}`}>
      <div className="imp-profile-row">
        <label className="imp-field-label" htmlFor={compact ? 'imp-profile-start' : 'imp-profile-settings'}>
          Browser &amp; profile
        </label>
        <div className="imp-select-row">
          <div className="imp-select-wrap">
            <select
              id={compact ? 'imp-profile-start' : 'imp-profile-settings'}
              className="imp-select"
              value={selected?.id ?? ''}
              disabled={running}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {profileLabel(p)}
                </option>
              ))}
            </select>
            <ChevronDown size={14} strokeWidth={1.85} className="imp-select-chevron" aria-hidden />
          </div>
          {onRefresh && (
            <button
              type="button"
              className="icon-btn small"
              title="Rescan browser profiles"
              aria-label="Rescan browser profiles"
              disabled={running}
              onClick={onRefresh}
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="set-checks imp-checks">
        <label className={`set-check ${selected && !selected.hasBookmarks ? 'imp-muted' : ''}`}>
          <input
            type="checkbox"
            checked={!!selected?.hasBookmarks && wantBookmarks}
            disabled={running || !selected?.hasBookmarks}
            onChange={(e) => {
              setWantBookmarks(e.target.checked)
              setResult(null)
            }}
          />
          <span>Bookmarks{selected && !selected.hasBookmarks ? ' (none found)' : ''}</span>
        </label>

        <label className={`set-check ${selected && !selected.hasHistory ? 'imp-muted' : ''}`}>
          <input
            type="checkbox"
            checked={!!selected?.hasHistory && wantHistory}
            disabled={running || !selected?.hasHistory}
            onChange={(e) => {
              setWantHistory(e.target.checked)
              setResult(null)
            }}
          />
          <span>History (last 90 days){selected && !selected.hasHistory ? ' (none found)' : ''}</span>
        </label>

        <label className="set-check imp-muted" title="Orbit does not have a built-in password manager yet">
          <input type="checkbox" checked={false} disabled />
          <span className="imp-pw-label">
            <Lock size={12} aria-hidden />
            <span>Passwords: coming later</span>
          </span>
        </label>
      </div>

      <div className="imp-actions">
        <button type="button" className="btn primary set-icon-btn" disabled={!canImport} onClick={() => void run()}>
          <Download size={14} aria-hidden />
          <span>{running ? 'Importing…' : 'Import'}</span>
        </button>
        {result && result.ok && (
          <span className="imp-summary" role="status" aria-live="polite">
            <CheckCircle2 size={14} aria-hidden />
            <span>{formatImportSummary(result)}</span>
          </span>
        )}
        {result && !result.ok && (
          <span className="imp-error" role="alert">
            {result.error || 'Import failed.'}
          </span>
        )}
      </div>

      <div className="set-desc">
        Bookmarks keep nested folders in their titles (“Folder › Title”). Orbit reads a copy and never changes your other browser’s files.
      </div>
    </div>
  )
}

/** Settings → Import data section. */
export function ImportSection(): React.JSX.Element {
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback((): void => {
    setLoading(true)
    void api
      .getImportStatus()
      .then((s) => setStatus(s))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section className="set-section" id="set-import" aria-labelledby="set-import-h">
      <h2 id="set-import-h">Import data</h2>
      <div className="set-card">
        <div className="set-row stack">
          <div className="set-row-info">
            <div className="set-label">Import from another browser</div>
            <div className="set-desc">Bring your bookmarks and the last 90 days of history from Chrome, Edge, or Brave.</div>
          </div>

          {loading && !status ? (
            <div className="set-desc">Looking for browser profiles…</div>
          ) : !status || status.profiles.length === 0 ? (
            <div className="imp-empty-row">
              <span className="set-desc">No Chrome, Edge, or Brave profiles were found on this computer.</span>
              <button type="button" className="btn set-icon-btn" onClick={load}>
                <RefreshCw size={14} aria-hidden />
                <span>Rescan</span>
              </button>
            </div>
          ) : (
            <ImportForm profiles={status.profiles} onRefresh={load} />
          )}
        </div>
      </div>
    </section>
  )
}

/** Offered once on first run on the Start Page when Chrome, Edge, or Brave profiles are detected. */
export function FirstRunImportBanner(): React.JSX.Element | null {
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [doneResult, setDoneResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    let alive = true
    void api.getImportStatus().then((s) => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!status || (!status.showFirstRunPrompt && !doneResult)) return null

  const browserNames = [...new Set(status.profiles.map((p) => p.browserName.replace(/^Google |^Microsoft /, '')))]
  const browserList =
    browserNames.length <= 1
      ? browserNames[0] || 'your other browser'
      : `${browserNames.slice(0, -1).join(', ')} or ${browserNames[browserNames.length - 1]}`

  const dismiss = (): void => {
    setStatus((prev) => (prev ? { ...prev, showFirstRunPrompt: false } : prev))
    setDoneResult(null)
    void api.dismissImportPrompt()
  }

  return (
    <section className="start-import" aria-label="Import browser data">
      <div className="start-import-head">
        <div className="start-import-copy">
          <strong>Bring your bookmarks and history</strong>
          <span>Import from {browserList} without leaving your start page.</span>
        </div>
        <div className="start-import-btns">
          {!expanded && !doneResult && (
            <button type="button" className="btn primary sm" onClick={() => setExpanded(true)}>
              Import data…
            </button>
          )}
          <button
            type="button"
            className={expanded || doneResult ? 'dl-btn' : 'btn ghost sm'}
            aria-label={doneResult ? 'Dismiss import summary' : 'Not now'}
            onClick={dismiss}
          >
            {expanded || doneResult ? <X size={14} /> : 'Not now'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="start-import-body">
          <ImportForm
            profiles={status.profiles}
            compact
            onImported={(res) => {
              if (res.ok) setDoneResult(res)
            }}
          />
        </div>
      )}
    </section>
  )
}
