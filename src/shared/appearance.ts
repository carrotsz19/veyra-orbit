/*
 * Appearance customization engine: theme presets (light & dark token sets),
 * WCAG-checked accent colour derivation (>= 4.5:1 contrast), strict sanitization,
 * live CSS custom-property resolution, and safe JSON theme export/import.
 *
 * Pure module (no Electron or Node imports) so it runs in main, renderers, and unit tests.
 */
import {
  DEFAULT_TOOLBAR_ITEMS,
  deriveLegacyToolbarFlags,
  migrateLegacyToolbarButtons,
  sanitizeToolbarItems,
  type ToolbarItemId
} from './toolbar.ts'
import {
  buildEffectiveCustomCss,
  sanitizeCustomCss,
  sanitizeEnabledMods,
  type BuiltinModId
} from './customCss.ts'

export const THEME_PRESET_IDS = [
  'veyra-clay',
  'midnight',
  'paper',
  'forest',
  'ocean',
  'rose',
  'graphite'
] as const

export type ThemePresetId = (typeof THEME_PRESET_IDS)[number]
export type UiDensity = 'compact' | 'comfortable' | 'spacious'
export type TabLayout = 'sidebar' | 'top'
export type SidebarSide = 'left' | 'right'
export type TabCloseButtonsMode = 'hover' | 'always'
export type AddressBarAlign = 'center' | 'left'
export type MenuBarStyle = 'full' | 'hamburger'
export type BookmarkBarMode = 'always' | 'start-page' | 'never'
export type MotionMode = 'full' | 'reduced' | 'off'

export const SIDEBAR_WIDTH_PRESETS = Object.freeze([
  { id: 'narrow', label: 'Narrow', width: 204 },
  { id: 'default', label: 'Default', width: 248 },
  { id: 'wide', label: 'Wide', width: 308 }
] as const)

export interface AppearanceSettings {
  /** Named colour palette (full light + dark token set). */
  preset: ThemePresetId
  /** '' = use active theme preset's default accent; otherwise lowercase #rrggbb hex. */
  accent: string
  /** Corner roundness scale for controls and cards (0..24 px). */
  cornerRadius: number
  /** Vertical & horizontal rhythm across sidebar, toolbar, and internal pages. */
  density: UiDensity
  /** Root UI text scale percentage (90..120). */
  textScale: number
  /** Tab strip layout: vertical sidebar (default) or horizontal top tab bar. */
  tabLayout: TabLayout
  /** Which side of the window the vertical tab sidebar sits on. */
  sidebarSide: SidebarSide
  /** Sidebar width in CSS pixels (200..360). */
  sidebarWidth: number
  /** Windows 11 acrylic backdrop behind sidebar/titlebar where available (solid fallback). */
  translucentSidebar: boolean
  /** Whether tab close buttons appear only on hover/active or always. */
  tabCloseButtons: TabCloseButtonsMode
  /** Address bar horizontal alignment in the title bar. */
  addressBarAlign: AddressBarAlign
  /** Show back / forward / reload navigation buttons (migrated into toolbarItems). */
  showNavButtons: boolean
  /** Show bookmark star button (migrated into toolbarItems). */
  showBookmarkStar: boolean
  /** Show extensions toolbar buttons & puzzle overflow (migrated into toolbarItems). */
  showExtensions: boolean
  /** Ordered toolbar layout including 'address-bar' and active toolbar buttons. */
  toolbarItems: ToolbarItemId[]
  /** Full title-bar menus (File/Edit/...) or single hamburger menu. */
  menuBarStyle: MenuBarStyle
  /** Bookmark bar visibility: always, only on start page (default), or never. */
  bookmarkBar: BookmarkBarMode
  /** Gap around the web page card in CSS pixels (0..16). */
  pageGap: number
  /** Corner radius of the web page card and native WebContentsView (0..24). */
  pageRadius: number
  /** Drop shadow behind the web page card. */
  pageShadow: boolean
  /** Motion level; 'full' still honours OS prefers-reduced-motion. */
  motion: MotionMode
  /** Whether user custom CSS is active on Orbit's UI chrome (never applied to web pages). */
  customCssEnabled: boolean
  /** Sanitized custom CSS snippet applied only to Orbit's own UI windows (max 64 KB). */
  customCss: string
  /** Enabled built-in UI CSS mods. */
  enabledMods: BuiltinModId[]
}

export type AppearancePatch = Partial<AppearanceSettings>

export const APPEARANCE_LIMITS = Object.freeze({
  cornerRadius: { min: 0, max: 24, default: 10 },
  textScale: { min: 90, max: 120, default: 100 },
  sidebarWidth: { min: 200, max: 360, default: 248 },
  pageGap: { min: 0, max: 16, default: 8 },
  pageRadius: { min: 0, max: 24, default: 10 }
})

export const DEFAULT_APPEARANCE: Readonly<AppearanceSettings> = Object.freeze({
  preset: 'veyra-clay',
  accent: '',
  cornerRadius: 10,
  density: 'comfortable',
  textScale: 100,
  tabLayout: 'sidebar',
  sidebarSide: 'left',
  sidebarWidth: 248,
  translucentSidebar: true,
  tabCloseButtons: 'hover',
  addressBarAlign: 'center',
  showNavButtons: true,
  showBookmarkStar: true,
  showExtensions: true,
  toolbarItems: DEFAULT_TOOLBAR_ITEMS as unknown as ToolbarItemId[],
  menuBarStyle: 'full',
  bookmarkBar: 'start-page',
  pageGap: 8,
  pageRadius: 10,
  pageShadow: true,
  motion: 'full',
  customCssEnabled: false,
  customCss: '',
  enabledMods: Object.freeze([]) as unknown as BuiltinModId[]
})

export interface PresetPalette {
  bgShell: string
  bgGrouped: string
  bgElevated: string
  bgSurfaceRaised: string
  bgFloat: string
  fillSecondary: string
  fillTertiary: string
  fillHover: string
  fillActive: string
  hairline: string
  hairlineStrong: string
  hairlineInset: string
  labelPrimary: string
  labelSecondary: string
  labelTertiary: string
  tint: string
  positive: string
  warning: string
  symbolColor: string
  scrollbarThumb: string
  scrollbarThumbHover: string
  shadow1: string
  shadow2: string
  shadow3: string
}

export interface ThemePresetDefinition {
  id: ThemePresetId
  name: string
  tagline: string
  light: PresetPalette
  dark: PresetPalette
}

export interface AccentSwatch {
  id: string
  name: string
  /** Empty string represents the active theme preset's built-in accent. */
  hex: string
}

