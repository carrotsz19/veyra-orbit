import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Download,
  Monitor,
  Moon,
  RotateCcw,
  Sparkles,
  Sun,
  Upload
} from 'lucide-react'
import type {
  AddressBarAlign,
  AppearancePatch,
  MenuBarStyle,
  MotionMode,
  SettingsPatch,
  SettingsView,
  SidebarSide,
  TabCloseButtonsMode,
  ThemeSource,
  UiDensity
} from '@shared/types'
import {
  ACCENT_SWATCHES,
  APPEARANCE_LIMITS,
  DEFAULT_APPEARANCE,
  THEME_PRESETS,
  deriveAccentTokens,
  getThemePreset,
  normalizeHexColor
} from '@shared/appearance'

const api = window.veyra

const THEMES: { id: ThemeSource; label: string; icon: typeof Monitor }[] = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon }
]

const DENSITIES: { id: UiDensity; label: string }[] = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'spacious', label: 'Spacious' }
]

const MOTIONS: { id: MotionMode; label: string }[] = [
  { id: 'full', label: 'Full' },
  { id: 'reduced', label: 'Reduced' },
  { id: 'off', label: 'Off' }
]

interface Props {
  settings: SettingsView
  onPatch: (next: SettingsPatch) => void
  onSettingsReplaced: (next: SettingsView) => void
}

