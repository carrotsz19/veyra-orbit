import { useState } from 'react'
import {
  BookOpen,
  Briefcase,
  Check,
  Code,
  Compass,
  FlaskConical,
  GraduationCap,
  Home,
  Music,
  Sparkles,
  Star,
  Trash2,
  X
} from 'lucide-react'
import type {
  StartBackgroundMode,
  ThemePresetId,
  WorkspaceAccentId,
  WorkspaceIconId,
  WorkspaceInfo
} from '@shared/types'
import { WORKSPACE_ACCENTS, WORKSPACE_ICONS, isBuiltInWorkspaceIcon } from '@shared/workspaces'
import { ACCENT_SWATCHES, THEME_PRESETS, normalizeHexColor } from '@shared/appearance'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'

const api = window.veyra

const ICON_COMPONENTS: Record<WorkspaceIconId, typeof Home> = {
  home: Home,
  'book-open': BookOpen,
  'graduation-cap': GraduationCap,
  briefcase: Briefcase,
  code: Code,
  'flask-conical': FlaskConical,
  compass: Compass,
  sparkles: Sparkles,
  music: Music,
  star: Star
}

function Glyph({ icon, size = 14 }: { icon: string; size?: number }): React.JSX.Element {
  if (isBuiltInWorkspaceIcon(icon)) {
    const Icon = ICON_COMPONENTS[icon]
    return <Icon size={size} strokeWidth={1.85} aria-hidden />
  }
  return <span className="ws-emoji">{icon}</span>
}

const START_BG_OPTIONS: readonly SegmentedOption<StartBackgroundMode | ''>[] = [
  { value: '', label: 'Inherit' },
  { value: 'solid', label: 'Plain' },
  { value: 'tinted', label: 'Tinted' },
  { value: 'image', label: 'Photo' }
]

interface Props {
  mode: 'create' | 'edit'
  workspace?: WorkspaceInfo
  workspaceCount: number
  tabCount: number
  canDelete: boolean
  onClose: () => void
}