export const ACCENT_SWATCHES: readonly AccentSwatch[] = [
  { id: 'preset', name: 'Theme default', hex: '' },
  { id: 'clay', name: 'Clay', hex: '#b3492b' },
  { id: 'indigo', name: 'Indigo', hex: '#4f5fd6' },
  { id: 'forest', name: 'Forest', hex: '#2f6b47' },
  { id: 'ocean', name: 'Ocean', hex: '#1b6d85' },
  { id: 'rose', name: 'Rosé', hex: '#a84461' },
  { id: 'plum', name: 'Plum', hex: '#78497a' },
  { id: 'amber', name: 'Amber', hex: '#9a6a12' },
  { id: 'slate', name: 'Graphite', hex: '#4a5568' }
]

const LIGHT_SHADOWS = {
  shadow1: '0 1px 2px rgba(24, 24, 24, 0.06), 0 1px 3px rgba(24, 24, 24, 0.04)',
  shadow2: '0 2px 6px rgba(24, 24, 24, 0.06), 0 8px 22px rgba(24, 24, 24, 0.08)',
  shadow3: '0 2px 6px rgba(24, 24, 24, 0.06), 0 12px 32px rgba(24, 24, 24, 0.12), 0 24px 48px rgba(24, 24, 24, 0.08)'
}

const DARK_SHADOWS = {
  shadow1: '0 1px 2px rgba(0, 0, 0, 0.36), 0 2px 4px rgba(0, 0, 0, 0.24)',
  shadow2: '0 2px 6px rgba(0, 0, 0, 0.40), 0 10px 26px rgba(0, 0, 0, 0.34)',
  shadow3: '0 4px 12px rgba(0, 0, 0, 0.44), 0 16px 38px rgba(0, 0, 0, 0.48), 0 28px 56px rgba(0, 0, 0, 0.32)'
}

