import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Image as ImageIcon,
  Palette,
  Sparkles,
  Square,
  Trash2,
  X
} from 'lucide-react'
import type {
  ClockFormat,
  QuickLinkSize,
  StartBackgroundMode,
  StartLayout,
  StartPagePatch,
  StartPageSettings,
  StartWidgetId,
  UiDensity
} from '@shared/types'
import { START_PAGE_LIMITS, WIDGET_LABELS, reorderList } from '@shared/startpage'

interface Props {
  open: boolean
  config: StartPageSettings
  hasCustomImage: boolean
  bgError: string | null
  onClose: () => void
  onPatch: (patch: StartPagePatch) => void
  onChooseImage: () => void
  onRemoveImage: () => void
  onOpenAppearance: () => void
}

const BG_OPTIONS: { id: StartBackgroundMode; label: string; icon: typeof Sparkles }[] = [
  { id: 'ambient', label: 'Ambient', icon: Sparkles },
  { id: 'solid', label: 'Solid', icon: Square },
  { id: 'image', label: 'Image', icon: ImageIcon }
]

const DENSITY_OPTIONS: { id: UiDensity; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'spacious', label: 'Spacious' }
]

const LINK_SIZE_OPTIONS: { id: QuickLinkSize; label: string }[] = [
  { id: 'sm', label: 'S' },
  { id: 'md', label: 'M' },
  { id: 'lg', label: 'L' }
]

