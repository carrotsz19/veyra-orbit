/*
 * Rich start page schema, validation/sanitization, quick-link validation,
 * widget ordering helpers, and bundled offline daily quotes.
 * Pure module (zero Electron/Node deps) so it runs in main, renderer, and unit tests.
 */

import { isAllowedUrl } from './url.ts'
import { isUiDensity, type UiDensity } from './appearance.ts'

export const START_BACKGROUND_MODES = ['solid', 'tinted', 'image'] as const
export type StartBackgroundMode = (typeof START_BACKGROUND_MODES)[number]

export const START_LAYOUTS = ['centered', 'wide'] as const
export type StartLayout = (typeof START_LAYOUTS)[number]

export const CLOCK_FORMATS = ['12h', '24h'] as const
export type ClockFormat = (typeof CLOCK_FORMATS)[number]

export const QUICK_LINK_SIZES = ['sm', 'md', 'lg'] as const
export type QuickLinkSize = (typeof QUICK_LINK_SIZES)[number]

export const START_WIDGET_IDS = [
  'clock',
  'search',
  'quick-links',
  'recent-tabs',
  'bookmarks',
  'focus-note',
  'quote'
] as const
export type StartWidgetId = (typeof START_WIDGET_IDS)[number]

export interface StartWidgetConfig {
  id: StartWidgetId
  enabled: boolean
}

export interface QuickLink {
  id: string
  title: string
  url: string
}

export interface StartPageSettings {
  background: StartBackgroundMode
  /** App-owned filename inside userData/backgrounds/ (e.g. "<uuid>.jpg"), or ''. */
  backgroundImage: string
  /** Dim scrim overlay strength over custom background image (0..70 %). */
  backgroundDim: number
  /** Gaussian blur over custom background image (0..20 px). */
  backgroundBlur: number
  layout: StartLayout
  density: UiDensity
  clockFormat: ClockFormat
  showSeconds: boolean
  /** Editable greeting name ("Good morning, <name>"), max 40 chars. */
  userName: string
  /** User-curated speed-dial quick links (max 24, http/https only). */
  quickLinks: QuickLink[]
  /** True once user has explicitly customized quick links (otherwise defaults fill from top history). */
  quickLinksCustomized: boolean
  quickLinkSize: QuickLinkSize
  /** Quick link tiles per row (4..8). */
  quickLinkColumns: number
  /** Local persisted study focus note ("What are you studying today?"). */
  focusNote: string
  /** Ordered list of all start-page widgets and whether each is visible. */
  widgets: StartWidgetConfig[]
}

export type StartPagePatch = Partial<StartPageSettings>

export const START_PAGE_LIMITS = Object.freeze({
  backgroundDim: { min: 0, max: 70, default: 28 },
  backgroundBlur: { min: 0, max: 20, default: 0 },
  quickLinkColumns: { min: 4, max: 8, default: 6 },
  maxQuickLinks: 24,
  maxUserName: 40,
  maxFocusNote: 600,
  maxQuickLinkTitle: 60,
  maxQuickLinkUrl: 2048
})

export const DEFAULT_START_WIDGETS: readonly StartWidgetConfig[] = Object.freeze(
  START_WIDGET_IDS.map((id) => Object.freeze({ id, enabled: true }))
)

export const DEFAULT_START_PAGE: Readonly<StartPageSettings> = Object.freeze({
  background: 'solid',
  backgroundImage: '',
  backgroundDim: 28,
  backgroundBlur: 0,
  layout: 'centered',
  density: 'comfortable',
  clockFormat: '12h',
  showSeconds: false,
  userName: '',
  quickLinks: Object.freeze([]) as unknown as QuickLink[],
  quickLinksCustomized: false,
  quickLinkSize: 'md',
  quickLinkColumns: 6,
  focusNote: '',
  widgets: DEFAULT_START_WIDGETS as unknown as StartWidgetConfig[]
})

export const WIDGET_LABELS: Readonly<Record<StartWidgetId, { name: string; desc: string }>> = Object.freeze({
  clock: { name: 'Clock & greeting', desc: 'Time, date, and personal greeting' },
  search: { name: 'Search box', desc: 'Search the web or type an address' },
  'quick-links': { name: 'Quick links', desc: 'Speed-dial tiles for frequent sites' },
  'recent-tabs': { name: 'Continue where you left off', desc: 'Recently closed tabs and visits' },
  bookmarks: { name: 'Bookmarks row', desc: 'Quick access to saved bookmarks' },
  'focus-note': { name: 'Focus note', desc: 'What are you studying today?' },
  quote: { name: 'Daily quote', desc: 'A quiet local note for the day' }
})

