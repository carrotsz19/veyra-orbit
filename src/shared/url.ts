/** What the address bar does with what you type: go to a site, or search for it. */

export const SEARCH_URL = 'https://www.google.com/search?q='

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

/** Turns address bar input into a URL to load. Empty input gives null. */
export function toUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (!/\s/.test(text)) {
    const host = HOSTLIKE.exec(text)
    if (host) {
      const local = /^(localhost|\d{1,3}(?:\.\d{1,3}){3})$/i.test(host[1])
      return `${local ? 'http' : 'https'}://${text}`
    }
    const scheme = SCHEME.exec(text)
    if (scheme && isAllowedUrl(text)) return new URL(text).href
  }
  return SEARCH_URL + encodeURIComponent(text)
}

/** The address as shown when you're not editing it: no https://, no www., no lone trailing slash. */
export function displayUrl(url: string): string {
  if (!url) return ''
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