export function StartCustomizeDrawer({
  open,
  config,
  hasCustomImage,
  bgError,
  onClose,
  onPatch,
  onChooseImage,
  onRemoveImage,
  onOpenAppearance
}: Props): React.JSX.Element {
  const [nameDraft, setNameDraft] = useState(config.userName)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setNameDraft(config.userName)
  }, [config.userName])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => closeBtnRef.current?.focus())
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const toggleWidget = (id: StartWidgetId): void => {
    onPatch({
      widgets: config.widgets.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w))
    })
  }

  const moveWidget = (from: number, to: number): void => {
    if (to < 0 || to >= config.widgets.length || from === to) return
    onPatch({ widgets: reorderList(config.widgets, from, to) })
  }

  return (
    <>
      {open && <div className="sp-drawer-backdrop" aria-hidden onClick={onClose} />}
      <aside
        className={`sp-drawer ${open ? 'open' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-label="Customize start page"
        aria-hidden={!open}
      >
        <header className="sp-drawer-head">
          <div>
            <h2>Customize start page</h2>
            <p>Changes apply instantly.</p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="icon-btn"
            aria-label="Close customize drawer"
            tabIndex={open ? 0 : -1}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>

        <div className="sp-drawer-body">
          {/* Background */}
          <section className="sp-dsec">
            <h3>Background</h3>
            <div className="set-seg sp-seg-full" role="radiogroup" aria-label="Start page background">
              {BG_OPTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={config.background === id}
                  tabIndex={open ? 0 : -1}
                  className={`set-seg-btn ${config.background === id ? 'on' : ''}`}
                  onClick={() => onPatch({ background: id })}
                >
                  <Icon size={13} aria-hidden />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {config.background === 'image' && (
              <div className="sp-bg-controls">
                <div className="sp-bg-actions">
                  <button type="button" className="btn sm primary set-icon-btn" tabIndex={open ? 0 : -1} onClick={onChooseImage}>
                    <ImageIcon size={13} aria-hidden />
                    <span>{hasCustomImage ? 'Change image…' : 'Choose image…'}</span>
                  </button>
                  {hasCustomImage && (
                    <button
                      type="button"
                      className="btn sm ghost set-icon-btn"
                      tabIndex={open ? 0 : -1}
                      onClick={onRemoveImage}
                    >
                      <Trash2 size={13} aria-hidden />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
                <p className="sp-dsec-hint">PNG, JPEG, or WebP up to 20 MB. Stored locally inside Orbit.</p>
                {bgError && (
                  <p className="sp-dsec-error" role="alert">
                    {bgError}
                  </p>
                )}

                <label className="sp-slider-row">
                  <span>Dim overlay</span>
                  <div className="sp-slider-ctrl">
                    <input
                      type="range"
                      className="set-slider"
                      tabIndex={open ? 0 : -1}
                      min={START_PAGE_LIMITS.backgroundDim.min}
                      max={START_PAGE_LIMITS.backgroundDim.max}
                      step={2}
                      value={config.backgroundDim}
                      onChange={(e) => onPatch({ backgroundDim: Number(e.target.value) })}
                    />
                    <span>{config.backgroundDim}%</span>
                  </div>
                </label>

                <label className="sp-slider-row">
                  <span>Blur</span>
                  <div className="sp-slider-ctrl">
                    <input
                      type="range"
                      className="set-slider"
                      tabIndex={open ? 0 : -1}
                      min={START_PAGE_LIMITS.backgroundBlur.min}
                      max={START_PAGE_LIMITS.backgroundBlur.max}
                      step={1}
                      value={config.backgroundBlur}
                      onChange={(e) => onPatch({ backgroundBlur: Number(e.target.value) })}
                    />
                    <span>{config.backgroundBlur} px</span>
                  </div>
                </label>
              </div>
            )}
          </section>

          {/* Layout & density */}
          <section className="sp-dsec">
            <h3>Layout &amp; density</h3>
            <div className="sp-drow">
              <span>Layout</span>
              <div className="set-seg compact" role="radiogroup" aria-label="Start page layout">
                {(['centered', 'wide'] as StartLayout[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={config.layout === id}
                    tabIndex={open ? 0 : -1}
                    className={`set-seg-btn ${config.layout === id ? 'on' : ''}`}
                    onClick={() => onPatch({ layout: id })}
                  >
                    {id === 'centered' ? 'Centred' : 'Wide grid'}
                  </button>
                ))}
              </div>
            </div>
            <div className="sp-drow">
              <span>Density</span>
              <div className="set-seg compact" role="radiogroup" aria-label="Start page density">
                {DENSITY_OPTIONS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={config.density === d.id}
                    tabIndex={open ? 0 : -1}
                    className={`set-seg-btn ${config.density === d.id ? 'on' : ''}`}
                    onClick={() => onPatch({ density: d.id })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Clock & greeting */}
          <section className="sp-dsec">
            <h3>Clock &amp; greeting</h3>
            <label className="sp-input-row">
              <span>Your name</span>
              <input
                type="text"
                className="sp-text-input"
                tabIndex={open ? 0 : -1}
                maxLength={START_PAGE_LIMITS.maxUserName}
                placeholder="Optional (e.g. Alex)"
                value={nameDraft}
                onChange={(e) => {
                  setNameDraft(e.target.value)
                  onPatch({ userName: e.target.value })
                }}
              />
            </label>
            <div className="sp-drow">
              <span>Clock format</span>
              <div className="set-seg compact" role="radiogroup" aria-label="Clock format">
                {(['12h', '24h'] as ClockFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    role="radio"
                    aria-checked={config.clockFormat === fmt}
                    tabIndex={open ? 0 : -1}
                    className={`set-seg-btn ${config.clockFormat === fmt ? 'on' : ''}`}
                    onClick={() => onPatch({ clockFormat: fmt })}
                  >
                    {fmt === '12h' ? '12-hour' : '24-hour'}
                  </button>
                ))}
              </div>
            </div>
            <div className="sp-drow">
              <span>Show seconds</span>
              <button
                type="button"
                role="switch"
                aria-checked={config.showSeconds}
                aria-label="Show seconds on clock"
                tabIndex={open ? 0 : -1}
                className={`set-switch ${config.showSeconds ? 'on' : ''}`}
                onClick={() => onPatch({ showSeconds: !config.showSeconds })}
              >
                <span className="set-switch-thumb" />
              </button>
            </div>
          </section>

          {/* Quick links */}
          <section className="sp-dsec">
            <h3>Quick links</h3>
            <div className="sp-drow">
              <span>Tile size</span>
              <div className="set-seg compact" role="radiogroup" aria-label="Quick link tile size">
                {LINK_SIZE_OPTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={config.quickLinkSize === s.id}
                    tabIndex={open ? 0 : -1}
                    className={`set-seg-btn ${config.quickLinkSize === s.id ? 'on' : ''}`}
                    onClick={() => onPatch({ quickLinkSize: s.id })}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="sp-slider-row">
              <span>Tiles per row</span>
              <div className="sp-slider-ctrl">
                <input
                  type="range"
                  className="set-slider"
                  tabIndex={open ? 0 : -1}
                  min={START_PAGE_LIMITS.quickLinkColumns.min}
                  max={START_PAGE_LIMITS.quickLinkColumns.max}
                  step={1}
                  value={config.quickLinkColumns}
                  onChange={(e) => onPatch({ quickLinkColumns: Number(e.target.value) })}
                />
                <span>{config.quickLinkColumns}</span>
              </div>
            </label>
          </section>

          {/* Widgets on/off & order */}
          <section className="sp-dsec">
            <h3>Widgets &amp; order</h3>
            <p className="sp-dsec-hint">Drag to reorder or use the arrow buttons.</p>
            <ul className="sp-widget-list">
              {config.widgets.map((w, idx) => {
                const meta = WIDGET_LABELS[w.id]
                return (
                  <li
                    key={w.id}
                    className={`sp-widget-item ${dragIdx === idx ? 'dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIdx !== null && dragIdx !== idx) moveWidget(dragIdx, idx)
                      setDragIdx(null)
                    }}
                    onDragEnd={() => setDragIdx(null)}
                  >
                    <span className="sp-widget-grip" aria-hidden>
                      <GripVertical size={13} />
                    </span>
                    <div className="sp-widget-info">
                      <span className="sp-widget-name">{meta.name}</span>
                      <span className="sp-widget-desc">{meta.desc}</span>
                    </div>
                    <div className="sp-widget-order">
                      <button
                        type="button"
                        className="icon-btn small"
                        aria-label={`Move ${meta.name} up`}
                        title="Move up"
                        tabIndex={open ? 0 : -1}
                        disabled={idx === 0}
                        onClick={() => moveWidget(idx, idx - 1)}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn small"
                        aria-label={`Move ${meta.name} down`}
                        title="Move down"
                        tabIndex={open ? 0 : -1}
                        disabled={idx === config.widgets.length - 1}
                        onClick={() => moveWidget(idx, idx + 1)}
                      >
                        <ArrowDown size={12} />
                      </button>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={w.enabled}
                      aria-label={`Toggle ${meta.name}`}
                      tabIndex={open ? 0 : -1}
                      className={`set-switch ${w.enabled ? 'on' : ''}`}
                      onClick={() => toggleWidget(w.id)}
                    >
                      <span className="set-switch-thumb" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        </div>

        <footer className="sp-drawer-foot">
          <button
            type="button"
            className="btn set-icon-btn sp-appearance-link"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onClose()
              onOpenAppearance()
            }}
          >
            <Palette size={14} aria-hidden />
            <span>More in Settings → Appearance</span>
          </button>
        </footer>
      </aside>
    </>
  )
}
