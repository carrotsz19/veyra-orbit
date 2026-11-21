/*
 * User settings: schema, defaults, validation and search engine definitions.
 * Pure, so it can be shared between main, renderer and unit tests.
 */

import { SLEEP_MINUTES_OPTIONS, type SleepMinutes } from './sleep.ts'

export const SEARCH_ENGINES = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=' },
  { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
  { id: 'ecosia', name: 'Ecosia', url: 'https://www.ecosia.org/search?q=' }
] as const

export type SearchEngineId = (typeof SEARCH_ENGINES)[number]['id']
export type ThemeSource = 'system' | 'light' | 'dark'
export type StartupBehavior = 'restore' | 'new-tab'
export type WindowButtonsStyle = 'windows' | 'dots'
export type { SleepMinutes }

export interface Settings {
  searchEngine: SearchEngineId
  theme: ThemeSource
  startup: StartupBehavior
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
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  searchEngine: 'google',
  theme: 'system',
  startup: 'restore',
  downloadsDir: '',
  askWhereToSave: false,
  compactMode: false,
  sleepAfterMinutes: 30,
  sleepPinnedTabs: false,
  windowButtons: 'windows'
})

const ENGINE_MAP = new Map<string, string>(SEARCH_ENGINES.map((e) => [e.id, e.url]))
const THEMES = new Set<string>(['system', 'light', 'dark'])
const STARTUPS = new Set<string>(['restore', 'new-tab'])
const SLEEP_SET = new Set<number>(SLEEP_MINUTES_OPTIONS)
const WINDOW_BUTTONS = new Set<string>(['windows', 'dots'])

export function isSearchEngineId(v: unknown): v is SearchEngineId {
  return typeof v === 'string' && ENGINE_MAP.has(v)
}

export function isThemeSource(v: unknown): v is ThemeSource {
  return typeof v === 'string' && THEMES.has(v)
}

export function isStartupBehavior(v: unknown): v is StartupBehavior {
  return typeof v === 'string' && STARTUPS.has(v)
}

export function isSleepMinutes(v: unknown): v is SleepMinutes {
  return typeof v === 'number' && SLEEP_SET.has(v)
}

export function isWindowButtonsStyle(v: unknown): v is WindowButtonsStyle {
  return typeof v === 'string' && WINDOW_BUTTONS.has(v)
}

/** Returns the search URL prefix for an engine, falling back to Google. */
export function searchUrlFor(engine: SearchEngineId): string {
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
  if (!isPlainObject(raw)) return { ...DEFAULT_SETTINGS }
  return {
    searchEngine: isSearchEngineId(raw.searchEngine) ? raw.searchEngine : DEFAULT_SETTINGS.searchEngine,
    theme: isThemeSource(raw.theme) ? raw.theme : DEFAULT_SETTINGS.theme,
    startup: isStartupBehavior(raw.startup) ? raw.startup : DEFAULT_SETTINGS.startup,
    downloadsDir: isValidPath(raw.downloadsDir) ? raw.downloadsDir.trim() : DEFAULT_SETTINGS.downloadsDir,
    askWhereToSave: typeof raw.askWhereToSave === 'boolean' ? raw.askWhereToSave : DEFAULT_SETTINGS.askWhereToSave,
    compactMode: typeof raw.compactMode === 'boolean' ? raw.compactMode : DEFAULT_SETTINGS.compactMode,
    sleepAfterMinutes: isSleepMinutes(raw.sleepAfterMinutes) ? raw.sleepAfterMinutes : DEFAULT_SETTINGS.sleepAfterMinutes,
    sleepPinnedTabs: typeof raw.sleepPinnedTabs === 'boolean' ? raw.sleepPinnedTabs : DEFAULT_SETTINGS.sleepPinnedTabs,
    windowButtons: isWindowButtonsStyle(raw.windowButtons) ? raw.windowButtons : DEFAULT_SETTINGS.windowButtons
  }
}

/** Applies a partial update to existing settings, ignoring unknown keys and invalid values. */
export function mergeSettings(current: Settings, patch: unknown): Settings {
  const next: Settings = { ...current }
  if (!isPlainObject(patch)) return next
  const own = (k: string): boolean => Object.prototype.hasOwnProperty.call(patch, k)
  if (own('searchEngine') && isSearchEngineId(patch.searchEngine)) next.searchEngine = patch.searchEngine
  if (own('theme') && isThemeSource(patch.theme)) next.theme = patch.theme
  if (own('startup') && isStartupBehavior(patch.startup)) next.startup = patch.startup
  if (own('downloadsDir') && isValidPath(patch.downloadsDir)) next.downloadsDir = patch.downloadsDir.trim()
  if (own('askWhereToSave') && typeof patch.askWhereToSave === 'boolean') next.askWhereToSave = patch.askWhereToSave
  if (own('compactMode') && typeof patch.compactMode === 'boolean') next.compactMode = patch.compactMode
  if (own('sleepAfterMinutes') && isSleepMinutes(patch.sleepAfterMinutes)) next.sleepAfterMinutes = patch.sleepAfterMinutes
  if (own('sleepPinnedTabs') && typeof patch.sleepPinnedTabs === 'boolean') next.sleepPinnedTabs = patch.sleepPinnedTabs
  if (own('windowButtons') && isWindowButtonsStyle(patch.windowButtons)) next.windowButtons = patch.windowButtons
  return next
}
