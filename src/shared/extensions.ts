/*
 * Pure Chrome extension types, URL/origin security guards, cookie host-permission
 * matching, plain-English permission descriptions, lazy-load partition rules, and
 * registry sanitization. Shared between main, renderer, and node:test unit tests.
 */

export const CHROME_WEB_STORE_ORIGIN = 'https://chromewebstore.google.com'
export const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/'

const EXTENSION_ID_RE = /^[a-p]{32}$/

export type ExtensionSource = 'webstore' | 'unpacked'
export type PermissionRisk = 'high' | 'medium' | 'low'

export interface ExtensionPermissionDetail {
  /** Raw manifest permission or host pattern (e.g. "cookies", "<all_urls>"). */
  key: string
  /** Plain-English explanation shown in install confirmation and Settings. */
  label: string
  risk: PermissionRisk
}

export interface ExtensionSummary {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  pinned: boolean
  source: ExtensionSource
  /** Only set for unpacked extensions. */
  unpackedPath?: string
  permissions: ExtensionPermissionDetail[]
  rawPermissions: string[]
  hostPermissions: string[]
  optionsUrl?: string
  iconDataUrl?: string
  /** Approximate private memory (MB) across running extension processes, or null when idle. */
  memoryMB: number | null
  error?: string
}

export interface ExtensionActionView {
  id: string
  name: string
  title: string
  badgeText: string
  badgeColor: string
  iconDataUrl?: string
  hasPopup: boolean
  pinned: boolean
}

export interface ExtensionInstallAsk {
  requestId: string
  id: string
  name: string
  version: string
  iconDataUrl?: string
  permissions: ExtensionPermissionDetail[]
  source: 'webstore' | 'id'
}

export interface ExtensionsState {
  extensions: ExtensionSummary[]
  developerMode: boolean
}

export interface StoredExtensionEntry {
  id: string
  source: ExtensionSource
  enabled: boolean
  pinned: boolean
  /** Disk path for unpacked extensions; store extensions live under userData/Extensions/<id>. */
  unpackedPath?: string
  /** Cached display metadata so disabled extensions still show cleanly in Settings. */
  name?: string
  version?: string
  description?: string
}

export interface ExtensionsRegistry {
  version: 1
  developerMode: boolean
  extensions: StoredExtensionEntry[]
}

export const DEFAULT_EXTENSIONS_REGISTRY: ExtensionsRegistry = {
  version: 1,
  developerMode: false,
  extensions: []
}

// ---- ID & origin validation ------------------------------------------------

export function validateExtensionId(id: unknown): id is string {
  return typeof id === 'string' && EXTENSION_ID_RE.test(id)
}

/**
 * Extracts a 32-character Chrome extension ID from either a bare ID or a
 * Chrome Web Store URL (https://chromewebstore.google.com/detail/.../<id>).
 */
export function extractExtensionId(input: string): string | null {
  const trimmed = input.trim()
  if (validateExtensionId(trimmed)) return trimmed
  try {
    const u = new URL(trimmed)
    if (u.origin !== CHROME_WEB_STORE_ORIGIN && u.origin !== 'https://chrome.google.com') return null
    const segments = u.pathname.split('/').filter(Boolean)
    for (let i = segments.length - 1; i >= 0; i--) {
      if (validateExtensionId(segments[i])) return segments[i]
    }
  } catch {
    return null
  }
  return null
}

/**
 * Strict Chrome Web Store origin check: requires exact origin equality with
 * https://chromewebstore.google.com (rejecting lookalike hosts such as
 * https://chromewebstore.google.com.attacker.test and non-HTTPS origins).
 */
export function isAllowedWebStoreOrigin(origin: unknown): boolean {
  if (typeof origin !== 'string') return false
  try {
    const u = new URL(origin)
    return u.origin === CHROME_WEB_STORE_ORIGIN && u.href.replace(/\/$/, '') === CHROME_WEB_STORE_ORIGIN
  } catch {
    return false
  }
}

// ---- Tab / Window URL guard ------------------------------------------------

/**
 * Validates URLs passed by an extension to chrome.tabs.create, chrome.tabs.update,
 * or chrome.windows.create.
 *
 * Allows ONLY:
 *  - http:// and https:// URLs
 *  - chrome-extension://<callerExtensionId>/... (pages belonging to THAT SAME extension)
 *
 * Rejects file:, data:, javascript:, orbit:, chrome:, blob:, mailto:, other
 * extensions' chrome-extension:// URLs, and malformed URLs.
 */
export function isAllowedExtensionTabUrl(rawUrl: unknown, callerExtensionId: string): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false
  if (!validateExtensionId(callerExtensionId)) return false
  let parsed: URL
  try {
    // Resolve relative paths (e.g. "dashboard.html") against the caller's own extension origin.
    parsed = new URL(rawUrl, `chrome-extension://${callerExtensionId}/`)
  } catch {
    return false
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return !!parsed.hostname
  }
  if (parsed.protocol === 'chrome-extension:') {
    return parsed.hostname === callerExtensionId
  }
  return false
}