export const THEME_PRESETS: readonly ThemePresetDefinition[] = [
  {
    id: 'veyra-clay',
    name: 'Veyra Clay',
    tagline: 'Warm stone paper & terracotta',
    light: {
      bgShell: '#ebe8e1',
      bgGrouped: '#f4f2ed',
      bgElevated: '#ffffff',
      bgSurfaceRaised: '#ffffff',
      bgFloat: '#fbfaf7',
      fillSecondary: '#e5e1d8',
      fillTertiary: 'rgba(27, 26, 24, 0.045)',
      fillHover: 'rgba(27, 26, 24, 0.068)',
      fillActive: 'rgba(27, 26, 24, 0.105)',
      hairline: 'rgba(27, 26, 24, 0.085)',
      hairlineStrong: 'rgba(27, 26, 24, 0.14)',
      hairlineInset: 'rgba(255, 255, 255, 0.72)',
      labelPrimary: '#1b1a18',
      labelSecondary: '#615d55',
      labelTertiary: 'rgba(27, 26, 24, 0.46)',
      tint: '#b3492b',
      positive: '#356341',
      warning: '#94620d',
      symbolColor: '#57534b',
      scrollbarThumb: 'rgba(27, 26, 24, 0.14)',
      scrollbarThumbHover: 'rgba(27, 26, 24, 0.30)',
      ...LIGHT_SHADOWS
    },
    dark: {
      bgShell: '#12110d',
      bgGrouped: '#181612',
      bgElevated: '#1c1a15',
      bgSurfaceRaised: '#24211b',
      bgFloat: '#1f1d18',
      fillSecondary: '#28251f',
      fillTertiary: 'rgba(242, 239, 232, 0.055)',
      fillHover: 'rgba(242, 239, 232, 0.085)',
      fillActive: 'rgba(242, 239, 232, 0.125)',
      hairline: 'rgba(242, 239, 232, 0.08)',
      hairlineStrong: 'rgba(242, 239, 232, 0.14)',
      hairlineInset: 'rgba(255, 250, 240, 0.06)',
      labelPrimary: '#f2efe8',
      labelSecondary: '#a8a296',
      labelTertiary: 'rgba(242, 239, 232, 0.48)',
      tint: '#d9633e',
      positive: '#7fae87',
      warning: '#d8a54a',
      symbolColor: '#c8c2b6',
      scrollbarThumb: 'rgba(242, 239, 232, 0.14)',
      scrollbarThumbHover: 'rgba(242, 239, 232, 0.30)',
      ...DARK_SHADOWS
    }
  },
  {
    id: 'midnight',
    name: 'Midnight',
    tagline: 'Obsidian indigo & crisp starlight',
    light: {
      bgShell: '#e5e7f0',
      bgGrouped: '#eef0f7',
      bgElevated: '#fbfcff',
      bgSurfaceRaised: '#ffffff',
      bgFloat: '#f7f8fc',
      fillSecondary: '#dde0ec',
      fillTertiary: 'rgba(22, 26, 44, 0.045)',
      fillHover: 'rgba(22, 26, 44, 0.07)',
      fillActive: 'rgba(22, 26, 44, 0.11)',
      hairline: 'rgba(22, 26, 44, 0.09)',
      hairlineStrong: 'rgba(22, 26, 44, 0.15)',
      hairlineInset: 'rgba(255, 255, 255, 0.78)',
      labelPrimary: '#161a2c',
      labelSecondary: '#525870',
      labelTertiary: 'rgba(22, 26, 44, 0.48)',
      tint: '#4755c8',
      positive: '#2d6a4f',
      warning: '#9a6510',
      symbolColor: '#484f68',
      scrollbarThumb: 'rgba(22, 26, 44, 0.16)',
      scrollbarThumbHover: 'rgba(22, 26, 44, 0.32)',
      ...LIGHT_SHADOWS
    },
    dark: {
      bgShell: '#0c0e17',
      bgGrouped: '#121524',
      bgElevated: '#161a2b',
      bgSurfaceRaised: '#1e2338',
      bgFloat: '#181c2e',
      fillSecondary: '#232942',
      fillTertiary: 'rgba(232, 236, 252, 0.055)',
      fillHover: 'rgba(232, 236, 252, 0.09)',
      fillActive: 'rgba(232, 236, 252, 0.135)',
      hairline: 'rgba(232, 236, 252, 0.085)',
      hairlineStrong: 'rgba(232, 236, 252, 0.15)',
      hairlineInset: 'rgba(232, 236, 255, 0.07)',
      labelPrimary: '#eef1fc',
      labelSecondary: '#9ca4c4',
      labelTertiary: 'rgba(232, 236, 252, 0.48)',
      tint: '#7d8ef8',
      positive: '#6bc497',
      warning: '#e0b054',
      symbolColor: '#b7c0df',
      scrollbarThumb: 'rgba(232, 236, 252, 0.16)',
      scrollbarThumbHover: 'rgba(232, 236, 252, 0.32)',
      ...DARK_SHADOWS
    }
  },
  {
    id: 'paper',
    name: 'Paper',
    tagline: 'Editorial ivory & fountain ink',
    light: {
      bgShell: '#f2efe9',
      bgGrouped: '#f8f6f2',
      bgElevated: '#fffefb',
      bgSurfaceRaised: '#ffffff',
      bgFloat: '#fcfbf8',
      fillSecondary: '#eae5dc',
      fillTertiary: 'rgba(24, 24, 22, 0.04)',
      fillHover: 'rgba(24, 24, 22, 0.065)',
      fillActive: 'rgba(24, 24, 22, 0.10)',
      hairline: 'rgba(24, 24, 22, 0.08)',
      hairlineStrong: 'rgba(24, 24, 22, 0.135)',
      hairlineInset: 'rgba(255, 255, 255, 0.85)',
      labelPrimary: '#181816',
      labelSecondary: '#5b5952',
      labelTertiary: 'rgba(24, 24, 22, 0.46)',
      tint: '#2c5b84',
      positive: '#2e6440',
      warning: '#96610c',
      symbolColor: '#504e47',
      scrollbarThumb: 'rgba(24, 24, 22, 0.14)',
      scrollbarThumbHover: 'rgba(24, 24, 22, 0.28)',
      ...LIGHT_SHADOWS
    },
    dark: {
      bgShell: '#171614',
      bgGrouped: '#1e1d1a',
      bgElevated: '#23221f',
      bgSurfaceRaised: '#2b2a26',
      bgFloat: '#252420',
      fillSecondary: '#302e2a',
      fillTertiary: 'rgba(246, 243, 236, 0.055)',
      fillHover: 'rgba(246, 243, 236, 0.085)',
      fillActive: 'rgba(246, 243, 236, 0.125)',
      hairline: 'rgba(246, 243, 236, 0.08)',
      hairlineStrong: 'rgba(246, 243, 236, 0.14)',
      hairlineInset: 'rgba(255, 253, 246, 0.06)',
      labelPrimary: '#f6f3ec',
      labelSecondary: '#ada9a0',
      labelTertiary: 'rgba(246, 243, 236, 0.48)',
      tint: '#72a8d8',
      positive: '#7db58d',
      warning: '#dbb058',
      symbolColor: '#c9c5bc',
      scrollbarThumb: 'rgba(246, 243, 236, 0.15)',
      scrollbarThumbHover: 'rgba(246, 243, 236, 0.30)',
      ...DARK_SHADOWS
    }
  },
  {
    id: 'forest',
    name: 'Forest',
    tagline: 'Moss stone & quiet evergreen',
    light: {
      bgShell: '#e4ebe5',
      bgGrouped: '#edf2ee',
      bgElevated: '#fafcfa',
      bgSurfaceRaised: '#ffffff',
      bgFloat: '#f5f9f6',
      fillSecondary: '#dbe4dc',
      fillTertiary: 'rgba(20, 34, 24, 0.045)',
      fillHover: 'rgba(20, 34, 24, 0.07)',
      fillActive: 'rgba(20, 34, 24, 0.11)',
      hairline: 'rgba(20, 34, 24, 0.085)',
      hairlineStrong: 'rgba(20, 34, 24, 0.145)',
      hairlineInset: 'rgba(255, 255, 255, 0.76)',
      labelPrimary: '#16221a',
      labelSecondary: '#4d5f53',
      labelTertiary: 'rgba(22, 34, 26, 0.47)',
      tint: '#2b6b45',
      positive: '#276742',
      warning: '#93620f',
      symbolColor: '#435549',
      scrollbarThumb: 'rgba(20, 34, 24, 0.15)',
      scrollbarThumbHover: 'rgba(20, 34, 24, 0.30)',
      ...LIGHT_SHADOWS
    },
    dark: {
      bgShell: '#0f1612',
      bgGrouped: '#141e18',
      bgElevated: '#18241d',
      bgSurfaceRaised: '#202f26',
      bgFloat: '#1b2720',
      fillSecondary: '#25362c',
      fillTertiary: 'rgba(232, 244, 236, 0.055)',
      fillHover: 'rgba(232, 244, 236, 0.088)',
      fillActive: 'rgba(232, 244, 236, 0.13)',
      hairline: 'rgba(232, 244, 236, 0.085)',
      hairlineStrong: 'rgba(232, 244, 236, 0.145)',
      hairlineInset: 'rgba(236, 252, 242, 0.065)',
      labelPrimary: '#ebf4ee',
      labelSecondary: '#9ab0a1',
      labelTertiary: 'rgba(232, 244, 236, 0.48)',
      tint: '#6bc089',
      positive: '#76c993',
      warning: '#dfb055',
      symbolColor: '#b7cabd',
      scrollbarThumb: 'rgba(232, 244, 236, 0.15)',
      scrollbarThumbHover: 'rgba(232, 244, 236, 0.30)',
      ...DARK_SHADOWS
    }
  },
  {
    id: 'ocean',
    name: 'Ocean',
    tagline: 'Sea mist & deep harbour teal',
    light: {
      bgShell: '#e3ebef',
      bgGrouped: '#ecf2f5',
      bgElevated: '#fafcfd',
      bgSurfaceRaised: '#ffffff',
      bgFloat: '#f5f9fb',
      fillSecondary: '#d9e5eb',
      fillTertiary: 'rgba(18, 34, 44, 0.045)',
      fillHover: 'rgba(18, 34, 44, 0.07)',
      fillActive: 'rgba(18, 34, 44, 0.11)',
      hairline: 'rgba(18, 34, 44, 0.085)',
      hairlineStrong: 'rgba(18, 34, 44, 0.145)',
      hairlineInset: 'rgba(255, 255, 255, 0.78)',
      labelPrimary: '#13222b',
      labelSecondary: '#4b606d',
      labelTertiary: 'rgba(19, 34, 43, 0.47)',
      tint: '#186a82',
      positive: '#2a6b52',
      warning: '#95610d',
      symbolColor: '#415663',
      scrollbarThumb: 'rgba(18, 34, 44, 0.15)',
      scrollbarThumbHover: 'rgba(18, 34, 44, 0.30)',
      ...LIGHT_SHADOWS
    },
    dark: {
      bgShell: '#0c151b',
      bgGrouped: '#111d25',
      bgElevated: '#15232c',
      bgSurfaceRaised: '#1c2e39',
      bgFloat: '#172731',
      fillSecondary: '#223643',
      fillTertiary: 'rgba(230, 243, 250, 0.055)',
      fillHover: 'rgba(230, 243, 250, 0.088)',
      fillActive: 'rgba(230, 243, 250, 0.13)',
      hairline: 'rgba(230, 243, 250, 0.085)',
      hairlineStrong: 'rgba(230, 243, 250, 0.145)',
      hairlineInset: 'rgba(236, 248, 255, 0.065)',
      labelPrimary: '#e8f4fa',
      labelSecondary: '#94aebc',
      labelTertiary: 'rgba(230, 243, 250, 0.48)',
      tint: '#56b5d1',
      positive: '#6cc4a0',
      warning: '#e0b055',
      symbolColor: '#b3cad6',
      scrollbarThumb: 'rgba(230, 243, 250, 0.15)',
      scrollbarThumbHover: 'rgba(230, 243, 250, 0.30)',
      ...DARK_SHADOWS
    }
  },
  {
    id: 'rose',
    name: 'Rosé',
    tagline: 'Blush linen & warm burgundy',
    light: {
      bgShell: '#efe6e8',
      bgGrouped: '#f6eff1',
      bgElevated: '#fffcfd',
      bgSurfaceRaised: '#ffffff',
      bgFloat: '#fcf8f9',
      fillSecondary: '#e8dce0',
      fillTertiary: 'rgba(40, 22, 28, 0.045)',
      fillHover: 'rgba(40, 22, 28, 0.07)',
      fillActive: 'rgba(40, 22, 28, 0.105)',
      hairline: 'rgba(40, 22, 28, 0.085)',
      hairlineStrong: 'rgba(40, 22, 28, 0.145)',
      hairlineInset: 'rgba(255, 255, 255, 0.78)',
      labelPrimary: '#26171c',
      labelSecondary: '#69535a',
      labelTertiary: 'rgba(38, 23, 28, 0.47)',
      tint: '#a63e5c',
      positive: '#326646',
      warning: '#96610d',
      symbolColor: '#5e4950',
      scrollbarThumb: 'rgba(40, 22, 28, 0.15)',
      scrollbarThumbHover: 'rgba(40, 22, 28, 0.30)',
      ...LIGHT_SHADOWS
    },
    dark: {
      bgShell: '#171013',
      bgGrouped: '#1f161a',
      bgElevated: '#251b1f',
      bgSurfaceRaised: '#2f2228',
      bgFloat: '#281d22',
      fillSecondary: '#37282f',
      fillTertiary: 'rgba(250, 236, 240, 0.055)',
      fillHover: 'rgba(250, 236, 240, 0.088)',
      fillActive: 'rgba(250, 236, 240, 0.13)',
      hairline: 'rgba(250, 236, 240, 0.085)',
      hairlineStrong: 'rgba(250, 236, 240, 0.145)',
      hairlineInset: 'rgba(255, 242, 246, 0.065)',
      labelPrimary: '#f7ecee',
      labelSecondary: '#b69da4',
      labelTertiary: 'rgba(250, 236, 240, 0.48)',
      tint: '#e27897',
      positive: '#79be90',
      warning: '#dfb055',
      symbolColor: '#cfb9bf',
      scrollbarThumb: 'rgba(250, 236, 240, 0.15)',
      scrollbarThumbHover: 'rgba(250, 236, 240, 0.30)',
      ...DARK_SHADOWS
    }
  },
  {
    id: 'graphite',
    name: 'Graphite',
    tagline: 'Architectural neutral & steel',
    light: {
      bgShell: '#e8e9ec',
      bgGrouped: '#f1f2f4',
      bgElevated: '#ffffff',
      bgSurfaceRaised: '#ffffff',
      bgFloat: '#f9f9fb',
      fillSecondary: '#dfe1e6',
      fillTertiary: 'rgba(24, 26, 30, 0.045)',
      fillHover: 'rgba(24, 26, 30, 0.07)',
      fillActive: 'rgba(24, 26, 30, 0.11)',
      hairline: 'rgba(24, 26, 30, 0.085)',
      hairlineStrong: 'rgba(24, 26, 30, 0.145)',
      hairlineInset: 'rgba(255, 255, 255, 0.80)',
      labelPrimary: '#181a1e',
      labelSecondary: '#585c65',
      labelTertiary: 'rgba(24, 26, 30, 0.47)',
      tint: '#3c5994',
      positive: '#2f6644',
      warning: '#94620d',
      symbolColor: '#4f535c',
      scrollbarThumb: 'rgba(24, 26, 30, 0.15)',
      scrollbarThumbHover: 'rgba(24, 26, 30, 0.30)',
      ...LIGHT_SHADOWS
    },
    dark: {
      bgShell: '#121316',
      bgGrouped: '#181a1e',
      bgElevated: '#1d1f24',
      bgSurfaceRaised: '#25282e',
      bgFloat: '#202228',
      fillSecondary: '#2c3038',
      fillTertiary: 'rgba(238, 240, 245, 0.055)',
      fillHover: 'rgba(238, 240, 245, 0.088)',
      fillActive: 'rgba(238, 240, 245, 0.13)',
      hairline: 'rgba(238, 240, 245, 0.085)',
      hairlineStrong: 'rgba(238, 240, 245, 0.145)',
      hairlineInset: 'rgba(244, 246, 252, 0.065)',
      labelPrimary: '#eef0f5',
      labelSecondary: '#9ea3ae',
      labelTertiary: 'rgba(238, 240, 245, 0.48)',
      tint: '#7d9ee6',
      positive: '#78be90',
      warning: '#dfb055',
      symbolColor: '#bec2cc',
      scrollbarThumb: 'rgba(238, 240, 245, 0.15)',
      scrollbarThumbHover: 'rgba(238, 240, 245, 0.30)',
      ...DARK_SHADOWS
    }
  }
]

