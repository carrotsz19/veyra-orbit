/**
 * Pure browser compatibility helpers:
 *  - Consistent Chrome UA + Client Hints identity for normal web browsing.
 *  - Narrow Firefox UA + Sec-CH-UA stripping for accounts.google.com only, because Google's
 *    sign-in rejects Chromium-based browsers that aren't official Google Chrome binaries.
 *  - Tiny WebAuthn conditional-mediation shim so sign-in pages don't auto-trigger Windows Hello.
 */

export const ORBIT_COMPAT_READY_PREFIX = 'orbit-compat:ready:'

const DNR_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'other'
] as const

export interface OrbitCompatDnrRule {
  id: number
  priority: number
  action: {
    type: 'modifyHeaders'
    requestHeaders: { header: string; operation: 'set' | 'remove'; value?: string }[]
  }
  condition: {
    urlFilter?: string
    requestDomains?: string[]
    excludedRequestDomains?: string[]
    resourceTypes: readonly string[]
  }
}

export interface BrandVersion {
  brand: string
  version: string
}

export interface ChromeIdentity {
  major: string
  fullVersion: string
  userAgent: string
  firefoxUserAgent: string
  platform: 'Windows' | 'macOS' | 'Linux'
  platformVersion: string
  architecture: 'x86' | 'arm'
  bitness: '32' | '64'
  brands: BrandVersion[]
  fullVersionList: BrandVersion[]
  secChUa: string
  secChUaFullVersionList: string
}

export interface ChromeIdentityInput {
  chromeVersion: string
  platform: NodeJS.Platform
  arch: string
  osRelease?: string
}

const FIREFOX_VERSION = '144.0'

function formatBrandsHeader(list: BrandVersion[]): string {
  return list.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')
}

function windowsPlatformVersion(osRelease?: string): string {
  const build = Number(String(osRelease ?? '').split('.')[2] ?? 0)
  return build >= 22000 ? '19.0.0' : '10.0.0'
}

/**
 * Builds a single consistent Chrome UA + Client Hints identity matching the bundled Chromium
 * version, plus a matching desktop Firefox UA used only for Google sign-in.
 */