/**
 * Resolves a validated extension tab URL to its canonical href, or returns null if rejected.
 */
export function resolveAllowedExtensionTabUrl(rawUrl: unknown, callerExtensionId: string): string | null {
  if (!isAllowedExtensionTabUrl(rawUrl, callerExtensionId)) return null
  return new URL(rawUrl as string, `chrome-extension://${callerExtensionId}/`).href
}

// ---- Session partition & lazy-load rules -----------------------------------

/**
 * Returns true if a session partition may host Chrome extensions.
 * Only persistent web sessions (`persist:web` and isolated `persist:ws-<id>`)
 * are allowed; private in-memory workspaces (`private-ws-*`) and Orbit's own UI
 * session (`''` / defaultSession) NEVER load extensions.
 */
export function shouldLoadExtensionsForPartition(partition: string): boolean {
  if (typeof partition !== 'string' || !partition) return false
  if (partition === 'persist:web') return true
  if (partition.startsWith('persist:ws-') && partition.length > 'persist:ws-'.length) {
    return /^persist:ws-[a-z0-9][a-z0-9-]{0,39}$/.test(partition)
  }
  return false
}

/**
 * Decides whether extensions should be loaded into a partition right now:
 *  - Private / non-persistent partitions: NEVER.
 *  - Default shared web partition (`persist:web`): immediately when enabled.
 *  - Isolated workspace partitions (`persist:ws-<id>`): lazily, ONLY once that
 *    workspace has been activated/used.
 */
export function shouldAttachExtensionsNow(partition: string, activatedPartitions: ReadonlySet<string>): boolean {
  if (!shouldLoadExtensionsForPartition(partition)) return false
  if (partition === 'persist:web') return true
  return activatedPartitions.has(partition)
}

// ---- Cookie permission & host-permission matching --------------------------

export interface CookieLike {
  domain?: string
  path?: string
  secure?: boolean
  name?: string
}

export interface ManifestLike {
  name?: string
  version?: string
  description?: string
  permissions?: unknown
  host_permissions?: unknown
  optional_permissions?: unknown
  optional_host_permissions?: unknown
}

/** Extracts string host patterns declared in a manifest (MV3 host_permissions + MV2 URL patterns in permissions). */
export function extractHostPermissions(manifest: ManifestLike | null | undefined): string[] {
  if (!manifest || typeof manifest !== 'object') return []
  const out: string[] = []
  const add = (list: unknown, onlyPatterns: boolean): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (typeof item !== 'string') continue
      const s = item.trim()
      if (!s) continue
      if (!onlyPatterns || s === '<all_urls>' || s.includes('://')) {
        if (!out.includes(s)) out.push(s)
      }
    }
  }
  add(manifest.host_permissions, false)
  add(manifest.permissions, true)
  return out
}

/** Returns true if an extension manifest explicitly declares the given API permission (e.g. "cookies"). */
export function hasManifestPermission(manifest: ManifestLike | null | undefined, permission: string): boolean {
  if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.permissions)) return false
  return manifest.permissions.includes(permission)
}

function escapeRegex(s: string): string {
  return s.replace(/[\\^$+?.()|[\]{}]/g, '\\$&')
}

/**
 * Matches a Chromium match pattern (e.g. `<all_urls>`, `https://*.example.com/*`,
 * `*://example.com/path/*`) against an http(s) URL.
 */
export function matchHostPattern(pattern: string, rawUrl: string): boolean {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const trimmed = pattern.trim()
  if (!trimmed) return false
  if (trimmed === '<all_urls>') return true

  const m = /^(\*|https?|wss?):\/\/([^/]+)(\/.*)?$/.exec(trimmed)
  if (!m) return false
  const [, schemePat, hostPat, pathPat = '/*'] = m

  if (schemePat === '*') {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  } else if (`${schemePat}:` !== u.protocol) {
    return false
  }

  const host = u.hostname.toLowerCase()
  // Strip optional port from host pattern (Chrome match patterns ignore port or allow :*).
  const cleanHostPat = hostPat.replace(/:\*$/, '').toLowerCase()
  if (cleanHostPat === '*') {
    // matches any host
  } else if (cleanHostPat.startsWith('*.')) {
    const base = cleanHostPat.slice(2)
    if (!base) return false
    if (host !== base && !host.endsWith(`.${base}`)) return false
  } else {
    if (host !== cleanHostPat) return false
  }

  const targetPath = `${u.pathname}${u.search}`
  const pathRe = new RegExp(`^${pathPat.split('*').map(escapeRegex).join('.*')}$`)
  return pathRe.test(targetPath)
}