const PRESET_MAP = new Map<string, ThemePresetDefinition>(THEME_PRESETS.map((p) => [p.id, p]))
const DENSITIES = new Set<string>(['compact', 'comfortable', 'spacious'])
const TAB_LAYOUTS = new Set<string>(['sidebar', 'top'])
const SIDEBAR_SIDES = new Set<string>(['left', 'right'])
const TAB_CLOSE_MODES = new Set<string>(['hover', 'always'])
const ADDR_ALIGNS = new Set<string>(['center', 'left'])
const MENU_STYLES = new Set<string>(['full', 'hamburger'])
const BOOKMARK_BAR_MODES = new Set<string>(['always', 'start-page', 'never'])
const MOTIONS = new Set<string>(['full', 'reduced', 'off'])

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/

export function isThemePresetId(v: unknown): v is ThemePresetId {
  return typeof v === 'string' && PRESET_MAP.has(v)
}

export function isUiDensity(v: unknown): v is UiDensity {
  return typeof v === 'string' && DENSITIES.has(v)
}

export function isTabLayout(v: unknown): v is TabLayout {
  return typeof v === 'string' && TAB_LAYOUTS.has(v)
}

export function isSidebarSide(v: unknown): v is SidebarSide {
  return typeof v === 'string' && SIDEBAR_SIDES.has(v)
}

