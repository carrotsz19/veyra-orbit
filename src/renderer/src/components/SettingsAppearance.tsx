import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ShieldAlert } from 'lucide-react'
import type {
  AddressBarAlign,
  AppearancePatch,
  BookmarkBarMode,
  BuiltinModId,
  MenuBarStyle,
  MotionMode,
  SettingsPatch,
  SettingsView,
  SidebarSide,
  TabCloseButtonsMode,
  TabLayout,
  ThemeSource,
  UiDensity
} from '@shared/types'
import {
  ACCENT_SWATCHES,
  APPEARANCE_LIMITS,
  DEFAULT_APPEARANCE,
  SIDEBAR_WIDTH_PRESETS,
  THEME_PRESETS,
  deriveAccentTokens,
  getThemePreset,
  normalizeHexColor
} from '@shared/appearance'
import { BUILTIN_MODS, MAX_CUSTOM_CSS_BYTES, utf8ByteLength } from '@shared/customCss'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'
import { ToolbarEditor } from './ToolbarEditor'

const api = window.veyra

const THEMES: readonly SegmentedOption<ThemeSource>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const DENSITIES: readonly SegmentedOption<UiDensity>[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' }
]

const MOTIONS: readonly SegmentedOption<MotionMode>[] = [
  { value: 'full', label: 'Full' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'off', label: 'Off' }
]

const TAB_LAYOUT_OPTIONS: readonly SegmentedOption<TabLayout>[] = [
  { value: 'sidebar', label: 'Sidebar (vertical)' },
  { value: 'top', label: 'Top bar (horizontal)' }
]

const SIDEBAR_SIDES: readonly SegmentedOption<SidebarSide>[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' }
]

const TAB_CLOSE_OPTIONS: readonly SegmentedOption<TabCloseButtonsMode>[] = [
  { value: 'hover', label: 'On hover' },
  { value: 'always', label: 'Always' }
]

const ADDR_ALIGNS: readonly SegmentedOption<AddressBarAlign>[] = [
  { value: 'center', label: 'Centred' },
  { value: 'left', label: 'Left' }
]

const MENU_STYLES: readonly SegmentedOption<MenuBarStyle>[] = [
  { value: 'full', label: 'Full menus' },
  { value: 'hamburger', label: 'Compact menu' }
]

const BOOKMARK_BAR_OPTIONS: readonly SegmentedOption<BookmarkBarMode>[] = [
  { value: 'always', label: 'Always' },
  { value: 'start-page', label: 'Only on start page' },
  { value: 'never', label: 'Never' }
]

const WINDOW_BUTTON_OPTIONS: readonly SegmentedOption<'windows' | 'dots'>[] = [
  { value: 'windows', label: 'Windows' },
  { value: 'dots', label: 'Veyra dots' }
]

interface Props {
  settings: SettingsView
  onPatch: (next: SettingsPatch) => void
  onSettingsReplaced: (next: SettingsView) => void
}

