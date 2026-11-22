import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Search, Slash, X } from 'lucide-react'
import type { SettingsPatch, SettingsView, ShortcutId } from '@shared/types'
import {
  SHORTCUT_CATEGORIES,
  SHORTCUT_REGISTRY,
  acceleratorFromKeyEvent,
  findShortcutConflict,
  formatShortcutLabel,
  resolveShortcuts,
  validateAccelerator
} from '@shared/shortcuts'

const api = window.veyra

interface Props {
  settings: SettingsView
  onPatch: (next: SettingsPatch) => void
}

interface RecordingError {
  id: ShortcutId
  message: string
  conflictWithId?: ShortcutId
  candidate?: string
}

export function SettingsShortcuts({ settings, onPatch }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null)
  const [error, setError] = useState<RecordingError | null>(null)

  const overrides = settings.shortcuts ?? {}
  const resolved = useMemo(() => resolveShortcuts(overrides), [overrides])
  const hasAnyOverride = Object.keys(overrides).length > 0

  // Pause main-process global shortcuts while recording a key combination.
  useEffect(() => {
    api.setShortcutRecording(recordingId !== null)
    return () => {
      api.setShortcutRecording(false)
    }
  }, [recordingId])

  useEffect(() => {
    if (!recordingId) return
    const onKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        setRecordingId(null)
        setError(null)
        return
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        onPatch({ shortcuts: { [recordingId]: '' } })
        setRecordingId(null)
        setError(null)
        return
      }

      const raw = acceleratorFromKeyEvent(e, navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'win32')
      if (!raw) return // modifier-only press; wait for main key

      const check = validateAccelerator(raw)
      if (!check.ok || !check.accelerator) {
        setError({ id: recordingId, message: check.reason || 'That combination cannot be used.' })
        return
      }

      const conflict = findShortcutConflict(overrides, recordingId, check.accelerator)
      if (conflict) {
        setError({
          id: recordingId,
          message: `“${formatShortcutLabel(check.accelerator)}” is already used by ${conflict.label}.`,
          conflictWithId: conflict.id,
          candidate: check.accelerator
        })
        return
      }

      onPatch({ shortcuts: { [recordingId]: check.accelerator } })
      setRecordingId(null)
      setError(null)
    }

    const onWindowBlur = (): void => {
      setRecordingId(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [recordingId, overrides, onPatch])

  const q = query.trim().toLowerCase()
  const grouped = useMemo(() => {
    return SHORTCUT_CATEGORIES.map((cat) => {
      const items = SHORTCUT_REGISTRY.filter((def) => {
        if (def.category !== cat.id) return false
        if (!q) return true
        const current = resolved[def.id] || 'disabled'
        return (
          def.label.toLowerCase().includes(q) ||
          cat.label.toLowerCase().includes(q) ||
          current.toLowerCase().includes(q) ||
          def.defaultAccelerator.toLowerCase().includes(q)
        )
      })
      return { ...cat, items }
    }).filter((g) => g.items.length > 0)
  }, [q, resolved])

  const reassignConflict = (): void => {
    if (!error?.conflictWithId || !error.candidate) return
    onPatch({
      shortcuts: {
        [error.conflictWithId]: '',
        [error.id]: error.candidate
      }
    })
    setRecordingId(null)
    setError(null)
  }

  return (
    <section className="set-section" id="set-shortcuts" aria-labelledby="set-shortcuts-h">
      <div className="set-section-head">
        <h2 id="set-shortcuts-h">Keyboard shortcuts</h2>
        <div className="set-section-tools">
          <button
            type="button"
            className="btn sm ghost"
            disabled={!hasAnyOverride}
            onClick={() => {
              setRecordingId(null)
              setError(null)
              onPatch({ resetShortcuts: true })
            }}
          >
            Reset all
          </button>
        </div>
      </div>

      <div className="sc-toolbar">
        <div className="sc-search">
          <Search size={14} className="sc-search-icon" aria-hidden />
          <input
            type="text"
            value={query}
            placeholder="Search shortcuts…"
            aria-label="Search keyboard shortcuts"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="sc-search-clear"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <span className="sc-hint">Click any shortcut to record a new key combination. Press Esc to cancel.</span>
      </div>

      {error && (
        <div className="sc-alert" role="alert">
          <span className="sc-alert-text">{error.message}</span>
          <div className="sc-alert-actions">
            {error.conflictWithId && error.candidate && (
              <button type="button" className="btn sm primary" onClick={reassignConflict}>
                Use here instead
              </button>
            )}
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setError(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {grouped.length === 0 ? (
        <div className="set-card">
          <div className="set-empty">No shortcuts match “{query.trim()}”.</div>
        </div>
      ) : (
        grouped.map((group) => (
          <div key={group.id} className="sc-group">
            <h3 className="set-subhead">{group.label}</h3>
            <div className="set-card">
              {group.items.map((def) => {
                const current = resolved[def.id]
                const isRecording = recordingId === def.id
                const isModified = Object.prototype.hasOwnProperty.call(overrides, def.id)
                const isDisabled = current === ''
                return (
                  <div key={def.id} className={`set-row sc-row ${isRecording ? 'recording' : ''}`}>
                    <div className="set-row-info">
                      <div className="set-label">
                        {def.label}
                        {isModified && <span className="sc-mod-dot" title="Changed from default" aria-label="Modified" />}
                      </div>
                    </div>
                    <div className="sc-row-controls">
                      <button
                        type="button"
                        className={`sc-pill ${isRecording ? 'recording' : ''} ${isDisabled ? 'disabled' : ''}`}
                        aria-label={`Change shortcut for ${def.label}`}
                        onClick={() => {
                          setError(null)
                          setRecordingId((prev) => (prev === def.id ? null : def.id))
                        }}
                      >
                        {isRecording ? (
                          'Press keys…'
                        ) : isDisabled ? (
                          'Disabled'
                        ) : (
                          <kbd>{formatShortcutLabel(current)}</kbd>
                        )}
                      </button>
                      {!isDisabled && (
                        <button
                          type="button"
                          className="icon-btn small"
                          title={`Disable ${def.label} shortcut`}
                          aria-label={`Disable ${def.label} shortcut`}
                          onClick={() => {
                            if (recordingId === def.id) setRecordingId(null)
                            setError(null)
                            onPatch({ shortcuts: { [def.id]: '' } })
                          }}
                        >
                          <Slash size={13} />
                        </button>
                      )}
                      {isModified && (
                        <button
                          type="button"
                          className="icon-btn small"
                          title={`Reset to ${formatShortcutLabel(def.defaultAccelerator)}`}
                          aria-label={`Reset ${def.label} shortcut`}
                          onClick={() => {
                            if (recordingId === def.id) setRecordingId(null)
                            setError(null)
                            onPatch({ shortcuts: { [def.id]: null } })
                          }}
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </section>
  )
}