export function isTabCloseButtonsMode(v: unknown): v is TabCloseButtonsMode {
  return typeof v === 'string' && TAB_CLOSE_MODES.has(v)
}

export function isAddressBarAlign(v: unknown): v is AddressBarAlign {
  return typeof v === 'string' && ADDR_ALIGNS.has(v)
}

export function isMenuBarStyle(v: unknown): v is MenuBarStyle {
  return typeof v === 'string' && MENU_STYLES.has(v)
}

export function isBookmarkBarMode(v: unknown): v is BookmarkBarMode {
  return typeof v === 'string' && BOOKMARK_BAR_MODES.has(v)
}

export function isMotionMode(v: unknown): v is MotionMode {
  return typeof v === 'string' && MOTIONS.has(v)
}

/** Normalises #rgb or #rrggbb hex strings to lowercase #rrggbb; returns null if invalid. */
export function normalizeHexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!HEX_COLOR_RE.test(trimmed)) return null
  if (trimmed.length === 4) {
    const r = trimmed[1]
    const g = trimmed[2]
    const b = trimmed[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return trimmed.toLowerCase()
}

/** Sanitizes an accent field: '' (preset default) or normalized #rrggbb; returns null if invalid. */
export function sanitizeAccentHex(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (trimmed === '') return ''
  return normalizeHexColor(trimmed)
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validates arbitrary parsed JSON into a safe AppearanceSettings object, dropping unknown keys. */
export function sanitizeAppearance(raw: unknown): AppearanceSettings {
  if (!isPlainObject(raw)) {
    return { ...DEFAULT_APPEARANCE, toolbarItems: [...DEFAULT_TOOLBAR_ITEMS], enabledMods: [] }
  }
  const accent = sanitizeAccentHex(raw.accent)
  const toolbarItems = Array.isArray(raw.toolbarItems)
    ? sanitizeToolbarItems(raw.toolbarItems)
    : migrateLegacyToolbarButtons({
        showNavButtons: raw.showNavButtons,
        showBookmarkStar: raw.showBookmarkStar,
        showExtensions: raw.showExtensions
      })
  const legacyFlags = deriveLegacyToolbarFlags(toolbarItems)
  return {
    preset: isThemePresetId(raw.preset) ? raw.preset : DEFAULT_APPEARANCE.preset,
    accent: accent !== null ? accent : DEFAULT_APPEARANCE.accent,
    cornerRadius: clampInt(raw.cornerRadius, APPEARANCE_LIMITS.cornerRadius.min, APPEARANCE_LIMITS.cornerRadius.max, DEFAULT_APPEARANCE.cornerRadius),
    density: isUiDensity(raw.density) ? raw.density : DEFAULT_APPEARANCE.density,
    textScale: clampInt(raw.textScale, APPEARANCE_LIMITS.textScale.min, APPEARANCE_LIMITS.textScale.max, DEFAULT_APPEARANCE.textScale),
    tabLayout: isTabLayout(raw.tabLayout) ? raw.tabLayout : DEFAULT_APPEARANCE.tabLayout,
    sidebarSide: isSidebarSide(raw.sidebarSide) ? raw.sidebarSide : DEFAULT_APPEARANCE.sidebarSide,
    sidebarWidth: clampInt(raw.sidebarWidth, APPEARANCE_LIMITS.sidebarWidth.min, APPEARANCE_LIMITS.sidebarWidth.max, DEFAULT_APPEARANCE.sidebarWidth),
    translucentSidebar: typeof raw.translucentSidebar === 'boolean' ? raw.translucentSidebar : DEFAULT_APPEARANCE.translucentSidebar,
    tabCloseButtons: isTabCloseButtonsMode(raw.tabCloseButtons) ? raw.tabCloseButtons : DEFAULT_APPEARANCE.tabCloseButtons,
    addressBarAlign: isAddressBarAlign(raw.addressBarAlign) ? raw.addressBarAlign : DEFAULT_APPEARANCE.addressBarAlign,
    showNavButtons: legacyFlags.showNavButtons,
    showBookmarkStar: legacyFlags.showBookmarkStar,
    showExtensions: legacyFlags.showExtensions,
    toolbarItems,
    menuBarStyle: isMenuBarStyle(raw.menuBarStyle) ? raw.menuBarStyle : DEFAULT_APPEARANCE.menuBarStyle,
    bookmarkBar: isBookmarkBarMode(raw.bookmarkBar) ? raw.bookmarkBar : DEFAULT_APPEARANCE.bookmarkBar,
    pageGap: clampInt(raw.pageGap, APPEARANCE_LIMITS.pageGap.min, APPEARANCE_LIMITS.pageGap.max, DEFAULT_APPEARANCE.pageGap),
    pageRadius: clampInt(raw.pageRadius, APPEARANCE_LIMITS.pageRadius.min, APPEARANCE_LIMITS.pageRadius.max, DEFAULT_APPEARANCE.pageRadius),
    pageShadow: typeof raw.pageShadow === 'boolean' ? raw.pageShadow : DEFAULT_APPEARANCE.pageShadow,
    motion: isMotionMode(raw.motion) ? raw.motion : DEFAULT_APPEARANCE.motion,
    customCssEnabled: typeof raw.customCssEnabled === 'boolean' ? raw.customCssEnabled : DEFAULT_APPEARANCE.customCssEnabled,
    customCss: sanitizeCustomCss(raw.customCss),
    enabledMods: sanitizeEnabledMods(raw.enabledMods)
  }
}

/** Applies a partial appearance update to current appearance settings, ignoring invalid/unknown fields. */
export function mergeAppearance(current: AppearanceSettings, patch: unknown): AppearanceSettings {
  const next: AppearanceSettings = {
    ...current,
    toolbarItems: sanitizeToolbarItems(current.toolbarItems),
    enabledMods: sanitizeEnabledMods(current.enabledMods)
  }
  if (!isPlainObject(patch)) return next
  const own = (k: string): boolean => Object.prototype.hasOwnProperty.call(patch, k)
  if (own('preset') && isThemePresetId(patch.preset)) next.preset = patch.preset
  if (own('accent')) {
    const a = sanitizeAccentHex(patch.accent)
    if (a !== null) next.accent = a
  }
  if (own('cornerRadius') && typeof patch.cornerRadius === 'number' && Number.isFinite(patch.cornerRadius)) {
    next.cornerRadius = clampInt(patch.cornerRadius, APPEARANCE_LIMITS.cornerRadius.min, APPEARANCE_LIMITS.cornerRadius.max, next.cornerRadius)
  }
  if (own('density') && isUiDensity(patch.density)) next.density = patch.density
  if (own('textScale') && typeof patch.textScale === 'number' && Number.isFinite(patch.textScale)) {
    next.textScale = clampInt(patch.textScale, APPEARANCE_LIMITS.textScale.min, APPEARANCE_LIMITS.textScale.max, next.textScale)
  }
  if (own('tabLayout') && isTabLayout(patch.tabLayout)) next.tabLayout = patch.tabLayout
  if (own('sidebarSide') && isSidebarSide(patch.sidebarSide)) next.sidebarSide = patch.sidebarSide
  if (own('sidebarWidth') && typeof patch.sidebarWidth === 'number' && Number.isFinite(patch.sidebarWidth)) {
    next.sidebarWidth = clampInt(patch.sidebarWidth, APPEARANCE_LIMITS.sidebarWidth.min, APPEARANCE_LIMITS.sidebarWidth.max, next.sidebarWidth)
  }
  if (own('translucentSidebar') && typeof patch.translucentSidebar === 'boolean') next.translucentSidebar = patch.translucentSidebar
  if (own('tabCloseButtons') && isTabCloseButtonsMode(patch.tabCloseButtons)) next.tabCloseButtons = patch.tabCloseButtons
  if (own('addressBarAlign') && isAddressBarAlign(patch.addressBarAlign)) next.addressBarAlign = patch.addressBarAlign
  if (own('toolbarItems') && Array.isArray(patch.toolbarItems)) {
    next.toolbarItems = sanitizeToolbarItems(patch.toolbarItems)
  } else {
    let items = [...next.toolbarItems]
    if (own('showNavButtons') && typeof patch.showNavButtons === 'boolean') {
      items = items.filter((id) => id !== 'back' && id !== 'forward' && id !== 'reload')
      if (patch.showNavButtons) {
        const addrIdx = Math.max(0, items.indexOf('address-bar'))
        items.splice(addrIdx, 0, 'back', 'forward', 'reload')
      }
    }
    if (own('showBookmarkStar') && typeof patch.showBookmarkStar === 'boolean') {
      items = items.filter((id) => id !== 'bookmark-star')
      if (patch.showBookmarkStar) {
        const addrIdx = items.indexOf('address-bar')
        items.splice(addrIdx >= 0 ? addrIdx + 1 : items.length, 0, 'bookmark-star')
      }
    }
    if (own('showExtensions') && typeof patch.showExtensions === 'boolean') {
      items = items.filter((id) => id !== 'extensions')
      if (patch.showExtensions) items.push('extensions')
    }
    next.toolbarItems = sanitizeToolbarItems(items)
  }
  const flags = deriveLegacyToolbarFlags(next.toolbarItems)
  next.showNavButtons = flags.showNavButtons
  next.showBookmarkStar = flags.showBookmarkStar
  next.showExtensions = flags.showExtensions
  if (own('menuBarStyle') && isMenuBarStyle(patch.menuBarStyle)) next.menuBarStyle = patch.menuBarStyle
  if (own('bookmarkBar') && isBookmarkBarMode(patch.bookmarkBar)) next.bookmarkBar = patch.bookmarkBar
  if (own('pageGap') && typeof patch.pageGap === 'number' && Number.isFinite(patch.pageGap)) {
    next.pageGap = clampInt(patch.pageGap, APPEARANCE_LIMITS.pageGap.min, APPEARANCE_LIMITS.pageGap.max, next.pageGap)
  }
  if (own('pageRadius') && typeof patch.pageRadius === 'number' && Number.isFinite(patch.pageRadius)) {
    next.pageRadius = clampInt(patch.pageRadius, APPEARANCE_LIMITS.pageRadius.min, APPEARANCE_LIMITS.pageRadius.max, next.pageRadius)
  }
  if (own('pageShadow') && typeof patch.pageShadow === 'boolean') next.pageShadow = patch.pageShadow
  if (own('motion') && isMotionMode(patch.motion)) next.motion = patch.motion
  if (own('customCssEnabled') && typeof patch.customCssEnabled === 'boolean') next.customCssEnabled = patch.customCssEnabled
  if (own('customCss') && typeof patch.customCss === 'string') next.customCss = sanitizeCustomCss(patch.customCss)
  if (own('enabledMods') && Array.isArray(patch.enabledMods)) next.enabledMods = sanitizeEnabledMods(patch.enabledMods)
  return next
}

// ---- Colour & WCAG 2.1 contrast math ----------------------------------------

export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb {
  const norm = normalizeHexColor(hex) ?? '#b3492b'
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16)
  }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const c = (n: number): string => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h * 60, s, l }
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hn = ((h % 360) + 360) % 360
  const sn = Math.min(1, Math.max(0, s))
  const ln = Math.min(1, Math.max(0, l))
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1))
  const m = ln - c / 2
  let rn = 0
  let gn = 0
  let bn = 0
  if (hn < 60) [rn, gn, bn] = [c, x, 0]
  else if (hn < 120) [rn, gn, bn] = [x, c, 0]
  else if (hn < 180) [rn, gn, bn] = [0, c, x]
  else if (hn < 240) [rn, gn, bn] = [0, x, c]
  else if (hn < 300) [rn, gn, bn] = [x, 0, c]
  else [rn, gn, bn] = [c, 0, x]
  return {
    r: Math.round((rn + m) * 255),
    g: Math.round((gn + m) * 255),
    b: Math.round((bn + m) * 255)
  }
}

