/*
 * User settings: schema, defaults, validation and search engine definitions.
 * Pure, so it can be shared between main, renderer and unit tests.
 */

import { SLEEP_MINUTES_OPTIONS, type SleepMinutes } from './sleep.ts'
import {
  DEFAULT_APPEARANCE,
  mergeAppearance,
  sanitizeAppearance,
  type AppearancePatch,
  type AppearanceSettings
} from './appearance.ts'
import {
  DEFAULT_START_PAGE,
  mergeStartPage,
  sanitizeStartPage,
  type StartPagePatch,
  type StartPageSettings
} from './startpage.ts'
import {
  mergeShortcutOverrides,
  sanitizeShortcutOverrides,
  type ShortcutOverrides
} from './shortcuts.ts'
import {
  DEFAULT_SEARCH_ENGINES,
  cloneDefaultSearchEngines,
  findDefaultSearchEngine,
  sanitizeSearchEngines,
  type SearchEngine
} from './search.ts'
import {
  DEFAULT_CLOSE_CONFIRM_THRESHOLD,
  isCloseTabSelection,
  isExternalLinkBehavior,
  isNewTabPosition,
  sanitizeCloseTabThreshold,
  type CloseTabSelection,
  type ExternalLinkBehavior,
  type NewTabPosition
} from './behavior.ts'

export const SEARCH_ENGINES = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=' },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' }
] as const

export type SearchEngineId = string
export type ThemeSource = 'system' | 'light' | 'dark'
export type StartupBehavior = 'restore' | 'restore-pinned' | 'new-tab'
export type NewTabBehavior = 'start-page' | 'command-bar'
export type WindowButtonsStyle = 'windows' | 'dots'
export type UpdateMode = 'automatic' | 'notify'
export type {
  SleepMinutes,
  AppearanceSettings,
  AppearancePatch,
  StartPageSettings,
  StartPagePatch,
  ShortcutOverrides,
  SearchEngine,
  ExternalLinkBehavior,
  NewTabPosition,
  CloseTabSelection
}

export interface Settings {
  searchEngine: SearchEngineId
  /** Configured search engines with !bang / keyword shortcuts (https:// + %s only). */
  searchEngines: SearchEngine[]
  theme: ThemeSource
  startup: StartupBehavior
  /** What Ctrl+T / New tab opens: the start page or the floating Ctrl+K command bar. */
  newTabBehavior: NewTabBehavior
  /** Whether links opened from other apps open in a new tab or replace the current tab. */
  externalLinks: ExternalLinkBehavior
  /** Where newly opened tabs are inserted: end of the tab list or right after the current tab. */
  newTabPosition: NewTabPosition
  /** Which tab becomes active after closing the current tab: right, left, or last used. */
  closeTabSelection: CloseTabSelection
  /** Ask for confirmation before closing a window that has many open tabs. */
  confirmCloseWindow: boolean
  /** Minimum number of open tabs required to show the close-window confirmation (2–100). */
  confirmCloseThreshold: number
  /** Custom downloads folder path, or '' to use the system Downloads folder. */
  downloadsDir: string
  askWhereToSave: boolean
  /** Zen-style compact mode: hide sidebar and toolbar until moving pointer to left/top edges. */
  compactMode: boolean
  /** Minutes of background inactivity before discarding a tab to free memory (0 = off). */
  sleepAfterMinutes: SleepMinutes
  /** Whether pinned tabs are eligible to sleep automatically. */
  sleepPinnedTabs: boolean
  /** Window control button style on Windows: native titleBarOverlay or Mac-style Veyra dots. */
  windowButtons: WindowButtonsStyle
  /** Automatic background download + install on quit, or notify only until the user clicks Download. */
  updateMode: UpdateMode
  /** Theme preset, accent colour, layout, sidebar, toolbar, page card and motion preferences. */
  appearance: AppearanceSettings
  /** Rich start page background, layout, clock, quick links, focus note and widget preferences. */
  startPage: StartPageSettings
  /** Keyboard shortcut overrides (shortcut id -> accelerator string, or '' when disabled). */
  shortcuts: ShortcutOverrides
}

export type SettingsPatch = Partial<Omit<Settings, 'appearance' | 'startPage' | 'shortcuts'>> & {
  appearance?: AppearancePatch
  startPage?: StartPagePatch
  shortcuts?: Record<string, string | null>
  /** When true, clears all shortcut overrides back to defaults before applying any patch entries. */
  resetShortcuts?: boolean
}