export function buildChromeIdentity(input: ChromeIdentityInput): ChromeIdentity {
  const fullVersion = input.chromeVersion || '130.0.0.0'
  const major = fullVersion.split('.')[0] || '130'
  const uaPlatform =
    input.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : input.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  const ffPlatform =
    input.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10.15'
      : input.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  const platform: ChromeIdentity['platform'] =
    input.platform === 'darwin' ? 'macOS' : input.platform === 'win32' ? 'Windows' : 'Linux'
  const platformVersion =
    input.platform === 'win32'
      ? windowsPlatformVersion(input.osRelease)
      : input.platform === 'darwin'
        ? '15.0.0'
        : ''
  const architecture: ChromeIdentity['architecture'] = input.arch === 'arm64' ? 'arm' : 'x86'
  const bitness: ChromeIdentity['bitness'] = input.arch === 'ia32' ? '32' : '64'

  const brands: BrandVersion[] = [
    { brand: 'Google Chrome', version: major },
    { brand: 'Chromium', version: major },
    { brand: 'Not)A;Brand', version: '99' }
  ]
  const fullVersionList: BrandVersion[] = [
    { brand: 'Google Chrome', version: fullVersion },
    { brand: 'Chromium', version: fullVersion },
    { brand: 'Not)A;Brand', version: '99.0.0.0' }
  ]

  return {
    major,
    fullVersion,
    userAgent: `Mozilla/5.0 (${uaPlatform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    firefoxUserAgent: `Mozilla/5.0 (${ffPlatform}; rv:${FIREFOX_VERSION}) Gecko/20100101 Firefox/${FIREFOX_VERSION}`,
    platform,
    platformVersion,
    architecture,
    bitness,
    brands,
    fullVersionList,
    secChUa: formatBrandsHeader(brands),
    secChUaFullVersionList: formatBrandsHeader(fullVersionList)
  }
}

/** True only for Google's interactive sign-in host where Chromium builds without Chrome branding are blocked. */
export function isGoogleAuthUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl)
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.toLowerCase() === 'accounts.google.com'
  } catch {
    return false
  }
}

/**
 * Runs before page scripts in every frame, but only acts on Google's sign-in host. There Orbit
 * sends a Firefox user agent, so the page must also look like Firefox: no navigator.userAgentData,
 * no window.chrome, an empty navigator.vendor, so the identity is consistent. On its own this
 * doesn't stop Google rejecting the FIRST sign-in on a brand-new profile ("This browser or app may
 * not be secure"); retrying a couple of times works (tested 2026-11-21, see PLAN.md).
 */
export const GOOGLE_AUTH_FIREFOX_SHAPE = `(() => {
  if (location.hostname !== 'accounts.google.com') return
  const hide = (obj, prop) => { try { Object.defineProperty(obj, prop, { get: () => undefined, configurable: true }) } catch {} }
  hide(Navigator.prototype, 'userAgentData')
  try { Object.defineProperty(Navigator.prototype, 'vendor', { get: () => '', configurable: true }) } catch {}
  try { delete window.chrome } catch {}
  hide(window, 'chrome')
})()`

/**
 * Rewrites request headers for web compatibility:
 *  - accounts.google.com: Firefox UA and no Sec-CH-UA* headers (Google rejects non-Chrome Chromium).
 *  - everywhere else: Sec-CH-UA and Sec-CH-UA-Full-Version-List match ChromeIdentity.
 */
export function applyCompatRequestHeaders(
  url: string,
  requestHeaders: Record<string, string>,
  identity: ChromeIdentity
): Record<string, string> {
  const headers: Record<string, string> = { ...requestHeaders }
  if (isGoogleAuthUrl(url)) {
    let hasUa = false
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase()
      if (lower === 'user-agent') {
        headers[key] = identity.firefoxUserAgent
        hasUa = true
      } else if (lower.startsWith('sec-ch-ua')) {
        delete headers[key]
      }
    }
    if (!hasUa) headers['User-Agent'] = identity.firefoxUserAgent
    return headers
  }

  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase()
    if (lower === 'sec-ch-ua') headers[key] = identity.secChUa
    else if (lower === 'sec-ch-ua-full-version-list') headers[key] = identity.secChUaFullVersionList
  }
  return headers
}

/**
 * Builds the declarativeNetRequest rules installed by Orbit's hidden internal
 * `orbit-compat` extension in persistent sessions (where session.webRequest cannot stay
 * attached because it disables extension DNR).
 *
 * Rule 1 sets consistent Chrome Client Hints everywhere except accounts.google.com.
 * Rule 2 switches accounts.google.com to a desktop Firefox UA and removes all Sec-CH-UA* headers.
 */
export function buildOrbitCompatDnrRules(id: ChromeIdentity): OrbitCompatDnrRule[] {
  return [
    {
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Sec-CH-UA', operation: 'set', value: id.secChUa },
          { header: 'Sec-CH-UA-Full-Version-List', operation: 'set', value: id.secChUaFullVersionList }
        ]
      },
      condition: {
        urlFilter: '*',
        excludedRequestDomains: ['accounts.google.com'],
        resourceTypes: [...DNR_RESOURCE_TYPES]
      }
    },
    {
      id: 2,
      priority: 2,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'User-Agent', operation: 'set', value: id.firefoxUserAgent },
          { header: 'Sec-CH-UA', operation: 'remove' },
          { header: 'Sec-CH-UA-Mobile', operation: 'remove' },
          { header: 'Sec-CH-UA-Platform', operation: 'remove' },
          { header: 'Sec-CH-UA-Platform-Version', operation: 'remove' },
          { header: 'Sec-CH-UA-Full-Version', operation: 'remove' },
          { header: 'Sec-CH-UA-Full-Version-List', operation: 'remove' },
          { header: 'Sec-CH-UA-Arch', operation: 'remove' },
          { header: 'Sec-CH-UA-Bitness', operation: 'remove' },
          { header: 'Sec-CH-UA-Model', operation: 'remove' },
          { header: 'Sec-CH-UA-WoW64', operation: 'remove' },
          { header: 'Sec-CH-UA-Form-Factors', operation: 'remove' }
        ]
      },
      condition: {
        requestDomains: ['accounts.google.com'],
        resourceTypes: [...DNR_RESOURCE_TYPES]
      }
    }
  ]
}

/**
 * Generates the MV3 service worker script for `orbit-compat`.
 *
 * Electron's `session.extensions.loadExtension` does not index static `declarative_net_request`
 * `rule_resources`, so `orbit-compat` installs its rules via `updateSessionRules` on startup
 * and logs an extension-ID-scoped ready marker once Chromium has committed them.
 */
export function buildOrbitCompatWorkerScript(rules: readonly OrbitCompatDnrRule[]): string {
  const ids = rules.map((r) => r.id)
  return `const RULES = ${JSON.stringify(rules)};
const RULE_IDS = ${JSON.stringify(ids)};
let installing = null;
function installRules() {
  if (installing) return installing;
  installing = chrome.declarativeNetRequest
    .updateSessionRules({ removeRuleIds: RULE_IDS, addRules: RULES })
    .then(() => {
      console.log(${JSON.stringify(ORBIT_COMPAT_READY_PREFIX)} + chrome.runtime.id);
    })
    .catch((err) => {
      console.error('[orbit-compat] updateSessionRules failed:', String(err));
    })
    .finally(() => {
      installing = null;
    });
  return installing;
}
chrome.runtime.onInstalled.addListener(() => { void installRules(); });
chrome.runtime.onStartup.addListener(() => { void installRules(); });
void installRules();
`
}

/**
 * Main-world script injected before page scripts run.
 * Electron does not support WebAuthn conditional UI (passkey autofill), so pages calling
 * navigator.credentials.get({ mediation: 'conditional' }) on load trigger a modal Windows
 * Security dialog. Advertising conditional mediation as unavailable stops the auto-popup
 * while keeping explicit passkey sign-in ("Use a passkey") intact.
 */
export const WEBAUTHN_CONDITIONAL_SHIM = `(() => {
  try {
    const pkc = globalThis.PublicKeyCredential;
    if (pkc) {
      if (typeof pkc.isConditionalMediationAvailable === 'function') {
        Object.defineProperty(pkc, 'isConditionalMediationAvailable', {
          value: () => Promise.resolve(false),
          configurable: true,
          writable: true
        });
      }
      if (typeof pkc.getClientCapabilities === 'function') {
        const origCaps = pkc.getClientCapabilities.bind(pkc);
        Object.defineProperty(pkc, 'getClientCapabilities', {
          value: () => origCaps().then((c) => ({ ...c, conditionalGet: false, conditionalCreate: false })),
          configurable: true,
          writable: true
        });
      }
    }
    const creds = navigator.credentials;
    if (creds && typeof creds.get === 'function') {
      const origGet = creds.get.bind(creds);
      Object.defineProperty(creds, 'get', {
        value: function get(options) {
          if (options && typeof options === 'object' && options.mediation === 'conditional') {
            return Promise.reject(new DOMException('Conditional mediation is not supported.', 'NotAllowedError'));
          }
          return origGet(options);
        },
        configurable: true,
        writable: true
      });
    }
  } catch {}
})();`
