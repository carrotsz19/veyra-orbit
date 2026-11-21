/*
 * The security baseline for web pages. Pages run in their own sandboxed renderers with no preload
 * and no Node, in a session kept apart from the browser's own UI. Permissions are denied unless
 * the person allows them for that site.
 */
import { app, session, shell, type Session, type WebContents } from 'electron'
import type { ExternalAppAsk, PermissionAsk, SitePermission } from '../shared/types'
import { ASKABLE_PERMISSIONS, normalizePermissionOrigin } from '../shared/permissions'
import { parseExternalAppUrl } from '../shared/external'
import { chromeIdentity } from './compat'

/** Where web pages keep cookies and storage. Workspaces will get one each (persist:ws-<id>). */
export const WEB_PARTITION = 'persist:web'

/** Harmless permissions a page gets without asking, as in Chrome. */
const ALWAYS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'])
/** Permissions the person can be asked for. Anything not listed is always denied. */
const ASKABLE = new Set<string>(ASKABLE_PERMISSIONS)

export interface PermissionStore {
  permissions(): SitePermission[]
  setPermission(origin: string, permission: string, allow: boolean): boolean
  removePermission(origin: string, permission: string): void
}

type Pending = PermissionAsk & { resolve: (allow: boolean) => void; isPrivate: boolean }

export class Permissions {
  private next = 1
  private pending: Pending[] = []
  /** Remembered answers by "origin|permission", persisted via store when available. */
  private answers = new Map<string, boolean>()

  constructor(
    private tabIdOf: (wc: WebContents) => number | null,
    private publish: (asks: PermissionAsk[]) => void,
    private store?: PermissionStore,
    private onSavedChanged: () => void = () => {},
    private isPrivateTab: (tabId: number | null) => boolean = () => false
  ) {
    if (store) {
      for (const row of store.permissions()) {
        if (ASKABLE.has(row.permission)) this.answers.set(`${row.origin}|${row.permission}`, row.allow)
      }
    }
  }

  attach(sess: Session): void {
    sess.setPermissionRequestHandler((wc, permission, callback, details) => {
      const origin = normalizePermissionOrigin(details.requestingUrl || wc.getURL())
      if (ALWAYS.has(permission)) return callback(true)
      if (!origin || !ASKABLE.has(permission)) return callback(false)
      const tabId = this.tabIdOf(wc)
      const isPrivate = this.isPrivateTab(tabId)
      const key = `${origin}|${permission}`
      if (!isPrivate) {
        const known = this.answers.get(key)
        if (known !== undefined) return callback(known)
      }
      // One question per site and permission; repeat requests wait on the same answer.
      const same = this.pending.find((p) => p.origin === origin && p.permission === permission && p.isPrivate === isPrivate)
      if (same) {
        const prev = same.resolve
        same.resolve = (allow) => (prev(allow), callback(allow))
        return
      }
      this.pending.push({ id: this.next++, tabId, origin, permission, resolve: callback, isPrivate })
      this.emit()
    })
    sess.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
      if (ALWAYS.has(permission)) return true
      if (wc && this.isPrivateTab(this.tabIdOf(wc))) return false
      return this.answers.get(`${normalizePermissionOrigin(requestingOrigin)}|${permission}`) === true
    })
    // USB, HID and serial devices: never, for now.
    sess.setDevicePermissionHandler(() => false)
  }

  answer(id: number, allow: boolean, remember = true): void {
    const i = this.pending.findIndex((p) => p.id === id)
    if (i < 0) return
    const [p] = this.pending.splice(i, 1)
    if (remember && !p.isPrivate) {
      this.answers.set(`${p.origin}|${p.permission}`, allow)
      if (this.store?.setPermission(p.origin, p.permission, allow)) this.onSavedChanged()
    }
    p.resolve(allow)
    this.emit()
  }

  listSaved(): SitePermission[] {
    return this.store?.permissions() ?? []
  }

  setSaved(origin: string, permission: string, allow: boolean): boolean {
    const norm = normalizePermissionOrigin(origin)
    if (!norm || !ASKABLE.has(permission)) return false
    if (this.store && !this.store.setPermission(norm, permission, allow)) return false
    this.answers.set(`${norm}|${permission}`, allow)
    // Resolve any open prompt for the same origin + permission so it doesn't stay stale.
    const matching = this.pending.filter((p) => p.origin === norm && p.permission === permission)
    if (matching.length) {
      this.pending = this.pending.filter((p) => !(p.origin === norm && p.permission === permission))
      for (const p of matching) p.resolve(allow)
      this.emit()
    }
    this.onSavedChanged()
    return true
  }

  removeSaved(origin: string, permission: string): void {
    const norm = normalizePermissionOrigin(origin)
    if (!norm) return
    this.store?.removePermission(norm, permission)
    this.answers.delete(`${norm}|${permission}`)
    this.onSavedChanged()
  }

  /** True when this tab currently has an unanswered permission prompt. */
  hasPendingPermission(tabId: number): boolean {
    return this.pending.some((p) => p.tabId === tabId)
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
    this.publish(this.pending.map(({ resolve: _r, isPrivate: _p, ...ask }) => ask))
  }
}

