import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Image as ImageIcon, Trash2, X } from 'lucide-react'
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
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'

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

const BG_OPTIONS: readonly SegmentedOption<StartBackgroundMode>[] = [
  { value: 'solid', label: 'Default' },
  { value: 'tinted', label: 'Tinted' },
  { value: 'image', label: 'Image' }
]

const LAYOUT_OPTIONS: readonly SegmentedOption<StartLayout>[] = [
  { value: 'centered', label: 'Centred' },
  { value: 'wide', label: 'Wide' }
]

const DENSITY_OPTIONS: readonly SegmentedOption<UiDensity>[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Default' },
  { value: 'spacious', label: 'Spacious' }
]

const CLOCK_OPTIONS: readonly SegmentedOption<ClockFormat>[] = [
  { value: '12h', label: '12-hour' },
  { value: '24h', label: '24-hour' }
]

const LINK_SIZE_OPTIONS: readonly SegmentedOption<QuickLinkSize>[] = [
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' }
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
  const drawerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setNameDraft(config.userName)
  }, [config.userName])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => drawerRef.current?.focus({ preventScroll: true }))
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
        ref={drawerRef}
        tabIndex={-1}
        className={`sp-drawer ${open ? 'open' : ''}`}
        role="dialog"
        aria-modal="false"
        aria-label="Customize start page"
        aria-hidden={!open}
      >
        <header className="sp-drawer-head">
          <h2>Customize start page</h2>
          <button
            type="button"
            className="icon-btn small"
            aria-label="Close"
            title="Close (Esc)"
            tabIndex={open ? 0 : -1}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </header>

        <div className="sp-drawer-body">
          {/* Background */}
          <section className="sp-dsec">
            <h3>Background</h3>
            <div className="sp-sheet-group">
              <div className="sp-sheet-row stack">
                <SegmentedControl
                  fullWidth
                  options={BG_OPTIONS}
                  value={config.background}
                  onChange={(id) => onPatch({ background: id })}
                  ariaLabel="Start page background"
                  tabIndex={open ? 0 : -1}
                />
              </div>

              {config.background === 'image' && (
                <>
                  <div className="sp-sheet-row stack">
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
                    <p className="sp-dsec-hint">PNG, JPEG, or WebP up to 20 MB, stored locally.</p>
                    {bgError && (
                      <p className="sp-dsec-error" role="alert">
                        {bgError}
                      </p>
                    )}
                  </div>

                  <label className="sp-sheet-row">
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

                  <label className="sp-sheet-row">
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
                </>
              )}
            </div>
          </section>

          {/* Layout */}
          <section className="sp-dsec">
            <h3>Layout</h3>
            <div className="sp-sheet-group">
              <div className="sp-sheet-row">
                <span>Width</span>
                <SegmentedControl
                  compact
                  options={LAYOUT_OPTIONS}
                  value={config.layout}
                  onChange={(id) => onPatch({ layout: id })}
                  ariaLabel="Start page layout"
                  tabIndex={open ? 0 : -1}
                />
              </div>
              <div className="sp-sheet-row">
                <span>Density</span>
                <SegmentedControl
                  compact
                  options={DENSITY_OPTIONS}
                  value={config.density}
                  onChange={(id) => onPatch({ density: id })}
                  ariaLabel="Start page density"
                  tabIndex={open ? 0 : -1}
                />
              </div>
            </div>
          </section>

          {/* Greeting & clock */}
          <section className="sp-dsec">
            <h3>Greeting &amp; clock</h3>
            <div className="sp-sheet-group">
              <label className="sp-sheet-row">
                <span>Your name</span>
                <input
                  type="text"
                  className="sp-text-input sp-inline-input"
                  tabIndex={open ? 0 : -1}
                  maxLength={START_PAGE_LIMITS.maxUserName}
                  placeholder="Optional"
                  value={nameDraft}
                  onChange={(e) => {
                    setNameDraft(e.target.value)
                    onPatch({ userName: e.target.value })
                  }}
                />
              </label>
              <div className="sp-sheet-row">
                <span>Time format</span>
                <SegmentedControl
                  compact
                  options={CLOCK_OPTIONS}
                  value={config.clockFormat}
                  onChange={(fmt) => onPatch({ clockFormat: fmt })}
                  ariaLabel="Clock format"
                  tabIndex={open ? 0 : -1}
                />
              </div>
              <div className="sp-sheet-row">
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
            </div>
          </section>

          {/* Quick links */}
          <section className="sp-dsec">
            <h3>Quick links</h3>
            <div className="sp-sheet-group">
              <div className="sp-sheet-row">
                <span>Icon size</span>
                <SegmentedControl
                  compact
                  options={LINK_SIZE_OPTIONS}
                  value={config.quickLinkSize}
                  onChange={(id) => onPatch({ quickLinkSize: id })}
                  ariaLabel="Quick link tile size"
                  tabIndex={open ? 0 : -1}
                />
              </div>
              <label className="sp-sheet-row">
                <span>Per row</span>
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
            </div>
          </section>

          {/* Sections */}
          <section className="sp-dsec">
            <h3>Sections</h3>
            <ul className="sp-sheet-group sp-widget-list">
              {config.widgets.map((w, idx) => {
                const meta = WIDGET_LABELS[w.id]
                return (
                  <li
                    key={w.id}
                    className={`sp-sheet-row sp-widget-item ${dragIdx === idx ? 'dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIdx !== null && dragIdx !== idx) moveWidget(dragIdx, idx)
                      setDragIdx(null)
                    }}
                    onDragEnd={() => setDragIdx(null)}
                  >
                    <span className="sp-widget-grip" aria-hidden title="Drag to reorder">
                      <GripVertical size={13} />
                    </span>
                    <div className="sp-widget-info">
                      <span className="sp-widget-name">{meta.name}</span>
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
            className="btn sp-appearance-link"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onClose()
              onOpenAppearance()
            }}
          >
            More in Settings → Appearance
          </button>
        </footer>
      </aside>
    </>
  )
}
