/*
 * Search engine registry, custom engine validation (https + %s only),
 * and !bang / keyword shortcut parsing ("w cats", "!w cats").
 * Pure module (zero Electron/Node deps) shared across main, renderers, and unit tests.
 */

export interface SearchEngine {
  id: string
  name: string
  /** Short trigger keyword without '!', e.g. 'w', 'yt', 'gh', 'mdn'. */
  keyword: string
  /** HTTPS URL template containing '%s', e.g. 'https://en.wikipedia.org/w/index.php?search=%s'. */
  urlTemplate: string
  builtIn?: boolean
}

export const DEFAULT_SEARCH_ENGINES: readonly SearchEngine[] = Object.freeze([
  Object.freeze({ id: 'google', name: 'Google', keyword: 'g', urlTemplate: 'https://www.google.com/search?q=%s', builtIn: true }),
  Object.freeze({ id: 'duckduckgo', name: 'DuckDuckGo', keyword: 'ddg', urlTemplate: 'https://duckduckgo.com/?q=%s', builtIn: true }),
  Object.freeze({ id: 'bing', name: 'Bing', keyword: 'bing', urlTemplate: 'https://www.bing.com/search?q=%s', builtIn: true }),
  Object.freeze({ id: 'brave', name: 'Brave Search', keyword: 'br', urlTemplate: 'https://search.brave.com/search?q=%s', builtIn: true }),
  Object.freeze({ id: 'ecosia', name: 'Ecosia', keyword: 'ec', urlTemplate: 'https://www.ecosia.org/search?q=%s', builtIn: true }),
  Object.freeze({ id: 'wikipedia', name: 'Wikipedia', keyword: 'w', urlTemplate: 'https://en.wikipedia.org/w/index.php?search=%s', builtIn: true }),
  Object.freeze({ id: 'youtube', name: 'YouTube', keyword: 'yt', urlTemplate: 'https://www.youtube.com/results?search_query=%s', builtIn: true }),
  Object.freeze({ id: 'github', name: 'GitHub', keyword: 'gh', urlTemplate: 'https://github.com/search?q=%s', builtIn: true }),
  Object.freeze({ id: 'mdn', name: 'MDN', keyword: 'mdn', urlTemplate: 'https://developer.mozilla.org/en-US/search?q=%s', builtIn: true })
])

export const MAX_SEARCH_ENGINES = 50
const KEYWORD_RE = /^[a-z0-9][a-z0-9_-]{0,15}$/
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

export function cloneDefaultSearchEngines(): SearchEngine[] {
  return DEFAULT_SEARCH_ENGINES.map((e) => ({ ...e }))
}

export function sanitizeSearchEngineName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const clean = raw.replace(/[\0\r\n\t]+/g, ' ').trim().slice(0, 48)
  return clean || null
}

/** Normalizes a search keyword (strips optional leading '!', lowercases) or returns null if invalid. */
export function sanitizeSearchKeyword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const clean = raw.trim().replace(/^!+/, '').toLowerCase()
  return KEYWORD_RE.test(clean) ? clean : null
}

/**
 * Strictly validates a custom search engine URL template:
 * - Must use https:// only (never http:, file:, javascript:, data:).
 * - Must include the `%s` query placeholder.
 */
export function validateSearchUrlTemplate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > 2048 || /[\0\r\n\s]/.test(trimmed)) return null
  if (!trimmed.includes('%s')) return null
  const sample = trimmed.replaceAll('%s', 'orbit')
  let parsed: URL
  try {
    parsed = new URL(sample)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (!parsed.hostname || !parsed.hostname.includes('.')) return null
  return trimmed
}

function slugEngineId(name: string, used: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'engine'
  if (!used.has(base)) return base
  for (let n = 2; n < 10_000; n++) {
    const cand = `${base}-${n}`
    if (!used.has(cand)) return cand
  }
  return `engine-${Date.now().toString(36)}`
}

