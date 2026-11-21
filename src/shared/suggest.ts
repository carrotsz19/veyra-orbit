/*
 * Address bar suggestions: what you've typed, matched against open tabs, bookmarks and history.
 * Pure, so it's tested on its own (tests/suggest.test.ts).
 */
import { SEARCH_URL, displayUrl, toUrl } from './url.ts'

export interface Candidate {
  url: string
  title: string
  /** How many times it was visited, and how many of those you typed it. */
  visits: number
  typed: number
  /** Last visit, ms since 1970. 0 for a bookmark never visited. */
  last: number
  bookmarked: boolean
  /** Set when it's open in a tab: choosing it switches to that tab. */
  tabId?: number
}

export type Suggestion =
  | { kind: 'search'; text: string; url: string }
  | { kind: 'url'; url: string }
  | { kind: 'tab'; url: string; title: string; tabId: number }
  | { kind: 'page'; url: string; title: string; bookmarked: boolean }

const DAY = 86_400_000

function terms(input: string): string[] {
  return input.toLowerCase().split(/\s+/).filter(Boolean)
}

/** The address without scheme and www., lower case: what people actually type. */
function bare(url: string): string {
  return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
}

/** How well one candidate matches, or 0 if it doesn't. */
export function score(c: Candidate, input: string, now: number): number {
  const q = input.trim().toLowerCase()
  if (!q) return 0
  const words = terms(q)
  const url = bare(c.url)
  const title = c.title.toLowerCase()
  if (!words.every((w) => url.includes(w) || title.includes(w))) return 0

  let s = 1
  if (url.startsWith(q)) s += 40 // typing the start of an address you know
  else if (url.split('/')[0].includes('.' + q) || url.split('/')[0].startsWith(q)) s += 20
  if (words.every((w) => title.split(/\W+/).some((t) => t.startsWith(w)))) s += 10

  // Frecency: often and recently visited, typed visits counting most.
  const age = c.last ? (now - c.last) / DAY : 365
  const recency = age < 1 ? 1 : age < 7 ? 0.7 : age < 30 ? 0.45 : age < 90 ? 0.25 : 0.1
  s += Math.min(30, Math.log2(1 + c.visits + c.typed * 3) * 6) * recency
  if (c.bookmarked) s += 12
  if (c.tabId !== undefined) s += 8
  return s
}

/**
 * The list under the address bar. The first row is always what Enter does with the text as typed
 * (go to the address, or search for it).
 */
export function suggest(input: string, candidates: Candidate[], now = Date.now(), max = 7): Suggestion[] {
  const text = input.trim()
  if (!text) return []
  const target = toUrl(text)
  const out: Suggestion[] = []
  const seen = new Set<string>()

  if (target && !target.startsWith(SEARCH_URL)) {
    out.push({ kind: 'url', url: target })
    seen.add(target)
  }

  // One row per address: an open tab, its history and its bookmark become one "switch to tab" row.
  const byUrl = new Map<string, Candidate>()
  for (const c of candidates) {
    const had = byUrl.get(c.url)
    byUrl.set(
      c.url,
      had
        ? {
            url: c.url,
            title: had.title || c.title,
            visits: Math.max(had.visits, c.visits),
            typed: Math.max(had.typed, c.typed),
            last: Math.max(had.last, c.last),
            bookmarked: had.bookmarked || c.bookmarked,
            tabId: had.tabId ?? c.tabId
          }
        : c
    )
  }

  const ranked = [...byUrl.values()]
    .map((c) => ({ c, s: score(c, text, now) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)

  for (const { c } of ranked) {
    if (out.length >= max - 1) break
    if (seen.has(c.url)) continue
    seen.add(c.url)
    if (c.tabId !== undefined) out.push({ kind: 'tab', url: c.url, title: c.title || displayUrl(c.url), tabId: c.tabId })
    else out.push({ kind: 'page', url: c.url, title: c.title || displayUrl(c.url), bookmarked: c.bookmarked })
  }

  const search: Suggestion = { kind: 'search', text, url: SEARCH_URL + encodeURIComponent(text) }
  // Words with spaces read as a search first; an address-like entry keeps the address first.
  if (out[0]?.kind === 'url') out.splice(1, 0, search)
  else out.unshift(search)
  return out.slice(0, max)
}