const BG_MODES = new Set<string>(START_BACKGROUND_MODES)
const LAYOUTS = new Set<string>(START_LAYOUTS)
const CLOCKS = new Set<string>(CLOCK_FORMATS)
const LINK_SIZES = new Set<string>(QUICK_LINK_SIZES)
const WIDGET_SET = new Set<string>(START_WIDGET_IDS)

/** Strictly validates an app-owned background filename: hex/uuid stem + .jpg, no path separators. */
const BG_FILENAME_RE = /^[a-f0-9-]{8,64}\.jpg$/

export function isStartBackgroundMode(v: unknown): v is StartBackgroundMode {
  return typeof v === 'string' && BG_MODES.has(v)
}

export function isStartLayout(v: unknown): v is StartLayout {
  return typeof v === 'string' && LAYOUTS.has(v)
}

export function isClockFormat(v: unknown): v is ClockFormat {
  return typeof v === 'string' && CLOCKS.has(v)
}

export function isQuickLinkSize(v: unknown): v is QuickLinkSize {
  return typeof v === 'string' && LINK_SIZES.has(v)
}

export function isStartWidgetId(v: unknown): v is StartWidgetId {
  return typeof v === 'string' && WIDGET_SET.has(v)
}

export function isValidBackgroundFilename(v: unknown): v is string {
  return typeof v === 'string' && (v === '' || BG_FILENAME_RE.test(v))
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

function cleanSingleLine(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null
  return v.replace(/[\0\r\n]+/g, ' ').trim().slice(0, maxLen)
}

function cleanMultiLine(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null
  return v.replace(/\0/g, '').replace(/\r\n?/g, '\n').slice(0, maxLen)
}

/**
 * Normalizes and validates a quick-link URL.
 * Accepts only http:// or https:// URLs (adding https:// for bare domains like "wikipedia.org").
 * Rejects javascript:, file:, data:, chrome:, control characters, and oversized strings.
 */
export function normalizeQuickLinkUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > START_PAGE_LIMITS.maxQuickLinkUrl || /[\0\r\n\s]/.test(trimmed)) {
    return null
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  const candidate = hasScheme ? trimmed : `https://${trimmed}`
  if (!/^https?:\/\//i.test(candidate)) return null
  if (!isAllowedUrl(candidate)) return null
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname || !u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return u.toString()
  } catch {
    return null
  }
}

export function sanitizeQuickLinks(raw: unknown): QuickLink[] {
  if (!Array.isArray(raw)) return []
  const out: QuickLink[] = []
  const seenIds = new Set<string>()
  for (const item of raw) {
    if (out.length >= START_PAGE_LIMITS.maxQuickLinks) break
    if (!isPlainObject(item)) continue
    const url = normalizeQuickLinkUrl(item.url)
    if (!url) continue
    let hostFallback = url
    try {
      hostFallback = new URL(url).host.replace(/^www\./, '')
    } catch {
      /* keep url */
    }
    const rawTitle = cleanSingleLine(item.title, START_PAGE_LIMITS.maxQuickLinkTitle)
    const title = rawTitle || hostFallback
    const rawId = typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(item.id) ? item.id : `ql-${out.length + 1}`
    let id = rawId
    let n = 1
    while (seenIds.has(id)) {
      id = `${rawId.slice(0, 40)}-${++n}`
    }
    seenIds.add(id)
    out.push({ id, title, url })
  }
  return out
}

/** Normalizes widget configuration: preserves valid order & enabled flags, drops duplicates, appends any missing widgets. */
export function sanitizeStartWidgets(raw: unknown): StartWidgetConfig[] {
  const out: StartWidgetConfig[] = []
  const seen = new Set<StartWidgetId>()
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isPlainObject(item)) continue
      if (!isStartWidgetId(item.id) || seen.has(item.id)) continue
      seen.add(item.id)
      out.push({ id: item.id, enabled: typeof item.enabled === 'boolean' ? item.enabled : true })
    }
  }
  for (const id of START_WIDGET_IDS) {
    if (!seen.has(id)) out.push({ id, enabled: true })
  }
  return out
}

