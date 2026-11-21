/*
 * Companion preload for Electron 45+ (Chromium 156+) extension contexts.
 *
 * Chromium 156 natively exposes `globalThis.browser` as a separate object from
 * `globalThis.chrome`. `electron-chrome-extensions@4.10.0` only patches
 * `globalThis.chrome`, leaving `globalThis.browser` missing polyfilled APIs such
 * as `commands`, `tabs`, `windows`, `contextMenus`, `cookies`, `webNavigation`,
 * and `notifications`. Extensions like uBlock Origin Lite pick `self.browser ||
 * self.chrome` and crash during MV3 service-worker registration (Status code 15)
 * on `browser.commands.onCommand`.
 *
 * Runs strictly in extension service workers and `chrome-extension://` frames;
 * guaranteed no-op on all web pages.
 */
import { contextBridge, webFrame } from 'electron'

const isServiceWorker = (process as unknown as { type?: string }).type === 'service-worker'
const isExtensionFrame =
  !isServiceWorker &&
  typeof location !== 'undefined' &&
  typeof location.href === 'string' &&
  location.href.startsWith('chrome-extension://')

function mirrorChromeToBrowser(): void {
  const g = globalThis as unknown as {
    chrome?: Record<string, unknown>
    browser?: Record<string, unknown>
  }
  const c = g.chrome
  if (!c || typeof c !== 'object') return
  const b = g.browser
  if (!b || typeof b !== 'object' || b === c) return

  const apis = [
    'action',
    'browserAction',
    'commands',
    'contextMenus',
    'cookies',
    'downloads',
    'extension',
    'i18n',
    'notifications',
    'permissions',
    'privacy',
    'runtime',
    'storage',
    'tabs',
    'topSites',
    'webNavigation',
    'webRequest',
    'windows'
  ]

  for (const name of apis) {
    if (c[name] !== undefined) {
      try {
        Object.defineProperty(b, name, {
          value: c[name],
          enumerable: true,
          configurable: true
        })
      } catch {
        try {
          b[name] = c[name]
        } catch {
          /* ignore non-writable properties */
        }
      }
    }
  }
}

if (isServiceWorker || isExtensionFrame) {
  if (!process.contextIsolated) {
    mirrorChromeToBrowser()
  } else {
    try {
      const cb = contextBridge as unknown as {
        executeInMainWorld?: (opts: { func: () => void }) => void
      }
      if (typeof cb.executeInMainWorld === 'function') {
        cb.executeInMainWorld({ func: mirrorChromeToBrowser })
      } else if (webFrame && typeof webFrame.executeJavaScript === 'function') {
        void webFrame.executeJavaScript(`(${mirrorChromeToBrowser.toString()})();`)
      }
    } catch {
      /* ignore if context is tearing down */
    }
  }
}