export function isUrlPermittedByHostPermissions(url: unknown, hostPermissions: readonly string[]): boolean {
  if (typeof url !== 'string' || !url || hostPermissions.length === 0) return false
  return hostPermissions.some((pat) => matchHostPattern(pat, url))
}

/**
 * Checks whether an extension with `hostPermissions` is allowed to access a given cookie.
 * Matches Chrome's rule: a cookie on `.example.com` matches a host pattern covering `example.com`
 * (or subdomains if the pattern is `*.example.com`).
 */
export function isCookiePermittedByHostPermissions(cookie: CookieLike, hostPermissions: readonly string[]): boolean {
  if (!cookie || hostPermissions.length === 0) return false
  const rawDomain = (cookie.domain ?? '').trim().toLowerCase()
  if (!rawDomain) return false
  const host = rawDomain.startsWith('.') ? rawDomain.slice(1) : rawDomain
  if (!host) return false
  const cookiePath = cookie.path && cookie.path.startsWith('/') ? cookie.path : '/'
  const schemes = cookie.secure ? ['https'] : ['https', 'http']

  for (const scheme of schemes) {
    const candidate = `${scheme}://${host}${cookiePath}`
    if (hostPermissions.some((pat) => matchHostPattern(pat, candidate))) return true
  }
  return false
}

export function filterCookiesByHostPermissions<T extends CookieLike>(
  cookies: readonly T[],
  hostPermissions: readonly string[]
): T[] {
  if (hostPermissions.length === 0) return []
  return cookies.filter((c) => isCookiePermittedByHostPermissions(c, hostPermissions))
}

/**
 * Checks whether an extension is authorized for a chrome.cookies.* call:
 * requires BOTH the "cookies" manifest permission AND matching host permissions
 * (if a target URL is specified).
 */
export function canAccessCookiesForUrl(
  manifest: ManifestLike | null | undefined,
  url?: string
): boolean {
  if (!hasManifestPermission(manifest, 'cookies')) return false
  const hosts = extractHostPermissions(manifest)
  if (hosts.length === 0) return false
  if (url !== undefined) return isUrlPermittedByHostPermissions(url, hosts)
  return true
}

// ---- Plain-English permission descriptions ---------------------------------

const ALL_URLS_PATTERNS = new Set([
  '<all_urls>',
  '*://*/*',
  'http://*/*',
  'https://*/*',
  '*://*:*/*'
])

const PERMISSION_DESCRIPTIONS: Record<string, { label: string; risk: PermissionRisk }> = {
  cookies: { label: 'Read and change your cookies on allowed websites', risk: 'high' },
  history: { label: 'Read your browsing history', risk: 'high' },
  tabs: { label: 'Read your open tabs and website addresses', risk: 'medium' },
  bookmarks: { label: 'Read and change your bookmarks', risk: 'medium' },
  downloads: { label: 'Manage your downloads', risk: 'medium' },
  clipboardRead: { label: 'Read data you copy and paste', risk: 'high' },
  clipboardWrite: { label: 'Modify data you copy and paste', risk: 'low' },
  declarativeNetRequest: { label: 'Block or modify network requests on websites', risk: 'high' },
  declarativeNetRequestWithHostAccess: { label: 'Block or modify network requests on allowed websites', risk: 'medium' },
  declarativeNetRequestFeedback: { label: 'See which network requests it blocked', risk: 'low' },
  webNavigation: { label: 'Read your browsing activity as pages load', risk: 'medium' },
  webRequest: { label: 'Observe network requests made by websites', risk: 'high' },
  scripting: { label: 'Run scripts on websites you allow', risk: 'high' },
  activeTab: { label: 'Access the current tab when you click its button', risk: 'low' },
  notifications: { label: 'Show desktop notifications', risk: 'low' },
  contextMenus: { label: 'Add items to the right-click menu', risk: 'low' },
  storage: { label: 'Store settings and data locally in Orbit', risk: 'low' },
  unlimitedStorage: { label: 'Store large amounts of local data in Orbit', risk: 'low' },
  alarms: { label: 'Schedule background tasks', risk: 'low' },
  idle: { label: 'Know when your computer is idle', risk: 'low' },
  management: { label: 'Manage your installed extensions', risk: 'high' },
  nativeMessaging: { label: 'Communicate with native apps on your computer (disabled in Orbit)', risk: 'high' },
  privacy: { label: 'Change browser privacy settings', risk: 'medium' },
  topSites: { label: 'Read a list of your most visited websites', risk: 'medium' },
  geolocation: { label: 'Detect your physical location', risk: 'medium' }
}