export interface SettingsView extends Settings {
  /** Folder actually used for downloads (VEYRA_DOWNLOADS env > downloadsDir > system default). */
  effectiveDownloadsDir: string
  /** True when VEYRA_DOWNLOADS is set and overrides the saved downloads folder. */
  downloadsOverridden: boolean
  /** The window buttons style the running window was created with (changing needs a restart on Windows). */
  activeWindowButtons: WindowButtonsStyle
  /** True on platforms that let the user choose between native overlay and Veyra dots (Windows). */
  supportsWindowButtons: boolean
  /** True on OS builds that support translucent acrylic sidebar backdrop (Windows 11 22H2+). */
  supportsAcrylic: boolean
  /** True when safe mode (--safe-mode or holding Shift on launch) disabled custom CSS for this session. */
  safeMode: boolean
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  searchEngine: 'google',
  searchEngines: DEFAULT_SEARCH_ENGINES as unknown as SearchEngine[],
  theme: 'system',
  startup: 'restore',
  newTabBehavior: 'start-page',
  externalLinks: 'new-tab',
  newTabPosition: 'end',
  closeTabSelection: 'right',
  confirmCloseWindow: false,
  confirmCloseThreshold: DEFAULT_CLOSE_CONFIRM_THRESHOLD,
  downloadsDir: '',
  askWhereToSave: false,
  compactMode: false,
  sleepAfterMinutes: 30,
  sleepPinnedTabs: false,
  windowButtons: 'windows',
  updateMode: 'automatic',
  appearance: DEFAULT_APPEARANCE,
  startPage: DEFAULT_START_PAGE,
  shortcuts: Object.freeze({}) as ShortcutOverrides
})

const ENGINE_MAP = new Map<string, string>(SEARCH_ENGINES.map((e) => [e.id, e.url]))
const THEMES = new Set<string>(['system', 'light', 'dark'])
const STARTUPS = new Set<string>(['restore', 'restore-pinned', 'new-tab'])
const NEW_TAB_BEHAVIORS = new Set<string>(['start-page', 'command-bar'])
const SLEEP_SET = new Set<number>(SLEEP_MINUTES_OPTIONS)
const WINDOW_BUTTONS = new Set<string>(['windows', 'dots'])
const UPDATE_MODES = new Set<string>(['automatic', 'notify'])

export function isSearchEngineId(v: unknown, engines: readonly SearchEngine[] = DEFAULT_SEARCH_ENGINES): v is SearchEngineId {
  return typeof v === 'string' && engines.some((e) => e.id === v)
}

export function isThemeSource(v: unknown): v is ThemeSource {
  return typeof v === 'string' && THEMES.has(v)
}

export function isStartupBehavior(v: unknown): v is StartupBehavior {
  return typeof v === 'string' && STARTUPS.has(v)
}

export function isNewTabBehavior(v: unknown): v is NewTabBehavior {
  return typeof v === 'string' && NEW_TAB_BEHAVIORS.has(v)
}

export function isSleepMinutes(v: unknown): v is SleepMinutes {
  return typeof v === 'number' && SLEEP_SET.has(v)
}

export function isWindowButtonsStyle(v: unknown): v is WindowButtonsStyle {
  return typeof v === 'string' && WINDOW_BUTTONS.has(v)
}

export function isUpdateMode(v: unknown): v is UpdateMode {
  return typeof v === 'string' && UPDATE_MODES.has(v)
}

