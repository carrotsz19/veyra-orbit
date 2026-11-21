/*
 * The security baseline for web pages. Pages run in their own sandboxed renderers with no preload
 * and no Node, in a session kept apart from the browser's own UI. Permissions are denied unless
 * the person allows them for that site.
 */
import { app, session, type Session, type WebContents } from 'electron'
import type { PermissionAsk } from '../shared/types'

/** Where web pages keep cookies and storage. Workspaces will get one each (persist:ws-<id>). */
export const WEB_PARTITION = 'persist:web'

/** Harmless permissions a page gets without asking, as in Chrome. */
const ALWAYS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'])
/** Permissions the person can be asked for. Anything not listed is always denied. */
const ASKABLE = new Set(['media', 'notifications', 'geolocation', 'clipboard-read', 'midi', 'idle-detection', 'display-capture'])

type Pending = PermissionAsk & { resolve: (allow: boolean) => void }

export class Permissions {
  private next = 1
  private pending: Pending[] = []
  /** Answers given this run, by "origin|permission". Kept in memory only for now. */
  private answers = new Map<string, boolean>()

  constructor(
    private tabIdOf: (wc: WebContents) => number | null,
    private publish: (asks: PermissionAsk[]) => void
  ) {}

  attach(sess: Session): void {
    sess.setPermissionRequestHandler((wc, permission, callback, details) => {
      const origin = originOf(details.requestingUrl || wc.getURL())
      if (ALWAYS.has(permission)) return callback(true)
      if (!origin || !ASKABLE.has(permission)) return callback(false)
      const key = `${origin}|${permission}`
      const known = this.answers.get(key)
      if (known !== undefined) return callback(known)
      // One question per site and permission; repeat requests wait on the same answer.
      const same = this.pending.find((p) => p.origin === origin && p.permission === permission)
      if (same) {
        const prev = same.resolve
        same.resolve = (allow) => (prev(allow), callback(allow))
        return
      }
      this.pending.push({ id: this.next++, tabId: this.tabIdOf(wc), origin, permission, resolve: callback })
      this.emit()
    })
    sess.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      if (ALWAYS.has(permission)) return true
      return this.answers.get(`${originOf(requestingOrigin)}|${permission}`) === true
    })
    // USB, HID and serial devices: never, for now.
    sess.setDevicePermissionHandler(() => false)
  }

  answer(id: number, allow: boolean): void {
    const i = this.pending.findIndex((p) => p.id === id)
    if (i < 0) return
    const [p] = this.pending.splice(i, 1)
    this.answers.set(`${p.origin}|${p.permission}`, allow)
    p.resolve(allow)
    this.emit()
  }

  /** A tab closed or navigated away: its open questions are answered no. */
  dropTab(tabId: number): void {
    const gone = this.pending.filter((p) => p.tabId === tabId)
    if (!gone.length) return
    this.pending = this.pending.filter((p) => p.tabId !== tabId)
    for (const p of gone) p.resolve(false)
    this.emit()
  }

  private emit(): void {
    this.publish(this.pending.map(({ resolve: _r, ...ask }) => ask))
  }
}

function originOf(url: string): string {
  try {
    const o = new URL(url).origin
    return o === 'null' ? '' : o
  } catch {
    return ''
  }
}

/**
 * Sites see a normal Chrome user agent, without "Electron/.." or the app's name in it.
 * Some sites (Google sign-in among them) turn away browsers they don't recognise.
 */
export function cleanUserAgent(): void {
  // Chrome's own reduced form: the major version only.
  const major = process.versions.chrome.split('.')[0]
  const platform = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'
  app.userAgentFallback = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}

/** Rules for every web contents the app ever creates, whoever creates it. */
export function hardenAll(): void {
  app.on('web-contents-created', (_e, wc) => {
    // No <webview> tags anywhere.
    wc.on('will-attach-webview', (e) => e.preventDefault())
  })
}

export function webSession(): Session {
  return session.fromPartition(WEB_PARTITION)
}