export function sanitizeStartPage(raw: unknown): StartPageSettings {
  if (!isPlainObject(raw)) {
    return {
      ...DEFAULT_START_PAGE,
      quickLinks: [],
      widgets: sanitizeStartWidgets(DEFAULT_START_WIDGETS)
    }
  }
  const backgroundImage = isValidBackgroundFilename(raw.backgroundImage) ? raw.backgroundImage : ''
  // Legacy 'ambient' background mode (removed aurora blobs) maps cleanly to the calm default surface.
  const rawBg =
    raw.background === 'ambient'
      ? DEFAULT_START_PAGE.background
      : isStartBackgroundMode(raw.background)
        ? raw.background
        : DEFAULT_START_PAGE.background
  const userName = cleanSingleLine(raw.userName, START_PAGE_LIMITS.maxUserName)
  const focusNote = cleanMultiLine(raw.focusNote, START_PAGE_LIMITS.maxFocusNote)
  return {
    background: rawBg,
    backgroundImage,
    backgroundDim: clampInt(raw.backgroundDim, START_PAGE_LIMITS.backgroundDim.min, START_PAGE_LIMITS.backgroundDim.max, DEFAULT_START_PAGE.backgroundDim),
    backgroundBlur: clampInt(raw.backgroundBlur, START_PAGE_LIMITS.backgroundBlur.min, START_PAGE_LIMITS.backgroundBlur.max, DEFAULT_START_PAGE.backgroundBlur),
    layout: isStartLayout(raw.layout) ? raw.layout : DEFAULT_START_PAGE.layout,
    density: isUiDensity(raw.density) ? raw.density : DEFAULT_START_PAGE.density,
    clockFormat: isClockFormat(raw.clockFormat) ? raw.clockFormat : DEFAULT_START_PAGE.clockFormat,
    showSeconds: typeof raw.showSeconds === 'boolean' ? raw.showSeconds : DEFAULT_START_PAGE.showSeconds,
    userName: userName !== null ? userName : DEFAULT_START_PAGE.userName,
    quickLinks: sanitizeQuickLinks(raw.quickLinks),
    quickLinksCustomized: typeof raw.quickLinksCustomized === 'boolean' ? raw.quickLinksCustomized : DEFAULT_START_PAGE.quickLinksCustomized,
    quickLinkSize: isQuickLinkSize(raw.quickLinkSize) ? raw.quickLinkSize : DEFAULT_START_PAGE.quickLinkSize,
    quickLinkColumns: clampInt(raw.quickLinkColumns, START_PAGE_LIMITS.quickLinkColumns.min, START_PAGE_LIMITS.quickLinkColumns.max, DEFAULT_START_PAGE.quickLinkColumns),
    focusNote: focusNote !== null ? focusNote : DEFAULT_START_PAGE.focusNote,
    widgets: sanitizeStartWidgets(raw.widgets)
  }
}

export function mergeStartPage(current: StartPageSettings, patch: unknown): StartPageSettings {
  const next: StartPageSettings = {
    ...current,
    quickLinks: current.quickLinks.map((l) => ({ ...l })),
    widgets: current.widgets.map((w) => ({ ...w }))
  }
  if (!isPlainObject(patch)) return next
  const own = (k: string): boolean => Object.prototype.hasOwnProperty.call(patch, k)
  if (own('background') && isStartBackgroundMode(patch.background)) next.background = patch.background
  if (own('backgroundImage') && isValidBackgroundFilename(patch.backgroundImage)) next.backgroundImage = patch.backgroundImage
  if (own('backgroundDim') && typeof patch.backgroundDim === 'number' && Number.isFinite(patch.backgroundDim)) {
    next.backgroundDim = clampInt(patch.backgroundDim, START_PAGE_LIMITS.backgroundDim.min, START_PAGE_LIMITS.backgroundDim.max, next.backgroundDim)
  }
  if (own('backgroundBlur') && typeof patch.backgroundBlur === 'number' && Number.isFinite(patch.backgroundBlur)) {
    next.backgroundBlur = clampInt(patch.backgroundBlur, START_PAGE_LIMITS.backgroundBlur.min, START_PAGE_LIMITS.backgroundBlur.max, next.backgroundBlur)
  }
  if (own('layout') && isStartLayout(patch.layout)) next.layout = patch.layout
  if (own('density') && isUiDensity(patch.density)) next.density = patch.density
  if (own('clockFormat') && isClockFormat(patch.clockFormat)) next.clockFormat = patch.clockFormat
  if (own('showSeconds') && typeof patch.showSeconds === 'boolean') next.showSeconds = patch.showSeconds
  if (own('userName')) {
    const cleaned = cleanSingleLine(patch.userName, START_PAGE_LIMITS.maxUserName)
    if (cleaned !== null) next.userName = cleaned
  }
  if (own('quickLinks') && Array.isArray(patch.quickLinks)) {
    next.quickLinks = sanitizeQuickLinks(patch.quickLinks)
  }
  if (own('quickLinksCustomized') && typeof patch.quickLinksCustomized === 'boolean') {
    next.quickLinksCustomized = patch.quickLinksCustomized
  }
  if (own('quickLinkSize') && isQuickLinkSize(patch.quickLinkSize)) next.quickLinkSize = patch.quickLinkSize
  if (own('quickLinkColumns') && typeof patch.quickLinkColumns === 'number' && Number.isFinite(patch.quickLinkColumns)) {
    next.quickLinkColumns = clampInt(patch.quickLinkColumns, START_PAGE_LIMITS.quickLinkColumns.min, START_PAGE_LIMITS.quickLinkColumns.max, next.quickLinkColumns)
  }
  if (own('focusNote')) {
    const cleaned = cleanMultiLine(patch.focusNote, START_PAGE_LIMITS.maxFocusNote)
    if (cleaned !== null) next.focusNote = cleaned
  }
  if (own('widgets') && Array.isArray(patch.widgets)) {
    next.widgets = sanitizeStartWidgets(patch.widgets)
  }
  return next
}

