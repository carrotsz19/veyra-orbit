/*
 * Allowlist for external desktop-app URI schemes (mailto:, tel:, zoommtg:, msteams:, ...).
 * Anything not listed here is blocked and never handed to shell.openExternal.
 */

const EXTERNAL_SCHEMES: Readonly<Record<string, string>> = {
  'mailto:': 'Mail',
  'tel:': 'Phone',
  'sms:': 'Messages',
  'zoommtg:': 'Zoom',
  'zoomus:': 'Zoom',
  'msteams:': 'Microsoft Teams',
  'slack:': 'Slack',
  'discord:': 'Discord',
  'spotify:': 'Spotify',
  'facetime:': 'FaceTime',
  'webcal:': 'Calendar'
}

const SUBFRAME_WEB_SCHEMES = new Set(['http:', 'https:', 'about:', 'blob:', 'data:', 'javascript:'])
const MAX_URL_LEN = 4096
/** The fixed ID of Chromium's PDF viewer extension, built into Electron. */
const PDF_VIEWER_ID = 'mhjfbmdgcfjbbpaeojofohoefgiehjai'

export interface ExternalAppTarget {
  url: string
  /** Lower-case scheme without trailing colon, e.g. 'mailto', 'zoommtg'. */
  scheme: string
  /** Friendly app name shown in the confirmation bar, e.g. 'Mail', 'Zoom'. */
  appName: string
}

/**
 * Validates whether `raw` is an allowlisted external-app URI.
 * Rejects control characters, oversized strings, web URLs, and all dangerous/unknown schemes.
 */
export function parseExternalAppUrl(raw: string): ExternalAppTarget | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > MAX_URL_LEN) return null
  // Reject ASCII control characters before URL parsing (new URL strips \r, \n, \t).
  if (/[\x00-\x1f\x7f]/.test(raw)) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  const protocol = parsed.protocol.toLowerCase()
  const appName = Object.prototype.hasOwnProperty.call(EXTERNAL_SCHEMES, protocol) ? EXTERNAL_SCHEMES[protocol] : undefined
  if (!appName) return null
  return {
    url: parsed.href,
    scheme: protocol.slice(0, -1),
    appName
  }
}

export function isExternalAppUrl(raw: string): boolean {
  return parseExternalAppUrl(raw) !== null
}

/**
 * Schemes a subframe (iframe) may navigate to in-process.
 * Blocks file:, chrome:, orbit:, ms-msdt:, and external protocol handlers from firing silently inside iframes.
 */
export function isSafeSubframeUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    // Chromium's built-in PDF viewer draws the document in a frame of its own (and only its own) extension.
    if (u.protocol === 'chrome-extension:' && u.host === PDF_VIEWER_ID) return true
    return SUBFRAME_WEB_SCHEMES.has(u.protocol.toLowerCase())
  } catch {
    return false
  }
}