export function SettingsAppearance({ settings, onPatch, onSettingsReplaced }: Props): React.JSX.Element {
  const app = settings.appearance
  const [hexDraft, setHexDraft] = useState(app.accent)
  const [ioStatus, setIoStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  const [systemReducedMotion, setSystemReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    setHexDraft(app.accent)
  }, [app.accent])

  useEffect(() => {
    const mqDark = window.matchMedia('(prefers-color-scheme: dark)')
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onDark = (): void => setSystemDark(mqDark.matches)
    const onMotion = (): void => setSystemReducedMotion(mqMotion.matches)
    mqDark.addEventListener('change', onDark)
    mqMotion.addEventListener('change', onMotion)
    return () => {
      mqDark.removeEventListener('change', onDark)
      mqMotion.removeEventListener('change', onMotion)
    }
  }, [])

  useEffect(() => {
    if (!ioStatus) return
    const t = setTimeout(() => setIoStatus(null), 4500)
    return () => clearTimeout(t)
  }, [ioStatus])

  const previewDark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark)
  const activePreset = getThemePreset(app.preset)
  const activePal = previewDark ? activePreset.dark : activePreset.light
  const effectiveAccent = app.accent || activePal.tint
  const derivedAccent = useMemo(
    () => deriveAccentTokens(effectiveAccent, previewDark, activePal.bgElevated, activePal.bgGrouped),
    [effectiveAccent, previewDark, activePal.bgElevated, activePal.bgGrouped]
  )

  const patchApp = (next: AppearancePatch): void => {
    onPatch({ appearance: next })
  }

  const handleHexChange = (raw: string): void => {
    setHexDraft(raw)
    const trimmed = raw.trim()
    if (trimmed === '') {
      patchApp({ accent: '' })
      return
    }
    const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
    const norm = normalizeHexColor(candidate)
    if (norm) patchApp({ accent: norm })
  }

  const handleExport = async (): Promise<void> => {
    const res = await api.exportAppearanceTheme()
    if (res.canceled) return
    if (res.ok) setIoStatus({ kind: 'ok', text: 'Theme exported to JSON.' })
    else setIoStatus({ kind: 'err', text: res.error || 'Could not export theme.' })
  }

  const handleImport = async (): Promise<void> => {
    const res = await api.importAppearanceTheme()
    if (res.canceled) return
    if (res.ok && res.settings) {
      onSettingsReplaced(res.settings)
      setIoStatus({ kind: 'ok', text: 'Theme imported and applied.' })
    } else {
      setIoStatus({ kind: 'err', text: res.error || 'Could not import theme.' })
    }
  }

  const handleReset = (): void => {
    onPatch({ appearance: { ...DEFAULT_APPEARANCE } })
    setIoStatus({ kind: 'ok', text: 'Appearance reset to defaults.' })
  }

  const isDefaultAppearance = JSON.stringify(app) === JSON.stringify(DEFAULT_APPEARANCE)

  return (
    <section className="set-section" id="set-appearance" aria-labelledby="set-appearance-h">
      <div className="set-section-head">
        <h2 id="set-appearance-h">Appearance</h2>
        <div className="set-section-tools">
          <button type="button" className="btn sm set-icon-btn" onClick={() => void handleExport()}>
            <Download size={13} aria-hidden />
            <span>Export JSON</span>
          </button>
          <button type="button" className="btn sm set-icon-btn" onClick={() => void handleImport()}>
            <Upload size={13} aria-hidden />
            <span>Import JSON</span>
          </button>
          <button
            type="button"
            className="btn sm ghost set-icon-btn"
            disabled={isDefaultAppearance}
            onClick={handleReset}
          >
            <RotateCcw size={13} aria-hidden />
            <span>Reset appearance</span>
          </button>
        </div>
      </div>

      {ioStatus && (
        <div className={`app-io-banner ${ioStatus.kind}`} role="status" aria-live="polite">
          {ioStatus.text}
        </div>
      )}

      {/* Theme mode & presets */}
      <div className="set-card">
        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Colour mode</div>
            <div className="set-desc">Follow your system theme or stay in light or dark mode.</div>
          </div>
          <div className="set-seg" role="radiogroup" aria-label="Colour mode">
            {THEMES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={settings.theme === id}
                className={`set-seg-btn ${settings.theme === id ? 'on' : ''}`}
                onClick={() => onPatch({ theme: id })}
              >
                <Icon size={14} aria-hidden />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="set-row stack">
          <div className="set-row-info">
            <div className="set-label">Theme preset</div>
            <div className="set-desc">Full light and dark surface palettes crafted for calm reading and high legibility.</div>
          </div>
          <div className="preset-grid" role="radiogroup" aria-label="Theme preset">
            {THEME_PRESETS.map((preset) => {
              const p = previewDark ? preset.dark : preset.light
              const active = app.preset === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`preset-card ${active ? 'on' : ''}`}
                  onClick={() => patchApp({ preset: preset.id })}
                >
                  <div
                    className="preset-preview"
                    aria-hidden
                    style={{
                      background: p.bgShell,
                      borderColor: p.hairlineStrong
                    }}
                  >
                    <div className="preset-mini-bar">
                      <span className="preset-mini-dots">
                        <i style={{ background: p.labelTertiary }} />
                        <i style={{ background: p.labelTertiary }} />
                      </span>
                      <span className="preset-mini-pill" style={{ background: p.fillSecondary }} />
                    </div>
                    <div className="preset-mini-body">
                      <div className="preset-mini-side">
                        <span className="preset-mini-tab active" style={{ background: p.bgSurfaceRaised, borderColor: p.hairlineStrong }}>
                          <i style={{ background: p.tint }} />
                        </span>
                        <span className="preset-mini-tab" style={{ background: p.fillTertiary }} />
                        <span className="preset-mini-tab" style={{ background: p.fillTertiary }} />
                      </div>
                      <div
                        className="preset-mini-page"
                        style={{
                          background: p.bgElevated,
                          borderColor: p.hairline
                        }}
                      >
                        <span className="preset-mini-accent" style={{ background: p.tint }} />
                        <span className="preset-mini-line" style={{ background: p.labelPrimary }} />
                        <span className="preset-mini-line short" style={{ background: p.labelTertiary }} />
                      </div>
                    </div>
                  </div>
                  <div className="preset-meta">
                    <span className="preset-name">{preset.name}</span>
                    <span className="preset-tagline">{preset.tagline}</span>
                  </div>
                  {active && (
                    <span className="preset-check" aria-hidden>
                      <Check size={12} strokeWidth={2.5} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="set-row stack">
          <div className="set-row-top">
            <div className="set-row-info">
              <div className="set-label">Accent colour</div>
              <div className="set-desc">
                Soft, hover, and text-on-accent variants are derived automatically to keep contrast ≥ 4.5:1.
              </div>
            </div>
            <span className="app-contrast-badge" title="WCAG AA contrast ratio for text on accent controls">
              <Sparkles size={12} aria-hidden />
              <span>{derivedAccent.onTintContrast.toFixed(1)}:1 AA</span>
            </span>
          </div>
          <div className="accent-controls">
            <div className="accent-swatches" role="radiogroup" aria-label="Accent colour presets">
              {ACCENT_SWATCHES.map((sw) => {
                const selected = app.accent === sw.hex
                const swatchColor = sw.hex || activePal.tint
                return (
                  <button
                    key={sw.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={sw.name}
                    title={sw.name}
                    className={`accent-swatch ${selected ? 'on' : ''} ${sw.hex === '' ? 'default-swatch' : ''}`}
                    style={{ background: swatchColor }}
                    onClick={() => patchApp({ accent: sw.hex })}
                  >
                    {selected ? (
                      <Check size={12} strokeWidth={2.6} style={{ color: deriveAccentTokens(swatchColor, previewDark, activePal.bgElevated).onTint }} aria-hidden />
                    ) : sw.hex === '' ? (
                      <Sparkles size={11} strokeWidth={2.2} style={{ color: deriveAccentTokens(swatchColor, previewDark, activePal.bgElevated).onTint }} aria-hidden />
                    ) : null}
                  </button>
                )
              })}
            </div>
            <div className="accent-custom">
              <label className="accent-picker-wrap" title="Pick a custom accent colour">
                <input
                  type="color"
                  className="accent-color-input"
                  aria-label="Custom accent colour picker"
                  value={effectiveAccent}
                  onChange={(e) => patchApp({ accent: e.target.value })}
                />
                <span className="accent-picker-dot" style={{ background: effectiveAccent }} aria-hidden />
              </label>
              <input
                type="text"
                className="accent-hex-input"
                aria-label="Custom accent hex colour"
                placeholder={activePal.tint}
                maxLength={7}
                value={hexDraft}
                onChange={(e) => handleHexChange(e.target.value)}
                onBlur={() => setHexDraft(app.accent)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Shape, density & typography */}
      <h3 className="set-subhead">Shape &amp; scale</h3>
      <div className="set-card">
        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Density</div>
            <div className="set-desc">Controls tab height, toolbar height, and breathing room across panels.</div>
          </div>
          <div className="set-seg" role="radiogroup" aria-label="Density">
            {DENSITIES.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={app.density === d.id}
                className={`set-seg-btn ${app.density === d.id ? 'on' : ''}`}
                onClick={() => patchApp({ density: d.id })}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Corner roundness</div>
            <div className="set-desc">Applies smoothly to tabs, inputs, buttons, menus, and floating cards.</div>
          </div>
          <div className="set-slider-wrap">
            <input
              type="range"
              className="set-slider"
              aria-label="Corner roundness"
              min={APPEARANCE_LIMITS.cornerRadius.min}
              max={APPEARANCE_LIMITS.cornerRadius.max}
              step={1}
              value={app.cornerRadius}
              onChange={(e) => patchApp({ cornerRadius: Number(e.target.value) })}
            />
            <span className="set-slider-val">{app.cornerRadius} px</span>
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">UI text size</div>
            <div className="set-desc">Scales browser chrome typography without changing web page zoom.</div>
          </div>
          <div className="set-slider-wrap">
            <input
              type="range"
              className="set-slider"
              aria-label="UI text size"
              min={APPEARANCE_LIMITS.textScale.min}
              max={APPEARANCE_LIMITS.textScale.max}
              step={5}
              value={app.textScale}
              onChange={(e) => patchApp({ textScale: Number(e.target.value) })}
            />
            <span className="set-slider-val">{app.textScale}%</span>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <h3 className="set-subhead">Sidebar</h3>
      <div className="set-card">
        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Sidebar position</div>
            <div className="set-desc">Place vertical tabs on the left or right edge of the window.</div>
          </div>
          <div className="set-seg" role="radiogroup" aria-label="Sidebar position">
            {(['left', 'right'] as SidebarSide[]).map((side) => (
              <button
                key={side}
                type="button"
                role="radio"
                aria-checked={app.sidebarSide === side}
                className={`set-seg-btn ${app.sidebarSide === side ? 'on' : ''}`}
                onClick={() => patchApp({ sidebarSide: side })}
              >
                {side === 'left' ? 'Left' : 'Right'}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Sidebar width</div>
            <div className="set-desc">You can also drag the inner edge of the sidebar to resize it live.</div>
          </div>
          <div className="set-slider-wrap">
            <input
              type="range"
              className="set-slider"
              aria-label="Sidebar width"
              min={APPEARANCE_LIMITS.sidebarWidth.min}
              max={APPEARANCE_LIMITS.sidebarWidth.max}
              step={4}
              value={app.sidebarWidth}
              onChange={(e) => patchApp({ sidebarWidth: Number(e.target.value) })}
            />
            <span className="set-slider-val">{app.sidebarWidth} px</span>
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Translucent sidebar</div>
            <div className="set-desc">
              {settings.supportsAcrylic
                ? 'Subtle Windows 11 acrylic backdrop behind the sidebar and title bar.'
                : 'Uses a solid theme surface on systems without acrylic backdrop support.'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={app.translucentSidebar}
            aria-label="Translucent sidebar"
            className={`set-switch ${app.translucentSidebar ? 'on' : ''}`}
            onClick={() => patchApp({ translucentSidebar: !app.translucentSidebar })}
          >
            <span className="set-switch-thumb" />
          </button>
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Tab close buttons</div>
            <div className="set-desc">Show the close button only on hover and active tabs, or on every tab.</div>
          </div>
          <div className="set-seg" role="radiogroup" aria-label="Tab close buttons">
            {(['hover', 'always'] as TabCloseButtonsMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={app.tabCloseButtons === mode}
                className={`set-seg-btn ${app.tabCloseButtons === mode ? 'on' : ''}`}
                onClick={() => patchApp({ tabCloseButtons: mode })}
              >
                {mode === 'hover' ? 'On hover' : 'Always'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Toolbar & Window */}
      <h3 className="set-subhead">Toolbar &amp; window</h3>
      <div className="set-card">
        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Address bar alignment</div>
            <div className="set-desc">Keep the pill address bar centred in the title bar or aligned to the left.</div>
          </div>
          <div className="set-seg" role="radiogroup" aria-label="Address bar alignment">
            {(['center', 'left'] as AddressBarAlign[]).map((align) => (
              <button
                key={align}
                type="button"
                role="radio"
                aria-checked={app.addressBarAlign === align}
                className={`set-seg-btn ${app.addressBarAlign === align ? 'on' : ''}`}
                onClick={() => patchApp({ addressBarAlign: align })}
              >
                {align === 'center' ? 'Centred' : 'Left'}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Menu bar</div>
            <div className="set-desc">Display full top-level menus or tuck them into a single ☰ menu button.</div>
          </div>
          <div className="set-seg" role="radiogroup" aria-label="Menu bar style">
            {(['full', 'hamburger'] as MenuBarStyle[]).map((style) => (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={app.menuBarStyle === style}
                className={`set-seg-btn ${app.menuBarStyle === style ? 'on' : ''}`}
                onClick={() => patchApp({ menuBarStyle: style })}
              >
                {style === 'full' ? 'Full menus' : 'Single ☰ menu'}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row stack">
          <div className="set-row-info">
            <div className="set-label">Toolbar buttons</div>
            <div className="set-desc">Choose which controls appear around the address bar.</div>
          </div>
          <div className="set-checks">
            <label className="set-check">
              <input
                type="checkbox"
                checked={app.showNavButtons}
                onChange={(e) => patchApp({ showNavButtons: e.target.checked })}
              />
              <span>Back, forward &amp; reload</span>
            </label>
            <label className="set-check">
              <input
                type="checkbox"
                checked={app.showBookmarkStar}
                onChange={(e) => patchApp({ showBookmarkStar: e.target.checked })}
              />
              <span>Bookmark star</span>
            </label>
            <label className="set-check">
              <input
                type="checkbox"
                checked={app.showExtensions}
                onChange={(e) => patchApp({ showExtensions: e.target.checked })}
              />
              <span>Extensions buttons</span>
            </label>
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Compact mode</div>
            <div className="set-desc">
              Hide the sidebar and toolbar so the page fills the window. Move to the edge to reveal them (<kbd>Ctrl+Shift+S</kbd>).
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.compactMode}
            aria-label="Compact mode"
            className={`set-switch ${settings.compactMode ? 'on' : ''}`}
            onClick={() => onPatch({ compactMode: !settings.compactMode })}
          >
            <span className="set-switch-thumb" />
          </button>
        </div>

        {settings.supportsWindowButtons && (
          <div className="set-row">
            <div className="set-row-info">
              <div className="set-label">Window buttons</div>
              <div className="set-desc">
                {settings.windowButtons === 'windows'
                  ? "Windows' own minimise, maximise and close buttons (supports Snap layouts)."
                  : 'Mac-style Veyra dots drawn in the title bar, in Windows order.'}
              </div>
              {settings.windowButtons !== settings.activeWindowButtons && (
                <div className="set-note">Takes effect after restarting Veyra Orbit.</div>
              )}
            </div>
            <div className="set-row-actions">
              <div className="set-seg" role="radiogroup" aria-label="Window buttons">
                <button
                  type="button"
                  role="radio"
                  aria-checked={settings.windowButtons === 'windows'}
                  className={`set-seg-btn ${settings.windowButtons === 'windows' ? 'on' : ''}`}
                  onClick={() => onPatch({ windowButtons: 'windows' })}
                >
                  Windows
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={settings.windowButtons === 'dots'}
                  className={`set-seg-btn ${settings.windowButtons === 'dots' ? 'on' : ''}`}
                  onClick={() => onPatch({ windowButtons: 'dots' })}
                >
                  Veyra dots
                </button>
              </div>
              {settings.windowButtons !== settings.activeWindowButtons && (
                <button type="button" className="btn primary" onClick={() => api.relaunch()}>
                  Restart now
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Page card & motion */}
      <h3 className="set-subhead">Page card &amp; motion</h3>
      <div className="set-card">
        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Gap around page</div>
            <div className="set-desc">Breathing space between the web page card and window edges.</div>
          </div>
          <div className="set-slider-wrap">
            <input
              type="range"
              className="set-slider"
              aria-label="Gap around page"
              min={APPEARANCE_LIMITS.pageGap.min}
              max={APPEARANCE_LIMITS.pageGap.max}
              step={1}
              value={app.pageGap}
              onChange={(e) => patchApp({ pageGap: Number(e.target.value) })}
            />
            <span className="set-slider-val">{app.pageGap} px</span>
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Page corner radius</div>
            <div className="set-desc">Rounding applied to both the page frame and live web view.</div>
          </div>
          <div className="set-slider-wrap">
            <input
              type="range"
              className="set-slider"
              aria-label="Page corner radius"
              min={APPEARANCE_LIMITS.pageRadius.min}
              max={APPEARANCE_LIMITS.pageRadius.max}
              step={1}
              value={app.pageRadius}
              onChange={(e) => patchApp({ pageRadius: Number(e.target.value) })}
            />
            <span className="set-slider-val">{app.pageRadius} px</span>
          </div>
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Page shadow</div>
            <div className="set-desc">Soft elevation separating the page card from the shell surface.</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={app.pageShadow}
            aria-label="Page shadow"
            className={`set-switch ${app.pageShadow ? 'on' : ''}`}
            onClick={() => patchApp({ pageShadow: !app.pageShadow })}
          >
            <span className="set-switch-thumb" />
          </button>
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Motion</div>
            <div className="set-desc">
              {systemReducedMotion && app.motion === 'full'
                ? 'Reduced automatically because your OS prefers reduced motion.'
                : 'Controls micro-transitions and ambient start-page animation.'}
            </div>
          </div>
          <div className="set-seg" role="radiogroup" aria-label="Motion">
            {MOTIONS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={app.motion === m.id}
                className={`set-seg-btn ${app.motion === m.id ? 'on' : ''}`}
                onClick={() => patchApp({ motion: m.id })}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