/** WCAG 2.1 relative luminance in [0, 1]. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 2.1 contrast ratio in [1, 21]. */
export function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexA)
  const l2 = relativeLuminance(hexB)
  const hi = Math.max(l1, l2)
  const lo = Math.min(l1, l2)
  return (hi + 0.05) / (lo + 0.05)
}

/** Picks an on-accent foreground colour guaranteed to achieve >= 4.5:1 contrast against `bgHex`. */
export function pickOnAccent(bgHex: string): string {
  const white = '#ffffff'
  const nearBlack = '#141311'
  const pureBlack = '#000000'
  const cWhite = contrastRatio(bgHex, white)
  const cNearBlack = contrastRatio(bgHex, nearBlack)
  if (cWhite >= cNearBlack) {
    return cWhite >= 4.5 ? white : pureBlack
  }
  return cNearBlack >= 4.5 ? nearBlack : pureBlack
}

/** Adjusts `fgHex` lightness until contrast against `bgHex` reaches at least `minRatio` (default 4.5). */
export function ensureSurfaceContrast(fgHex: string, bgHex: string, isDarkSurface: boolean, minRatio = 4.5): string {
  const norm = normalizeHexColor(fgHex) ?? '#b3492b'
  if (contrastRatio(norm, bgHex) >= minRatio) return norm
  const { h, s, l } = rgbToHsl(hexToRgb(norm))
  // Binary search lightness toward white (on dark surfaces) or black (on light surfaces).
  let lo = isDarkSurface ? l : 0
  let hi = isDarkSurface ? 1 : l
  let best = isDarkSurface ? '#ffffff' : '#000000'
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    const candidate = rgbToHex(hslToRgb(h, s, mid))
    if (contrastRatio(candidate, bgHex) >= minRatio) {
      best = candidate
      if (isDarkSurface) hi = mid
      else lo = mid
    } else {
      if (isDarkSurface) lo = mid
      else hi = mid
    }
  }
  return best
}

