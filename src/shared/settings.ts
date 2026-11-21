/*
 * User settings: schema, defaults, validation and search engine definitions.
 * Pure, so it can be shared between main, renderer and unit tests.
 */

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

export interface Settings {
  searchEngine: SearchEngineId
  theme: ThemeSource
  startup: StartupBehavior
  /** Custom downloads folder path, or '' to use the system Downloads folder. */
  downloadsDir: string
  askWhereToSave: boolean
}

export interface SettingsView extends Settings {
  /** Folder actually used for downloads (VEYRA_DOWNLOADS env > downloadsDir > system default). */
  effectiveDownloadsDir: string
  /** True when VEYRA_DOWNLOADS is set and overrides the saved downloads folder. */
  downloadsOverridden: boolean
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  searchEngine: 'google',
  theme: 'system',
  startup: 'restore',
  downloadsDir: '',
  askWhereToSave: false
})

const ENGINE_MAP = new Map<string, string>(SEARCH_ENGINES.map((e) => [e.id, e.url]))
const THEMES = new Set<string>(['system', 'light', 'dark'])
const STARTUPS = new Set<string>(['restore', 'new-tab'])

export function isSearchEngineId(v: unknown): v is SearchEngineId {
  return typeof v === 'string' && ENGINE_MAP.has(v)
}

export function isThemeSource(v: unknown): v is ThemeSource {
  return typeof v === 'string' && THEMES.has(v)
}

export function isStartupBehavior(v: unknown): v is StartupBehavior {
  return typeof v === 'string' && STARTUPS.has(v)
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
    askWhereToSave: typeof raw.askWhereToSave === 'boolean' ? raw.askWhereToSave : DEFAULT_SETTINGS.askWhereToSave
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
  return next
}
