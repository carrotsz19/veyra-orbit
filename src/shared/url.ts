/** What the address bar does with what you type: go to a site, or search for it. */

export const SEARCH_URL = 'https://www.google.com/search?q='

/** Builds a search URL for `query` using the given search URL prefix (default Google). */
export function buildSearchUrl(query: string, searchUrl: string = SEARCH_URL): string {
  return searchUrl + encodeURIComponent(query)
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i
// localhost, an IPv4 address or a dotted name ending in a letter TLD, then an optional port and path.
const HOSTLIKE = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|(?:[a-z0-9-]+\.)+[a-z]{2,63})(:\d{1,5})?([/?#].*)?$/i

/** The schemes a page may be opened or navigated to. Everything else (file:, javascript:, data:, ...) is refused. */
export function isAllowedUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol === 'http:' || u.protocol === 'https:') return true
  return url === 'about:blank'
}

/**
 * Veyra Orbit's own pages (history, bookmarks). The UI draws them; no web page can open them,
 * and isAllowedUrl() stays false for them so a page can never navigate to one.
 */
export const INTERNAL_PAGES = {
  'orbit://history': 'History',
  'orbit://bookmarks': 'Bookmarks',
  'orbit://settings': 'Settings'
} as const
export type InternalUrl = keyof typeof INTERNAL_PAGES

export function isInternalUrl(url: string): url is InternalUrl {
  return Object.prototype.hasOwnProperty.call(INTERNAL_PAGES, url)
}

/** Turns address bar input into a URL to load. Empty input gives null. */
export function toUrl(input: string, searchUrl: string = SEARCH_URL): string | null {
  const text = input.trim()
  if (!text) return null
  const internal = text.toLowerCase().replace(/\/$/, '')
  if (isInternalUrl(internal)) return internal
  if (!/\s/.test(text)) {
    const host = HOSTLIKE.exec(text)
    if (host) {
      const local = /^(localhost|\d{1,3}(?:\.\d{1,3}){3})$/i.test(host[1])
      return `${local ? 'http' : 'https'}://${text}`
    }
    const scheme = SCHEME.exec(text)
    if (scheme && isAllowedUrl(text)) return new URL(text).href
  }
  return buildSearchUrl(text, searchUrl)
}

/** The address as shown when you're not editing it: no https://, no www., no lone trailing slash. */
export function displayUrl(url: string): string {
  if (!url) return ''
  if (isInternalUrl(url)) return url
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return url
    const host = u.host.replace(/^www\./, '')
    const rest = u.pathname === '/' && !u.search && !u.hash ? '' : u.pathname + u.search + u.hash
    return (u.protocol === 'http:' ? 'http://' : '') + host + rest
  } catch {
    return url
  }
}

/**
 * Whether activating a tab should automatically focus and select the address bar.
 * Only a blank start-page tab does this; web pages focus their view, and internal pages
 * (orbit://settings, orbit://history, orbit://bookmarks) or error pages focus the UI
 * without grabbing or selecting the address bar.
 */
export function shouldFocusOmniboxOnActivate(tab: { url: string; error?: unknown }): boolean {
  return !tab.url && !tab.error
}

export interface OmniboxSyncInput {
  prevTabId: number | undefined
  nextTabId: number | undefined
  url: string
  editing: boolean
}

export interface OmniboxSyncResult {
  resetEditing: boolean
  nextText: string | null
}

/**
 * Decides how the address bar text/editing state should sync when the active tab or its URL updates.
 * Switching to a different tab always exits editing and shows the newly active tab's URL;
 * same-tab URL updates leave the input untouched while the user is actively typing.
 */
export function resolveOmniboxSync(input: OmniboxSyncInput): OmniboxSyncResult {
  if (input.prevTabId !== undefined && input.nextTabId !== input.prevTabId) {
    return { resetEditing: true, nextText: displayUrl(input.url) }
  }
  if (!input.editing) {
    return { resetEditing: false, nextText: displayUrl(input.url) }
  }
  return { resetEditing: false, nextText: null }
}