export interface DerivedAccentTokens {
  /** Base accent fill colour (buttons, switches, active indicators). */
  tint: string
  /** Hover fill colour for accent buttons (keeps onTint contrast >= 4.5:1). */
  tintHover: string
  /** Accent text colour guaranteed >= 4.5:1 against both elevated and grouped surfaces. */
  tintText: string
  /** Subtle translucent tint fill. */
  tintSoft: string
  /** Translucent focus/selection ring colour. */
  tintRing: string
  /** Foreground text colour drawn on top of `tint` and `tintHover` (>= 4.5:1). */
  onTint: string
  /** Contrast ratio of `onTint` on `tint`. */
  onTintContrast: number
  /** Contrast ratio of `tintText` on the surface background. */
  surfaceContrast: number
}

/**
 * Derives full accent tokens from a hex colour with guaranteed WCAG AA (>= 4.5:1) contrast
 * for both text-on-accent (`onTint` on `tint` & `tintHover`) and accent text on surfaces (`tintText`).
 */
export function deriveAccentTokens(
  hex: string,
  isDark: boolean,
  surfaceBgHex: string,
  groupedBgHex = surfaceBgHex
): DerivedAccentTokens {
  const base = normalizeHexColor(hex) ?? (isDark ? '#d9633e' : '#b3492b')
  const onTint = pickOnAccent(base)
  const { h, s, l } = rgbToHsl(hexToRgb(base))

  // Compute hover variant shifting lightness gently while preserving >= 4.5:1 with `onTint`.
  const delta = onTint === '#ffffff' ? (l > 0.25 ? -0.06 : 0.07) : l < 0.78 ? 0.06 : -0.06
  let hover = rgbToHex(hslToRgb(h, s, Math.min(0.96, Math.max(0.06, l + delta))))
  if (contrastRatio(hover, onTint) < 4.5) {
    // Shift in the direction that increases contrast with onTint.
    hover = ensureSurfaceContrast(hover, onTint, onTint !== '#ffffff', 4.5)
  }

  // Ensure accent text has >= 4.5:1 against both elevated and grouped surfaces.
  let tintText = ensureSurfaceContrast(base, surfaceBgHex, isDark, 4.5)
  if (contrastRatio(tintText, groupedBgHex) < 4.5) {
    tintText = ensureSurfaceContrast(tintText, groupedBgHex, isDark, 4.5)
  }

  const rgb = hexToRgb(base)
  const tintSoft = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isDark ? 0.16 : 0.12})`
  const tintRing = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`

  return {
    tint: base,
    tintHover: hover,
    tintText,
    tintSoft,
    tintRing,
    onTint,
    onTintContrast: Math.round(contrastRatio(base, onTint) * 100) / 100,
    surfaceContrast: Math.round(Math.min(contrastRatio(tintText, surfaceBgHex), contrastRatio(tintText, groupedBgHex)) * 100) / 100
  }
}

// ---- Resolved CSS tokens for main window & floating renderers ---------------

export interface ResolvedAppearance {
  isDark: boolean
  preset: ThemePresetId
  effectiveMaterial: 'acrylic' | 'solid'
  effectiveMotion: MotionMode
  shellBg: string
  symbolColor: string
  floatBg: string
  accentHex: string
  pageRadius: number
  sidebarSide: SidebarSide
  sidebarWidth: number
  vars: Record<string, string>
  attrs: Record<string, string>
  /** Sanitized CSS (enabled mods + user custom CSS) for Orbit UI windows only, or '' in safe mode. */
  customCss: string
  /** True when safe mode (--safe-mode or Shift on launch) has disabled custom CSS for this session. */
  safeMode: boolean
}

export function getThemePreset(id: ThemePresetId): ThemePresetDefinition {
  return PRESET_MAP.get(id) ?? THEME_PRESETS[0]
}