const MAX_EXTERNAL_ASKS_PER_TAB = 5

/**
 * Confirmation queue for allowlisted external-app links (mailto:, tel:, zoommtg:, msteams:, ...).
 * Nothing is handed to shell.openExternal until the person clicks Open.
 */
export class ExternalApps {
  private next = 1
  private pending: ExternalAppAsk[] = []

  constructor(
    private publish: (asks: ExternalAppAsk[]) => void,
    private openExternal: (url: string) => void = (url) => {
      void shell.openExternal(url)
    }
  ) {}

  list(): ExternalAppAsk[] {
    return this.pending.map((a) => ({ ...a }))
  }

  request(tabId: number | null, pageUrl: string, targetUrl: string): boolean {
    const parsed = parseExternalAppUrl(targetUrl)
    if (!parsed) return false
    // Deduplicate identical pending requests for the same tab and cap per-tab queue to prevent spam.
    if (this.pending.some((p) => p.tabId === tabId && p.url === parsed.url)) return true
    if (this.pending.filter((p) => p.tabId === tabId).length >= MAX_EXTERNAL_ASKS_PER_TAB) return true
    const origin = normalizePermissionOrigin(pageUrl)
    this.pending.push({
      id: this.next++,
      tabId,
      origin,
      scheme: parsed.scheme,
      appName: parsed.appName,
      url: parsed.url
    })
    this.emit()
    return true
  }

  answer(id: number, open: boolean): void {
    const i = this.pending.findIndex((p) => p.id === id)
    if (i < 0) return
    const [ask] = this.pending.splice(i, 1)
    this.emit()
    if (!open) return
    const parsed = parseExternalAppUrl(ask.url)
    if (parsed) this.openExternal(parsed.url)
  }

  dropTab(tabId: number): void {
    const before = this.pending.length
    this.pending = this.pending.filter((p) => p.tabId !== tabId)
    if (this.pending.length !== before) this.emit()
  }

  private emit(): void {
    this.publish(this.list())
  }
}

/**
 * Sites see a normal Chrome user agent, without "Electron/.." or the app's name in it.
 * Some sites (Google sign-in among them) turn away browsers they don't recognise.
 */
export function cleanUserAgent(): void {
  // Chrome's own reduced form, consistent with Client Hints in compat.ts.
  app.userAgentFallback = chromeIdentity().userAgent
}

/** Rules for every web contents the app ever creates, whoever creates it. */
export function hardenAll(): void {
  app.on('web-contents-created', (_e, wc) => {
    // No <webview> tags anywhere.
    wc.on('will-attach-webview', (e) => e.preventDefault())
  })
}

export function sessionForPartition(partition: string): Session {
  return session.fromPartition(partition)
}

export function webSession(): Session {
  return sessionForPartition(WEB_PARTITION)
}