export function WorkspaceEditSheet({
  mode,
  workspace,
  workspaceCount,
  tabCount,
  canDelete,
  onClose
}: Props): React.JSX.Element {
  const [name, setName] = useState(mode === 'edit' && workspace ? workspace.name : '')
  const [icon, setIcon] = useState(mode === 'edit' && workspace ? workspace.icon : 'book-open')
  const [accent, setAccent] = useState<WorkspaceAccentId>(
    mode === 'edit' && workspace ? workspace.accent : WORKSPACE_ACCENTS[workspaceCount % WORKSPACE_ACCENTS.length].id
  )
  const [themePreset, setThemePreset] = useState<ThemePresetId | ''>(
    mode === 'edit' && workspace?.themePreset ? workspace.themePreset : ''
  )
  const [accentColor, setAccentColor] = useState(mode === 'edit' && workspace?.accentColor ? workspace.accentColor : '')
  const [hexDraft, setHexDraft] = useState(mode === 'edit' && workspace?.accentColor ? workspace.accentColor : '')
  const [startBackground, setStartBackground] = useState<StartBackgroundMode | ''>(
    mode === 'edit' && workspace?.startBackground ? workspace.startBackground : ''
  )
  const [isolated, setIsolated] = useState(mode === 'edit' && workspace ? workspace.isolated : false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleHexChange = (raw: string): void => {
    setHexDraft(raw)
    const trimmed = raw.trim()
    if (!trimmed) {
      setAccentColor('')
      return
    }
    const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
    const norm = normalizeHexColor(candidate)
    if (norm) setAccentColor(norm)
  }

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (mode === 'create') {
      await api.createWorkspace({
        name: name.trim() || `Space ${workspaceCount + 1}`,
        icon,
        accent,
        isolated,
        themePreset,
        accentColor,
        startBackground
      })
    } else if (workspace) {
      await api.updateWorkspace(workspace.id, {
        name: name.trim() || 'Workspace',
        icon,
        accent,
        isolated,
        themePreset,
        accentColor,
        startBackground
      })
    }
    onClose()
  }

  const handleDelete = async (): Promise<void> => {
    if (!workspace) return
    await api.deleteWorkspace(workspace.id)
    onClose()
  }

  const isDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ws-sheet-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <form className="sheet-card ws-sheet-card" onSubmit={(e) => void handleSubmit(e)}>
        <div className="sheet-head">
          <div>
            <h2 id="ws-sheet-title">{mode === 'create' ? 'New workspace' : `Edit “${workspace?.name || 'Workspace'}”`}</h2>
            <p className="sheet-sub">Give this workspace its own name, icon, theme preset, accent colour, and start-page background.</p>
          </div>
          <button type="button" className="icon-btn small" aria-label="Close" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="sheet-body ws-sheet-body">
          <div className="ws-sheet-field">
            <label className="ws-sheet-label" htmlFor="ws-sheet-name">
              Name
            </label>
            <input
              id="ws-sheet-name"
              className="ws-input"
              type="text"
              autoFocus
              maxLength={40}
              placeholder="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="ws-sheet-field">
            <div className="ws-sheet-label">Icon or emoji</div>
            <div className="ws-icons">
              {WORKSPACE_ICONS.map((iconId) => (
                <button
                  key={iconId}
                  type="button"
                  className={`ws-icon-pick ${icon === iconId ? 'on' : ''}`}
                  aria-label={`Icon ${iconId}`}
                  title={iconId.replace(/-/g, ' ')}
                  aria-pressed={icon === iconId}
                  onClick={() => setIcon(iconId)}
                >
                  <Glyph icon={iconId} size={14} />
                </button>
              ))}
              <input
                className="ws-emoji-input"
                type="text"
                maxLength={8}
                placeholder="Aa"
                aria-label="Custom symbol or emoji"
                title="Or type a custom character or emoji"
                value={isBuiltInWorkspaceIcon(icon) ? '' : icon}
                onChange={(e) => {
                  const val = e.target.value.trim()
                  setIcon(val || 'compass')
                }}
              />
            </div>
          </div>

          <div className="ws-sheet-field">
            <div className="ws-sheet-label">Theme preset</div>
            <div className="ws-theme-pills" role="radiogroup" aria-label="Workspace theme preset">
              <button
                type="button"
                role="radio"
                aria-checked={themePreset === ''}
                className={`ws-theme-pill ${themePreset === '' ? 'on' : ''}`}
                onClick={() => setThemePreset('')}
              >
                <span>Inherit global</span>
              </button>
              {THEME_PRESETS.map((preset) => {
                const pal = isDark ? preset.dark : preset.light
                const selected = themePreset === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`ws-theme-pill ${selected ? 'on' : ''}`}
                    onClick={() => setThemePreset(preset.id)}
                  >
                    <span className="ws-theme-dot" style={{ background: pal.bgShell, borderColor: pal.tint }} aria-hidden>
                      <i style={{ background: pal.tint }} />
                    </span>
                    <span>{preset.name}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="ws-sheet-field">
            <div className="ws-sheet-label">Accent colour override</div>
            <div className="ws-accent-row">
              <button
                type="button"
                className={`set-pill ${accentColor === '' ? 'on' : ''}`}
                onClick={() => {
                  setAccentColor('')
                  setHexDraft('')
                }}
              >
                Inherit
              </button>
              <div className="accent-swatches" role="radiogroup" aria-label="Workspace accent colour override">
                {ACCENT_SWATCHES.filter((s) => s.hex !== '').map((sw) => {
                  const selected = accentColor === sw.hex
                  return (
                    <button
                      key={sw.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={sw.name}
                      title={sw.name}
                      className={`accent-swatch ${selected ? 'on' : ''}`}
                      style={{ background: sw.hex }}
                      onClick={() => {
                        setAccentColor(sw.hex)
                        setHexDraft(sw.hex)
                        const match = WORKSPACE_ACCENTS.find((a) => a.light === sw.hex)
                        if (match) setAccent(match.id)
                      }}
                    >
                      {selected ? <Check size={11} strokeWidth={2.6} style={{ color: '#fff' }} aria-hidden /> : null}
                    </button>
                  )
                })}
              </div>
              <div className="accent-custom">
                <label className="accent-picker-wrap" title="Pick a custom workspace accent colour">
                  <input
                    type="color"
                    className="accent-color-input"
                    aria-label="Custom workspace accent colour"
                    value={accentColor || '#b3492b'}
                    onChange={(e) => {
                      setAccentColor(e.target.value)
                      setHexDraft(e.target.value)
                    }}
                  />
                  <span className="accent-picker-dot" style={{ background: accentColor || 'var(--tint)' }} aria-hidden />
                </label>
                <input
                  type="text"
                  className="accent-hex-input"
                  aria-label="Workspace accent hex"
                  placeholder="Inherit"
                  maxLength={7}
                  value={hexDraft}
                  onChange={(e) => handleHexChange(e.target.value)}
                  onBlur={() => setHexDraft(accentColor)}
                />
              </div>
            </div>
          </div>

          <div className="ws-sheet-field">
            <div className="ws-sheet-label">Start-page background</div>
            <SegmentedControl
              options={START_BG_OPTIONS}
              value={startBackground}
              onChange={setStartBackground}
              ariaLabel="Workspace start-page background"
            />
          </div>

          <label className="ws-iso">
            <input
              type="checkbox"
              checked={isolated}
              onChange={(e) => setIsolated(e.target.checked)}
            />
            <span>
              <strong>Keep sign-ins separate</strong>
              <small>Use separate cookies and logins for this workspace</small>
            </span>
          </label>
        </div>

        <div className="sheet-foot ws-sheet-foot">
          {confirmDelete && workspace ? (
            <div className="ws-sheet-del-confirm">
              <span>
                Delete “{workspace.name}” and close {tabCount} {tabCount === 1 ? 'tab' : 'tabs'}?
              </span>
              <button type="button" className="btn sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button type="button" className="btn sm danger" onClick={() => void handleDelete()}>
                Delete
              </button>
            </div>
          ) : (
            <>
              {mode === 'edit' && canDelete ? (
                <button
                  type="button"
                  className="btn ghost ws-sheet-del"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={13} aria-hidden />
                  <span>Delete</span>
                </button>
              ) : (
                <span />
              )}
              <div className="ws-sheet-actions">
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  {mode === 'create' ? 'Create' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