function describeHostPattern(pattern: string): { label: string; risk: PermissionRisk; isAll: boolean } {
  const trimmed = pattern.trim()
  if (ALL_URLS_PATTERNS.has(trimmed)) {
    return { label: 'Read and change all your data on all websites', risk: 'high', isAll: true }
  }
  const m = /^(?:\*|https?|wss?):\/\/([^/]+)/.exec(trimmed)
  if (m) {
    const host = m[1].replace(/^\*\./, '').replace(/:\*$/, '')
    if (host === '*') {
      return { label: 'Read and change all your data on all websites', risk: 'high', isAll: true }
    }
    return { label: `Read and change your data on ${host}`, risk: 'medium', isAll: false }
  }
  return { label: `Access site data matching ${trimmed}`, risk: 'medium', isAll: false }
}

/**
 * Translates an extension's manifest permissions + host_permissions into concise,
 * plain-English statements sorted highest-risk first, deduplicated cleanly.
 */
export function describeManifestPermissions(manifest: ManifestLike | null | undefined): ExtensionPermissionDetail[] {
  if (!manifest || typeof manifest !== 'object') return []
  const details: ExtensionPermissionDetail[] = []
  const seenLabels = new Set<string>()
  const push = (key: string, label: string, risk: PermissionRisk): void => {
    if (seenLabels.has(label)) return
    seenLabels.add(label)
    details.push({ key, label, risk })
  }

  const hostPatterns = extractHostPermissions(manifest)
  const hasAllSites = hostPatterns.some((p) => describeHostPattern(p).isAll)
  if (hasAllSites) {
    push('<all_urls>', 'Read and change all your data on all websites', 'high')
  } else {
    const sites: string[] = []
    for (const pat of hostPatterns) {
      const d = describeHostPattern(pat)
      if (!sites.includes(d.label)) sites.push(d.label)
    }
    if (sites.length <= 4) {
      for (const label of sites) push(label, label, 'medium')
    } else {
      push('host_permissions', `Read and change your data on ${sites.length} websites`, 'high')
    }
  }

  if (Array.isArray(manifest.permissions)) {
    for (const raw of manifest.permissions) {
      if (typeof raw !== 'string') continue
      const perm = raw.trim()
      if (!perm || perm === '<all_urls>' || perm.includes('://')) continue
      const mapped = PERMISSION_DESCRIPTIONS[perm]
      if (mapped) {
        push(perm, mapped.label, mapped.risk)
      }
    }
  }

  const order: Record<PermissionRisk, number> = { high: 0, medium: 1, low: 2 }
  details.sort((a, b) => order[a.risk] - order[b.risk])
  return details
}

// ---- Zip-Slip guard --------------------------------------------------------

/**
 * Ensures a ZIP entry name resolves strictly inside `destDir` with no path
 * traversal (`..`), drive-letter injection, or null bytes.
 */
export function isSafeZipEntryPath(entryName: string): boolean {
  if (typeof entryName !== 'string' || !entryName || entryName.includes('\0')) return false
  if (entryName.startsWith('/') || entryName.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(entryName)) return false
  const parts = entryName.replace(/\\/g, '/').split('/')
  let depth = 0
  for (const seg of parts) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      depth--
      if (depth < 0) return false
    } else {
      depth++
    }
  }
  return true
}

// ---- Registry sanitization -------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function safeString(v: unknown, maxLen: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const clean = v.replace(/[\0\r\n]+/g, ' ').trim().slice(0, maxLen)
  return clean || undefined
}

/** Validates arbitrary parsed JSON from extensions.json into a clean ExtensionsRegistry. */
export function sanitizeExtensionsRegistry(raw: unknown): ExtensionsRegistry {
  if (!isPlainObject(raw)) {
    return { version: 1, developerMode: false, extensions: [] }
  }
  const developerMode = raw.developerMode === true
  const seen = new Set<string>()
  const extensions: StoredExtensionEntry[] = []

  if (Array.isArray(raw.extensions)) {
    for (const item of raw.extensions) {
      if (!isPlainObject(item)) continue
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      if (!validateExtensionId(id) || seen.has(id)) continue
      const source: ExtensionSource = item.source === 'unpacked' ? 'unpacked' : 'webstore'
      const unpackedPath = source === 'unpacked' ? safeString(item.unpackedPath, 4096) : undefined
      if (source === 'unpacked' && !unpackedPath) continue
      seen.add(id)
      extensions.push({
        id,
        source,
        enabled: item.enabled !== false,
        pinned: item.pinned === true,
        ...(unpackedPath ? { unpackedPath } : {}),
        ...(safeString(item.name, 200) ? { name: safeString(item.name, 200) } : {}),
        ...(safeString(item.version, 64) ? { version: safeString(item.version, 64) } : {}),
        ...(safeString(item.description, 512) ? { description: safeString(item.description, 512) } : {})
      })
    }
  }

  return { version: 1, developerMode, extensions }
}