export function SettingsAppearance({ settings, onPatch, onSettingsReplaced }: Props): React.JSX.Element {
  const app = settings.appearance
  const [hexDraft, setHexDraft] = useState(app.accent)
  const [cssDraft, setCssDraft] = useState(app.customCss)
  const cssGutterRef = useRef<HTMLDivElement>(null)
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
    setCssDraft(app.customCss)
  }, [app.customCss])

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
          <button type="button" className="btn sm" onClick={() => void handleExport()}>
            Export
          </button>
          <button type="button" className="btn sm" onClick={() => void handleImport()}>
            Import
          </button>
          <button
            type="button"
            className="btn sm ghost"
            disabled={isDefaultAppearance}
            onClick={handleReset}
          >
            Reset
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
          <SegmentedControl
            options={THEMES}
            value={settings.theme}
            onChange={(id) => onPatch({ theme: id })}
            ariaLabel="Colour mode"
          />
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
              Contrast {derivedAccent.onTintContrast.toFixed(1)}:1
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
          <SegmentedControl
            options={DENSITIES}
            value={app.density}
            onChange={(id) => patchApp({ density: id })}
            ariaLabel="Density"
          />
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

      {/* Tabs & sidebar */}
      <h3 className="set-subhead">Tabs &amp; sidebar</h3>
      <div className="set-card">
        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Tab layout</div>
            <div className="set-desc">Keep vertical tabs in the sidebar or use a classic horizontal tab strip on top.</div>
          </div>
          <SegmentedControl
            options={TAB_LAYOUT_OPTIONS}
            value={app.tabLayout}
            onChange={(layout) => patchApp({ tabLayout: layout })}
            ariaLabel="Tab layout"
          />
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Show tab close buttons</div>
            <div className="set-desc">Show the close button only on hover and active tabs, or on every tab.</div>
          </div>
          <SegmentedControl
            options={TAB_CLOSE_OPTIONS}
            value={app.tabCloseButtons}
            onChange={(mode) => patchApp({ tabCloseButtons: mode })}
            ariaLabel="Show tab close buttons"
          />
        </div>

        {app.tabLayout === 'sidebar' && (
          <>
            <div className="set-row">
              <div className="set-row-info">
                <div className="set-label">Sidebar position</div>
                <div className="set-desc">Place vertical tabs on the left or right edge of the window.</div>
              </div>
              <SegmentedControl
                options={SIDEBAR_SIDES}
                value={app.sidebarSide}
                onChange={(side) => patchApp({ sidebarSide: side })}
                ariaLabel="Sidebar position"
              />
            </div>

            <div className="set-row stack">
              <div className="set-row-top">
                <div className="set-row-info">
                  <div className="set-label">Sidebar width</div>
                  <div className="set-desc">Choose a preset or drag the inner edge of the sidebar to resize it live.</div>
                </div>
                <div className="set-pills" role="group" aria-label="Sidebar width presets">
                  {SIDEBAR_WIDTH_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`set-pill ${app.sidebarWidth === preset.width ? 'on' : ''}`}
                      onClick={() => patchApp({ sidebarWidth: preset.width })}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
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
          </>
        )}
      </div>

      {/* Toolbar & Window */}
      <h3 className="set-subhead">Toolbar &amp; window</h3>
      <div className="set-card">
        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Address bar alignment</div>
            <div className="set-desc">Keep the address bar centred in the title bar or aligned to the left.</div>
          </div>
          <SegmentedControl
            options={ADDR_ALIGNS}
            value={app.addressBarAlign}
            onChange={(align) => patchApp({ addressBarAlign: align })}
            ariaLabel="Address bar alignment"
          />
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Menu bar</div>
            <div className="set-desc">Display full top-level menus or tuck them into a single menu button.</div>
          </div>
          <SegmentedControl
            options={MENU_STYLES}
            value={app.menuBarStyle}
            onChange={(style) => patchApp({ menuBarStyle: style })}
            ariaLabel="Menu bar style"
          />
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Bookmark bar</div>
            <div className="set-desc">Show saved bookmarks below the toolbar (<kbd>Ctrl+Shift+B</kbd>).</div>
          </div>
          <SegmentedControl
            options={BOOKMARK_BAR_OPTIONS}
            value={app.bookmarkBar}
            onChange={(mode) => patchApp({ bookmarkBar: mode })}
            ariaLabel="Bookmark bar"
          />
        </div>

        <div className="set-row stack" id="set-toolbar">
          <div className="set-row-info">
            <div className="set-label">Toolbar buttons</div>
            <div className="set-desc">
              Drag buttons between the toolbar and available list, or right-click the toolbar and choose “Customize toolbar…”.
            </div>
          </div>
          <ToolbarEditor
            items={app.toolbarItems}
            onChange={(next) => patchApp({ toolbarItems: next })}
          />
        </div>

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Compact mode</div>
            <div className="set-desc">
              Hide the sidebar and toolbar so the page fills the window. Move to the edge to reveal them (<kbd>Ctrl+Shift+S</kbd>).
            </div>
            {app.tabLayout === 'top' && (
              <div className="set-note">Compact mode is available when tabs are in the sidebar.</div>
            )}
          </div>
          <button
            type="button"
            role="switch"
            disabled={app.tabLayout === 'top'}
            aria-checked={app.tabLayout !== 'top' && settings.compactMode}
            aria-label="Compact mode"
            className={`set-switch ${app.tabLayout !== 'top' && settings.compactMode ? 'on' : ''}`}
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
              <SegmentedControl
                options={WINDOW_BUTTON_OPTIONS}
                value={settings.windowButtons}
                onChange={(val) => onPatch({ windowButtons: val })}
                ariaLabel="Window buttons"
              />
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
                : 'Controls interface transitions and animations.'}
            </div>
          </div>
          <SegmentedControl
            options={MOTIONS}
            value={app.motion}
            onChange={(m) => patchApp({ motion: m })}
            ariaLabel="Motion"
          />
        </div>
      </div>

      {/* Advanced: Mods & Custom CSS */}
      <h3 className="set-subhead" id="set-appearance-advanced">Advanced — Mods &amp; Custom CSS</h3>
      {settings.safeMode && (
        <div className="app-io-banner err css-safe-banner" role="status" aria-live="polite">
          <ShieldAlert size={14} aria-hidden />
          <span>
            Safe mode is active — Custom CSS and mods are disabled for this session. Restart Orbit without holding Shift or{' '}
            <code>--safe-mode</code> to re-enable them.
          </span>
        </div>
      )}
      <div className="set-card">
        {BUILTIN_MODS.map((mod) => {
          const enabled = app.enabledMods.includes(mod.id)
          const toggleMod = (): void => {
            const next: BuiltinModId[] = enabled
              ? app.enabledMods.filter((id) => id !== mod.id)
              : [...app.enabledMods, mod.id]
            patchApp({ enabledMods: next })
          }
          return (
            <div key={mod.id} className="set-row">
              <div className="set-row-info">
                <div className="set-label">{mod.name}</div>
                <div className="set-desc">{mod.description}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={mod.name}
                className={`set-switch ${enabled ? 'on' : ''}`}
                onClick={toggleMod}
              >
                <span className="set-switch-thumb" />
              </button>
            </div>
          )
        })}

        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Custom CSS</div>
            <div className="set-desc">
              Style Orbit&apos;s own interface windows only — never applied to web pages. Hold <kbd>Shift</kbd> while launching or pass{' '}
              <code>--safe-mode</code> to recover if a style breaks the UI.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={app.customCssEnabled}
            aria-label="Enable custom CSS"
            className={`set-switch ${app.customCssEnabled ? 'on' : ''}`}
            onClick={() => patchApp({ customCssEnabled: !app.customCssEnabled })}
          >
            <span className="set-switch-thumb" />
          </button>
        </div>

        <div className="set-row stack">
          <div className="css-editor-head">
            <span className="set-desc">
              <code>@import</code> and non-<code>data:</code> <code>url()</code> loads are stripped automatically.
            </span>
            <span className="css-byte-count">
              {(utf8ByteLength(cssDraft) / 1024).toFixed(1)} / {Math.round(MAX_CUSTOM_CSS_BYTES / 1024)} KB
            </span>
          </div>
          <div className="css-editor-wrap">
            <div ref={cssGutterRef} className="css-editor-gutter" aria-hidden>
              {Array.from({ length: Math.max(6, cssDraft.split('\n').length) }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              className="css-editor-input"
              spellCheck={false}
              aria-label="Custom CSS editor"
              placeholder={'/* Example: soften sidebar tabs */\n.tab.on {\n  border-radius: 12px;\n}'}
              value={cssDraft}
              onChange={(e) => setCssDraft(e.target.value)}
              onScroll={(e) => {
                if (cssGutterRef.current) cssGutterRef.current.scrollTop = e.currentTarget.scrollTop
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  patchApp({ customCss: cssDraft, customCssEnabled: true })
                }
              }}
            />
          </div>
          <div className="css-editor-actions">
            <button
              type="button"
              className="btn sm primary"
              disabled={cssDraft === app.customCss}
              onClick={() => {
                patchApp({ customCss: cssDraft })
                setIoStatus({ kind: 'ok', text: 'Custom CSS saved and applied.' })
              }}
            >
              Apply CSS
            </button>
            {cssDraft && (
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => {
                  setCssDraft('')
                  patchApp({ customCss: '' })
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