export function resolveAppearanceTokens(
  appearance: AppearanceSettings,
  isDark: boolean,
  supportsAcrylic: boolean,
  systemReducedMotion = false,
  safeMode = false
): ResolvedAppearance {
  const presetDef = getThemePreset(appearance.preset)
  const pal = isDark ? presetDef.dark : presetDef.light
  const rawAccent = appearance.accent || pal.tint
  const accent = deriveAccentTokens(rawAccent, isDark, pal.bgElevated, pal.bgGrouped)

  const r = appearance.cornerRadius
  const rXs = Math.round(r * 0.6)
  const rSm = Math.round(r * 0.8)
  const rMd = r
  const rGroup = Math.min(20, Math.round(r * 1.2))
  const rLg = Math.min(24, Math.round(r * 1.4))
  const rSheet = Math.min(28, Math.round(r * 1.6))

  const effectiveMaterial: 'acrylic' | 'solid' = supportsAcrylic && appearance.translucentSidebar ? 'acrylic' : 'solid'
  const effectiveMotion: MotionMode =
    appearance.motion === 'off'
      ? 'off'
      : appearance.motion === 'reduced' || systemReducedMotion
        ? 'reduced'
        : 'full'

  const densityMetrics =
    appearance.density === 'compact'
      ? { bar: 36, tabH: 28, pinH: 34, rowPad: 10, sidePad: 6 }
      : appearance.density === 'spacious'
        ? { bar: 44, tabH: 36, pinH: 42, rowPad: 16, sidePad: 10 }
        : { bar: 40, tabH: 32, pinH: 38, rowPad: 12, sidePad: 8 }

  const motionVars: Record<string, string> =
    effectiveMotion === 'off'
      ? {
          '--t-fast': '0ms',
          '--t-base': '0ms',
          '--t-pop': '0ms',
          '--spring-snappy-ms': '0ms',
          '--spring-bouncy-ms': '0ms'
        }
      : effectiveMotion === 'reduced'
        ? {
            '--t-fast': '80ms',
            '--t-base': '100ms',
            '--t-pop': '100ms',
            '--spring-snappy-ms': '100ms',
            '--spring-bouncy-ms': '100ms'
          }
        : {
            '--t-fast': '150ms',
            '--t-base': '180ms',
            '--t-pop': '220ms',
            '--spring-snappy-ms': '180ms',
            '--spring-bouncy-ms': '200ms'
          }

  const pageShadowVal = appearance.pageShadow
    ? `0 0 0 1px ${pal.hairline}, ${pal.shadow2}`
    : `0 0 0 1px ${pal.hairline}`

  const vars: Record<string, string> = {
    '--bg-shell': pal.bgShell,
    '--bg-grouped': pal.bgGrouped,
    '--bg-elevated': pal.bgElevated,
    '--bg-surface-raised': pal.bgSurfaceRaised,
    '--bg-float': pal.bgFloat,
    '--fill-secondary': pal.fillSecondary,
    '--fill-tertiary': pal.fillTertiary,
    '--fill-hover': pal.fillHover,
    '--fill-active': pal.fillActive,
    '--hairline': pal.hairline,
    '--hairline-strong': pal.hairlineStrong,
    '--hairline-inset': pal.hairlineInset,
    '--label-primary': pal.labelPrimary,
    '--label-secondary': pal.labelSecondary,
    '--label-tertiary': pal.labelTertiary,
    '--tint': accent.tint,
    '--tint-hover': accent.tintHover,
    '--tint-text': accent.tintText,
    '--tint-soft': accent.tintSoft,
    '--tint-ring': accent.tintRing,
    '--on-tint': accent.onTint,
    '--positive': pal.positive,
    '--warning': pal.warning,
    '--scrollbar-thumb': pal.scrollbarThumb,
    '--scrollbar-thumb-hover': pal.scrollbarThumbHover,
    '--shadow-1': pal.shadow1,
    '--shadow-2': pal.shadow2,
    '--shadow-3': pal.shadow3,
    '--r-xs': `${rXs}px`,
    '--r-sm': `${rSm}px`,
    '--r-md': `${rMd}px`,
    '--r-group': `${rGroup}px`,
    '--r-lg': `${rLg}px`,
    '--r-sheet': `${rSheet}px`,
    '--side': `${appearance.sidebarWidth}px`,
    '--bar': `${densityMetrics.bar}px`,
    '--gap': `${appearance.pageGap}px`,
    '--tab-h': `${densityMetrics.tabH}px`,
    '--pin-h': `${densityMetrics.pinH}px`,
    '--set-row-pad': `${densityMetrics.rowPad}px`,
    '--side-pad': `${densityMetrics.sidePad}px`,
    '--page-radius': `${appearance.pageRadius}px`,
    '--page-shadow': pageShadowVal,
    '--ui-scale': `${appearance.textScale / 100}`,
    '--ui-font-size': `${(13 * appearance.textScale) / 100}px`,
    ...motionVars
  }

  const attrs: Record<string, string> = {
    preset: appearance.preset,
    colorScheme: isDark ? 'dark' : 'light',
    material: effectiveMaterial,
    density: appearance.density,
    motion: effectiveMotion,
    tabLayout: appearance.tabLayout,
    sidebarSide: appearance.sidebarSide,
    tabClose: appearance.tabCloseButtons,
    addrAlign: appearance.addressBarAlign
  }

  return {
    isDark,
    preset: appearance.preset,
    effectiveMaterial,
    effectiveMotion,
    shellBg: pal.bgShell,
    symbolColor: pal.symbolColor,
    floatBg: pal.bgFloat,
    accentHex: accent.tint,
    pageRadius: appearance.pageRadius,
    sidebarSide: appearance.sidebarSide,
    sidebarWidth: appearance.sidebarWidth,
    vars,
    attrs,
    customCss: buildEffectiveCustomCss({
      customCssEnabled: appearance.customCssEnabled,
      customCss: appearance.customCss,
      enabledMods: appearance.enabledMods,
      safeMode
    }),
    safeMode
  }
}

// ---- Safe Theme JSON Export / Import ----------------------------------------

export const THEME_EXPORT_FORMAT = 'veyra-orbit-theme'
export const THEME_EXPORT_VERSION = 1
const MAX_THEME_JSON_BYTES = 131_072

export interface ThemeExportEnvelope {
  format: typeof THEME_EXPORT_FORMAT
  version: typeof THEME_EXPORT_VERSION
  theme: 'system' | 'light' | 'dark'
  appearance: AppearanceSettings
}

export function exportAppearanceJson(
  theme: 'system' | 'light' | 'dark',
  appearance: AppearanceSettings
): string {
  const payload: ThemeExportEnvelope = {
    format: THEME_EXPORT_FORMAT,
    version: THEME_EXPORT_VERSION,
    theme,
    appearance: sanitizeAppearance(appearance)
  }
  return JSON.stringify(payload, null, 2) + '\n'
}

export type ThemeImportResult =
  | { ok: true; theme?: 'system' | 'light' | 'dark'; appearance: AppearanceSettings }
  | { ok: false; error: string }

const VALID_THEMES = new Set(['system', 'light', 'dark'])

/**
 * Parses and strictly sanitizes an imported theme JSON string.
 * Never evaluates code, drops unknown fields, rejects non-JSON or oversized inputs.
 */
export function parseImportedAppearanceJson(rawJson: unknown): ThemeImportResult {
  if (typeof rawJson !== 'string' || rawJson.length === 0) {
    return { ok: false, error: 'Theme file is empty.' }
  }
  if (rawJson.length > MAX_THEME_JSON_BYTES) {
    return { ok: false, error: 'Theme file is too large (max 128 KB).' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    return { ok: false, error: 'File is not valid JSON.' }
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'Theme JSON must be an object.' }
  }
  if ('format' in parsed && parsed.format !== THEME_EXPORT_FORMAT) {
    return { ok: false, error: 'Unrecognised theme format.' }
  }
  // Support either { format, version, theme, appearance: {...} } or a bare appearance object.
  const rawAppearance = 'appearance' in parsed ? parsed.appearance : parsed
  if (!isPlainObject(rawAppearance)) {
    return { ok: false, error: 'Theme JSON is missing a valid appearance object.' }
  }
  // Require at least one recognised appearance key so arbitrary JSON files aren't silently accepted.
  const knownKeys = Object.keys(DEFAULT_APPEARANCE)
  const hasKnownKey = knownKeys.some((k) => Object.prototype.hasOwnProperty.call(rawAppearance, k))
  if (!hasKnownKey) {
    return { ok: false, error: 'No recognised appearance settings found in this file.' }
  }
  const appearance = sanitizeAppearance(rawAppearance)
  const theme =
    typeof parsed.theme === 'string' && VALID_THEMES.has(parsed.theme)
      ? (parsed.theme as 'system' | 'light' | 'dark')
      : undefined
  return { ok: true, theme, appearance }
}