/** Returns the search URL template/prefix for an engine, falling back to Google. */
export function searchUrlFor(engine: SearchEngineId, engines?: readonly SearchEngine[]): string {
  if (engines && engines.length > 0) {
    return findDefaultSearchEngine(engines, engine).urlTemplate
  }
  return ENGINE_MAP.get(engine) ?? SEARCH_ENGINES[0].url
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isValidPath(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 4096 && !/[\0\r\n]/.test(v)
}

/** Validates arbitrary parsed JSON into a safe Settings object, dropping unknown keys. */
export function sanitizeSettings(raw: unknown): Settings {
  if (!isPlainObject(raw)) {
    return {
      ...DEFAULT_SETTINGS,
      searchEngines: cloneDefaultSearchEngines(),
      appearance: { ...DEFAULT_APPEARANCE },
      startPage: sanitizeStartPage(null),
      shortcuts: {}
    }
  }
  const searchEngines = sanitizeSearchEngines(raw.searchEngines)
  const searchEngine = isSearchEngineId(raw.searchEngine, searchEngines) ? raw.searchEngine : searchEngines[0].id
  return {
    searchEngine,
    searchEngines,
    theme: isThemeSource(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
    startup: isStartupBehavior(raw.startup) ? raw.startup : DEFAULT_SETTINGS.startup,
    newTabBehavior: isNewTabBehavior(raw.newTabBehavior) ? raw.newTabBehavior : DEFAULT_SETTINGS.newTabBehavior,
    externalLinks: isExternalLinkBehavior(raw.externalLinks) ? raw.externalLinks : DEFAULT_SETTINGS.externalLinks,
    newTabPosition: isNewTabPosition(raw.newTabPosition) ? raw.newTabPosition : DEFAULT_SETTINGS.newTabPosition,
    closeTabSelection: isCloseTabSelection(raw.closeTabSelection) ? raw.closeTabSelection : DEFAULT_SETTINGS.closeTabSelection,
    confirmCloseWindow: typeof raw.confirmCloseWindow === 'boolean' ? raw.confirmCloseWindow : DEFAULT_SETTINGS.confirmCloseWindow,
    confirmCloseThreshold: sanitizeCloseTabThreshold(raw.confirmCloseThreshold),
    downloadsDir: isValidPath(raw.downloadsDir) ? raw.downloadsDir.trim() : DEFAULT_SETTINGS.downloadsDir,
    askWhereToSave: typeof raw.askWhereToSave === 'boolean' ? raw.askWhereToSave : DEFAULT_SETTINGS.askWhereToSave,
    compactMode: typeof raw.compactMode === 'boolean' ? raw.compactMode : DEFAULT_SETTINGS.compactMode,
    sleepAfterMinutes: isSleepMinutes(raw.sleepAfterMinutes) ? raw.sleepAfterMinutes : DEFAULT_SETTINGS.sleepAfterMinutes,
    sleepPinnedTabs: typeof raw.sleepPinnedTabs === 'boolean' ? raw.sleepPinnedTabs : DEFAULT_SETTINGS.sleepPinnedTabs,
    windowButtons: isWindowButtonsStyle(raw.windowButtons) ? raw.windowButtons : DEFAULT_SETTINGS.windowButtons,
    updateMode: isUpdateMode(raw.updateMode) ? raw.updateMode : DEFAULT_SETTINGS.updateMode,
    appearance: sanitizeAppearance(raw.appearance),
    startPage: sanitizeStartPage(raw.startPage),
    shortcuts: sanitizeShortcutOverrides(raw.shortcuts)
  }
}

/** Applies a partial update to existing settings, ignoring unknown keys and invalid values. */
export function mergeSettings(current: Settings, patch: unknown): Settings {
  const next: Settings = {
    ...current,
    searchEngines: sanitizeSearchEngines(current.searchEngines),
    appearance: { ...current.appearance },
    startPage: sanitizeStartPage(current.startPage),
    shortcuts: sanitizeShortcutOverrides(current.shortcuts)
  }
  if (!isPlainObject(patch)) return next
  const own = (k: string): boolean => Object.prototype.hasOwnProperty.call(patch, k)
  if (own('searchEngines') && Array.isArray(patch.searchEngines)) {
    next.searchEngines = sanitizeSearchEngines(patch.searchEngines)
  }
  if (own('searchEngine') && isSearchEngineId(patch.searchEngine, next.searchEngines)) {
    next.searchEngine = patch.searchEngine
  } else if (!isSearchEngineId(next.searchEngine, next.searchEngines)) {
    next.searchEngine = next.searchEngines[0].id
  }
  if (own('theme') && isThemeSource(patch.theme)) next.theme = patch.theme
  if (own('startup') && isStartupBehavior(patch.startup)) next.startup = patch.startup
  if (own('newTabBehavior') && isNewTabBehavior(patch.newTabBehavior)) next.newTabBehavior = patch.newTabBehavior
  if (own('externalLinks') && isExternalLinkBehavior(patch.externalLinks)) next.externalLinks = patch.externalLinks
  if (own('newTabPosition') && isNewTabPosition(patch.newTabPosition)) next.newTabPosition = patch.newTabPosition
  if (own('closeTabSelection') && isCloseTabSelection(patch.closeTabSelection)) next.closeTabSelection = patch.closeTabSelection
  if (own('confirmCloseWindow') && typeof patch.confirmCloseWindow === 'boolean') next.confirmCloseWindow = patch.confirmCloseWindow
  if (own('confirmCloseThreshold') && typeof patch.confirmCloseThreshold === 'number' && Number.isFinite(patch.confirmCloseThreshold)) {
    next.confirmCloseThreshold = sanitizeCloseTabThreshold(patch.confirmCloseThreshold)
  }
  if (own('downloadsDir') && isValidPath(patch.downloadsDir)) next.downloadsDir = patch.downloadsDir.trim()
  if (own('askWhereToSave') && typeof patch.askWhereToSave === 'boolean') next.askWhereToSave = patch.askWhereToSave
  if (own('compactMode') && typeof patch.compactMode === 'boolean') next.compactMode = patch.compactMode
  if (own('sleepAfterMinutes') && isSleepMinutes(patch.sleepAfterMinutes)) next.sleepAfterMinutes = patch.sleepAfterMinutes
  if (own('sleepPinnedTabs') && typeof patch.sleepPinnedTabs === 'boolean') next.sleepPinnedTabs = patch.sleepPinnedTabs
  if (own('windowButtons') && isWindowButtonsStyle(patch.windowButtons)) next.windowButtons = patch.windowButtons
  if (own('updateMode') && isUpdateMode(patch.updateMode)) next.updateMode = patch.updateMode
  if (own('appearance')) next.appearance = mergeAppearance(next.appearance, patch.appearance)
  if (own('startPage')) next.startPage = mergeStartPage(next.startPage, patch.startPage)
  if (own('resetShortcuts') && patch.resetShortcuts === true) {
    next.shortcuts = {}
  }
  if (own('shortcuts')) next.shortcuts = mergeShortcutOverrides(next.shortcuts, patch.shortcuts)
  return next
}