export function sanitizeSearchEngines(raw: unknown): SearchEngine[] {
  if (!Array.isArray(raw)) return cloneDefaultSearchEngines()
  const out: SearchEngine[] = []
  const usedIds = new Set<string>()
  const usedKeywords = new Set<string>()
  const builtInIds = new Set(DEFAULT_SEARCH_ENGINES.map((e) => e.id))

  for (const item of raw) {
    if (out.length >= MAX_SEARCH_ENGINES) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const rec = item as Record<string, unknown>
    const name = sanitizeSearchEngineName(rec.name)
    const keyword = sanitizeSearchKeyword(rec.keyword)
    const urlTemplate = validateSearchUrlTemplate(rec.urlTemplate)
    if (!name || !keyword || !urlTemplate) continue
    if (usedKeywords.has(keyword)) continue
    const rawId = typeof rec.id === 'string' && ID_RE.test(rec.id.trim().toLowerCase()) ? rec.id.trim().toLowerCase() : null
    const id = rawId && !usedIds.has(rawId) ? rawId : slugEngineId(name, usedIds)
    usedIds.add(id)
    usedKeywords.add(keyword)
    out.push({
      id,
      name,
      keyword,
      urlTemplate,
      ...(builtInIds.has(id) ? { builtIn: true } : {})
    })
  }
  return out.length > 0 ? out : cloneDefaultSearchEngines()
}

/** Builds a concrete search URL from either a `%s` template or legacy prefix URL. */
export function buildEngineSearchUrl(query: string, engineOrTemplate: SearchEngine | string): string {
  const template = typeof engineOrTemplate === 'string' ? engineOrTemplate : engineOrTemplate.urlTemplate
  const encoded = encodeURIComponent(query)
  if (template.includes('%s')) {
    return template.replaceAll('%s', encoded)
  }
  return template + encoded
}

export interface KeywordSearchMatch {
  engine: SearchEngine
  /** The search terms with the keyword/bang stripped (may be '' right after typing "w " or "!w "). */
  query: string
  /** Whether the user used a leading/trailing !bang syntax. */
  isBang: boolean
  /** Exact trigger token typed (e.g. "!w" or "w"). */
  trigger: string
}

/**
 * Matches keyword or !bang search input against configured search engines:
 * - Leading bang: "!w cats", "!w "
 * - Leading keyword: "w cats", "w "
 * - Trailing bang: "cats !w"
 */
export function parseKeywordSearch(input: string, engines: readonly SearchEngine[]): KeywordSearchMatch | null {
  if (!input || !engines.length) return null
  const byKeyword = new Map<string, SearchEngine>()
  for (const e of engines) {
    byKeyword.set(e.keyword.toLowerCase(), e)
  }

  // Leading bang or keyword followed by at least one space
  const lead = /^\s*(!)?([a-z0-9][a-z0-9_-]{0,15})\s+(.*)$/i.exec(input)
  if (lead) {
    const isBang = lead[1] === '!'
    const kw = lead[2].toLowerCase()
    const engine = byKeyword.get(kw)
    if (engine) {
      return {
        engine,
        query: lead[3].trim(),
        isBang,
        trigger: isBang ? `!${kw}` : kw
      }
    }
  }

  // Trailing bang: "quantum physics !w"
  const trail = /^\s*(.+?)\s+!([a-z0-9][a-z0-9_-]{0,15})\s*$/i.exec(input)
  if (trail) {
    const kw = trail[2].toLowerCase()
    const engine = byKeyword.get(kw)
    if (engine) {
      return {
        engine,
        query: trail[1].trim(),
        isBang: true,
        trigger: `!${kw}`
      }
    }
  }

  return null
}

/** Returns the default SearchEngine matching `id`, falling back to the first configured engine. */
export function findDefaultSearchEngine(engines: readonly SearchEngine[], id: string): SearchEngine {
  return engines.find((e) => e.id === id) ?? engines[0] ?? DEFAULT_SEARCH_ENGINES[0]
}