/** Moves an item in an array from `fromIndex` to `toIndex`, returning a new array. */
export function reorderList<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || fromIndex >= items.length) return [...items]
  const clampedTo = Math.min(items.length - 1, Math.max(0, toIndex))
  if (fromIndex === clampedTo) return [...items]
  const copy = [...items]
  const [moved] = copy.splice(fromIndex, 1)
  copy.splice(clampedTo, 0, moved)
  return copy
}

// ---- Bundled offline daily quotes (zero network) ----------------------------

export interface DailyQuote {
  text: string
  author: string
}

export const DAILY_QUOTES: readonly DailyQuote[] = Object.freeze([
  { text: 'Simplicity is about subtracting the obvious and adding the meaningful.', author: 'John Maeda' },
  { text: 'Study the science of art. Study the art of science.', author: 'Leonardo da Vinci' },
  { text: 'What we learn with pleasure we never forget.', author: 'Alfred Mercier' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: 'Little by little, a little becomes a lot.', author: 'Tanzanian proverb' },
  { text: 'Well begun is half done.', author: 'Aristotle' },
  { text: 'Attention is the rarest and purest form of generosity.', author: 'Simone Weil' },
  { text: 'An investment in knowledge pays the best interest.', author: 'Benjamin Franklin' },
  { text: 'Curiosity is the wick in the candle of learning.', author: 'William Arthur Ward' },
  { text: 'Clarity affords focus.', author: 'Thomas Leonard' },
  { text: 'Make each day your masterpiece.', author: 'John Wooden' },
  { text: 'Knowledge speaks, but wisdom listens.', author: 'Jimi Hendrix' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'A quiet mind hears what a hurried mind misses.', author: 'Veyra Note' },
  { text: 'Focus is saying no to a hundred good ideas.', author: 'Steve Jobs' },
  { text: 'Practice is the hardest part of learning, and training is the essence of transformation.', author: 'Ann Voskamp' },
  { text: 'Reading furnishes the mind only with materials of knowledge; it is thinking that makes what we read ours.', author: 'John Locke' },
  { text: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe' },
  { text: 'The expert in anything was once a beginner.', author: 'Helen Hayes' },
  { text: 'Details are not the details. They make the design.', author: 'Charles Eames' },
  { text: 'Patience and perseverance have a magical effect before which difficulties disappear.', author: 'John Quincy Adams' },
  { text: 'Live as if you were to die tomorrow. Learn as if you were to live forever.', author: 'Mahatma Gandhi' },
  { text: 'Action is the foundational key to all success.', author: 'Pablo Picasso' },
  { text: 'Small daily improvements over time lead to stunning results.', author: 'Robin Sharma' },
  { text: 'The beautiful thing about learning is that nobody can take it away from you.', author: 'B.B. King' },
  { text: 'Less, but better.', author: 'Dieter Rams' },
  { text: 'Tell me and I forget. Teach me and I remember. Involve me and I learn.', author: 'Benjamin Franklin' },
  { text: 'Energy flows where attention goes.', author: 'Michael Beckwith' },
  { text: 'To teach is to learn twice.', author: 'Joseph Joubert' },
  { text: 'Calmness is the cradle of power.', author: 'Josiah Gilbert Holland' },
  { text: 'Every page turned is a small step forward.', author: 'Veyra Note' }
])

/** Deterministic daily quote selection based on calendar date (no network). */
export function quoteForDate(date = new Date()): DailyQuote {
  const dayKey = date.getFullYear() * 372 + (date.getMonth() + 1) * 31 + date.getDate()
  return DAILY_QUOTES[Math.abs(dayKey) % DAILY_QUOTES.length]
}
