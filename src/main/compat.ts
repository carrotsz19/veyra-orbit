/*
 * Browser compatibility layer for web pages (tabs and sign-in popups, never Orbit's own UI):
 *  - Sets consistent Chrome User-Agent + Client Hints (Sec-CH-UA* & navigator.userAgentData)
 *    for general browsing.
 *  - For accounts.google.com only, uses a current desktop Firefox UA and strips Sec-CH-UA*
 *    headers because Google's sign-in rejects Electron/Chromium builds that lack proprietary
 *    Google Chrome branding even when Sec-CH-UA claims Chrome.
 *  - Disables WebAuthn conditional mediation before page scripts run so sign-in pages don't
 *    pop up a modal Windows Security passkey dialog on load (explicit passkey clicks still work).
 */
import type { Session, WebContents } from 'electron'
import { release } from 'node:os'
import {
  applyCompatRequestHeaders,
  buildChromeIdentity,
  isGoogleAuthUrl,
  WEBAUTHN_CONDITIONAL_SHIM,
  type ChromeIdentity
} from '../shared/compat'

let cachedIdentity: ChromeIdentity | null = null

export function chromeIdentity(): ChromeIdentity {
  cachedIdentity ??= buildChromeIdentity({
    chromeVersion: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    osRelease: release()
  })
  return cachedIdentity
}

/**
 * Rewrites HTTP User-Agent and Sec-CH-UA* headers for the web session so every request
 * (including initial navigations, redirects, and sign-in popups) matches our page identity.
 */
export function attachSessionCompat(sess: Session): void {
  const id = chromeIdentity()
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: applyCompatRequestHeaders(details.url, details.requestHeaders, id) })
  })
}

/**
 * Attaches client-hint metadata and the WebAuthn conditional-mediation shim to a web page
 * (both normal tabs and sign-in popups). Never used on the browser's own UI window.
 */
export function attachPageCompat(wc: WebContents): void {
  if (wc.isDestroyed()) return
  const id = chromeIdentity()
  const dbg = wc.debugger
  let mode: 'chrome' | 'google-auth' | null = null

  const applyUaForUrl = (url: string): void => {
    if (wc.isDestroyed() || !dbg.isAttached()) return
    const nextMode: 'chrome' | 'google-auth' = isGoogleAuthUrl(url) ? 'google-auth' : 'chrome'
    if (nextMode === mode) return
    mode = nextMode
    if (nextMode === 'google-auth') {
      // Match the Firefox UA sent by onBeforeSendHeaders so navigator.userAgent agrees with HTTP headers.
      void dbg.sendCommand('Emulation.setUserAgentOverride', { userAgent: id.firefoxUserAgent }).catch(() => {})
    } else {
      void dbg
        .sendCommand('Emulation.setUserAgentOverride', {
          userAgent: id.userAgent,
          userAgentMetadata: {
            brands: id.brands,
            fullVersionList: id.fullVersionList,
            platform: id.platform,
            platformVersion: id.platformVersion,
            architecture: id.architecture,
            model: '',
            mobile: false,
            bitness: id.bitness
          }
        })
        .catch(() => {})
    }
  }

  const attach = (): void => {
    if (wc.isDestroyed()) return
    try {
      if (!dbg.isAttached()) dbg.attach('1.3')
    } catch {
      return
    }
    mode = null
    applyUaForUrl(wc.getURL())
    void dbg.sendCommand('Page.enable').catch(() => {})
    void dbg
      .sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: WEBAUTHN_CONDITIONAL_SHIM,
        runImmediately: true
      })
      .catch(() => {})
  }

  dbg.on('detach', () => {
    mode = null
  })

  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) applyUaForUrl(details.url)
  })
  wc.on('will-redirect', (_e, url) => applyUaForUrl(url))

  attach()
}
