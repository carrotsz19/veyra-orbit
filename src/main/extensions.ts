/*
 * Chrome extension manager for Veyra Orbit (phase 1).
 *
 * Responsibilities:
 *  - Owns userData/extensions.json registry and userData/Extensions/ storage.
 *  - Generates and loads Orbit's hidden internal DNR compatibility extension
 *    (`orbit-compat`) into every active persistent web session (replacing
 *    session.webRequest.onBeforeSendHeaders so MV3 declarativeNetRequest works).
 *  - Never loads extensions into private (in-memory) workspaces or Orbit's UI session.
 *  - Lazy-loads extensions into isolated workspace sessions (`persist:ws-<id>`)
 *    only when those workspaces are first used.
 *  - Hardens electron-chrome-extensions (cookies permission + host check,
 *    strict tab/window URL allowlist, native messaging disabled, remote IPC off).
 *  - Provides hardened Chrome Web Store integration (exact origin equality,
 *    CRX3 RSA/ECDSA cryptographic signature verification, Zip-Slip protection,
 *    plain-English permission confirmation strip).
 *  - Drives Orbit's toolbar buttons and clamped, locked-down popup windows.
 */
import {
  BrowserWindow,
  Menu,
  app,
  ipcMain,
  nativeImage,
  screen,
  session,
  webContents,
  type IpcMainInvokeEvent,
  type MenuItem,
  type Session,
  type WebContents
} from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import AdmZip from 'adm-zip'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import {
  DEFAULT_EXTENSIONS_REGISTRY,
  canAccessCookiesForUrl,
  describeManifestPermissions,
  extractExtensionId,
  extractHostPermissions,
  filterCookiesByHostPermissions,
  hasManifestPermission,
  isAllowedWebStoreOrigin,
  isCookiePermittedByHostPermissions,
  isSafeZipEntryPath,
  isUrlPermittedByHostPermissions,
  resolveAllowedExtensionTabUrl,
  sanitizeExtensionsRegistry,
  shouldLoadExtensionsForPartition,
  validateExtensionId,
  type ExtensionActionView,
  type ExtensionInstallAsk,
  type ExtensionSummary,
  type ExtensionsRegistry,
  type ExtensionsState,
  type ManifestLike,
  type StoredExtensionEntry
} from '../shared/extensions'
import { parseAndVerifyCrx3 } from '../shared/crx3'
import { clampPopupBounds } from '../shared/menu'
import { isAllowedUrl } from '../shared/url'
import type { Rect } from '../shared/types'
import { buildOrbitCompatDnrRules, chromeIdentity, detachSessionCompat } from './compat'

// Internal structural shapes for electron-chrome-extensions@4.10.0 patching.
interface EceHandlerEntry {
  callback: (event: EceEvent, ...args: unknown[]) => unknown
  extensionContext: boolean
  allowRemote: boolean
  permission?: string
}

interface EceEvent {
  type: 'frame' | 'service-worker'
  sender: WebContents | Electron.ServiceWorkerMain
  extension?: Electron.Extension & { manifest: ManifestLike & Record<string, unknown> }
}

interface EcePopupView {
  extensionId: string
  browserWindow?: BrowserWindow
  parent?: Electron.BaseWindow
  destroy(): void
  isDestroyed(): boolean
  on(event: string, listener: (...args: unknown[]) => void): void
}

interface EceActionDetails {
  title?: string
  text?: string
  color?: string | number[]
  popup?: string
  icon?: { path?: string | Record<string, string>; imageData?: string | Record<string, string> }
  iconModified?: number
  tabs: Record<string, Omit<EceActionDetails, 'tabs'>>
}

interface EceInternal {
  ctx: {
    session: Session
    router: {
      handlers: Map<string, EceHandlerEntry>
      listeners: Map<string, { type: 'frame' | 'service-worker'; extensionId: string; host?: WebContents }[]>
      sendEvent(targetExtensionId: string | undefined, eventName: string, ...args: unknown[]): void
    }
    store: {
      tabs: Set<WebContents>
      tabToWindow: WeakMap<WebContents, Electron.BaseWindow>
      tabDetailsCache: Map<number, Record<string, unknown>>
      getTabById(tabId: number): WebContents | undefined
      getActiveTabOfCurrentWindow(): WebContents | undefined
      buildMenuItems(extensionId: string, menuType: string): MenuItem[]
    }
  }
  api: {
    browserAction: {
      actionMap: Map<string, EceActionDetails>
      popup?: EcePopupView
      onUpdate(): void
      getPopupUrl(extensionId: string, tabId: number): string | undefined
      activateClick(details: {
        eventType: 'click'
        extensionId: string
        tabId: number
        anchorRect: Rect
        alignment?: string
      }): void
    }
    cookies: {
      onChanged: (...args: unknown[]) => void
    }
  }
}

interface SessionExtState {
  partition: string
  session: Session
  ece: ElectronChromeExtensions
  compatExtId: string | null
  readyPromise: Promise<void>
  cookieChangedListener?: (
    event: Electron.Event,
    cookie: Electron.Cookie,
    cause: string,
    removed: boolean
  ) => void
}

interface PendingInstallAsk {
  ask: ExtensionInstallAsk
  resolve: (allow: boolean) => void
}

export interface ExtensionManagerHost {
  getWindow(): BrowserWindow | null
  activePartition(): string
  activeWebContents(): WebContents | null
  tabDetailsForWebContents(wc: WebContents): { pinned: boolean; index: number; discarded: boolean; active: boolean } | null
  createTabFromExtension(url: string, opts: { activate?: boolean; partition: string; ownerExtensionId?: string }): WebContents | null
  authorizeExtensionTabNavigation(wc: WebContents, extensionId: string): void
  activateTabByWebContents(wc: WebContents): void
  closeTabByWebContents(wc: WebContents): void
  openSettingsExtensions(): void
  onStateChanged(state: ExtensionsState): void
  onActionsChanged(actions: ExtensionActionView[]): void
  onInstallAsksChanged(asks: ExtensionInstallAsk[]): void
  onBeforeOpenPopup(): void
  onPopupOpenChange(open: boolean): void
  onPopupFocusChange(focused: boolean): void
}

const CWS_RESULT = {
  SUCCESS: 'success',
  USER_CANCELLED: 'user_cancelled',
  INSTALL_IN_PROGRESS: 'install_in_progress',
  INSTALL_ERROR: 'install_error',
  MANIFEST_ERROR: 'manifest_error',
  INVALID_ICON_URL: 'invalid_icon_url',
  ICON_ERROR: 'icon_error',
  BLOCKED_BY_POLICY: 'blocked_by_policy',
  UNKNOWN_ERROR: 'unknown_error'
} as const

const CWS_STATUS = {
  INSTALLABLE: 'installable',
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  DEPRECATED_MANIFEST_VERSION: 'deprecated_manifest_version'
} as const

const WEBSTORE_IPC_REGISTERED = Symbol('orbitWebstoreIpcRegistered')

function resolvePreloadFile(filename: string): string {
  const bundled = resolve(__dirname, '../preload', filename)
  if (existsSync(bundled)) return bundled
  const outFallback = resolve(process.cwd(), 'out/preload', filename)
  if (existsSync(outFallback)) return outFallback
  if (filename === 'chrome-extension-api.preload.js') {
    const mod = resolve(process.cwd(), 'node_modules/electron-chrome-extensions/dist', filename)
    if (existsSync(mod)) return mod
  }
  return bundled
}

function normalizeBadgeColor(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (Array.isArray(raw) && raw.length >= 3) {
    const [r, g, b, a] = raw.map((n) => Number(n) || 0)
    if (raw.length >= 4 && a < 255) {
      return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`
    }
    return `rgb(${r}, ${g}, ${b})`
  }
  return '#b3492b'
}

function pickManifestIconPath(manifest: Record<string, unknown>, preferAction = false): string | null {
  const action = (manifest.action ?? manifest.browser_action) as { default_icon?: unknown } | undefined
  const pickFromObj = (obj: unknown): string | null => {
    if (typeof obj === 'string') return obj
    if (!obj || typeof obj !== 'object') return null
    const entries = Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => ({ size: Number(k) || 0, path: v as string }))
      .sort((a, b) => a.size - b.size)
    if (!entries.length) return null
    const preferred = entries.find((e) => e.size >= 32) ?? entries[entries.length - 1]
    return preferred.path
  }
  if (preferAction) {
    const fromAction = pickFromObj(action?.default_icon)
    if (fromAction) return fromAction
  }
  const fromIcons = pickFromObj(manifest.icons)
  if (fromIcons) return fromIcons
  return pickFromObj(action?.default_icon)
}

function resolveFileInsideDir(baseDir: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes('\0')) return null
  const cleanRel = relativePath.replace(/^[/\\]+/, '')
  const root = resolve(baseDir)
  const target = resolve(root, cleanRel)
  if (target !== root && !target.startsWith(root + sep)) return null
  return existsSync(target) ? target : null
}

function fileToIconDataUrl(filePath: string | null): string | undefined {
  if (!filePath) return undefined
  try {
    const img = nativeImage.createFromPath(filePath)
    if (img.isEmpty()) return undefined
    const resized = img.getSize().width > 64 ? img.resize({ width: 48, height: 48 }) : img
    return resized.toDataURL()
  } catch {
    return undefined
  }
}

function readManifestFromDir(dirPath: string): (ManifestLike & Record<string, unknown>) | null {
  try {
    const raw = readFileSync(join(dirPath, 'manifest.json'), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as ManifestLike & Record<string, unknown>
  } catch {
    return null
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}

function findLatestStoreVersionDir(extensionsDir: string, extId: string): string | null {
  const root = join(extensionsDir, extId)
  if (!existsSync(root)) return null
  try {
    const entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())
    let best: { dir: string; version: string } | null = null
    for (const entry of entries) {
      const candidate = join(root, entry.name)
      const manifest = readManifestFromDir(candidate)
      if (!manifest || typeof manifest.version !== 'string') continue
      if (!best || compareVersions(manifest.version, best.version) > 0) {
        best = { dir: candidate, version: manifest.version }
      }
    }
    return best?.dir ?? null
  } catch {
    return null
  }
}

/**
 * Generates (or refreshes) Orbit's hidden built-in DNR compatibility extension on disk.
 * Uses a static MV3 declarativeNetRequest ruleset (zero background service worker overhead).
 */
function ensureOrbitCompatExtensionDir(userDataDir: string): string {
  const dir = join(userDataDir, 'internal-extensions', 'orbit-compat')
  mkdirSync(dir, { recursive: true })
  const id = chromeIdentity()
  const manifest = {
    manifest_version: 3,
    name: 'Veyra Orbit Compatibility',
    version: '1.0.0',
    description: 'Internal browser compatibility rules for Veyra Orbit.',
    permissions: ['declarativeNetRequest'],
    host_permissions: ['<all_urls>'],
    declarative_net_request: {
      rule_resources: [
        {
          id: 'orbit_compat',
          enabled: true,
          path: 'rules.json'
        }
      ]
    }
  }
  const rules = buildOrbitCompatDnrRules(id)
  const manifestStr = JSON.stringify(manifest, null, 2) + '\n'
  const rulesStr = JSON.stringify(rules, null, 2) + '\n'
  const manifestPath = join(dir, 'manifest.json')
  const rulesPath = join(dir, 'rules.json')
  if (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== manifestStr) {
    writeFileSync(manifestPath, manifestStr, 'utf8')
  }
  if (!existsSync(rulesPath) || readFileSync(rulesPath, 'utf8') !== rulesStr) {
    writeFileSync(rulesPath, rulesStr, 'utf8')
  }
  return dir
}

// Session -> ExtensionManager lookup for the global hardened Chrome Web Store IPC handlers.
const webStoreManagers = new WeakMap<Session, ExtensionManager>()

function ensureHardenedWebStoreIpc(): void {
  const marker = ipcMain as unknown as Record<symbol, boolean>
  if (marker[WEBSTORE_IPC_REGISTERED]) return
  marker[WEBSTORE_IPC_REGISTERED] = true

  const register = (channel: string, handler: (mgr: ExtensionManager, event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      // Security Fix (d): STRICT exact origin check for https://chromewebstore.google.com.
      if (!isAllowedWebStoreOrigin(event.senderFrame?.origin)) {
        return undefined
      }
      const mgr = webStoreManagers.get(event.sender.session)
      if (!mgr) return undefined
      return handler(mgr, event, ...args)
    })
  }

  register('orbitWebstore.beginInstall', (mgr, event, rawDetails) => mgr.handleWebStoreBeginInstall(event, rawDetails))
  register('orbitWebstore.completeInstall', () => CWS_RESULT.SUCCESS)
  register('orbitWebstore.enableAppLauncher', () => true)
  register('orbitWebstore.getBrowserLogin', () => '')
  register('orbitWebstore.getExtensionStatus', (mgr, _event, id, manifestJson) =>
    mgr.handleWebStoreGetStatus(id, manifestJson)
  )
  register('orbitWebstore.getFullChromeVersion', () => ({
    version_number: process.versions.chrome,
    app_name: app.getName()
  }))
  register('orbitWebstore.getIsLauncherEnabled', () => true)
  register('orbitWebstore.getMV2DeprecationStatus', () => 'soft_disable')
  register('orbitWebstore.getReferrerChain', () => 'EgIIAA==')
  register('orbitWebstore.getStoreLogin', () => '')
  register('orbitWebstore.getWebGLStatus', async () => {
    try {
      await app.getGPUInfo('basic')
      const features = app.getGPUFeatureStatus()
      return features.webgl?.startsWith('enabled') ? 'webgl_allowed' : 'webgl_blocked'
    } catch {
      return 'webgl_allowed'
    }
  })
  register('orbitWebstore.install', () => CWS_RESULT.SUCCESS)
  register('orbitWebstore.isInIncognitoMode', () => false)
  register('orbitWebstore.isPendingCustodianApproval', () => false)
  register('orbitWebstore.setStoreLogin', () => true)

  register('orbitManagement.getAll', (mgr) => mgr.handleWebStoreManagementGetAll())
  register('orbitManagement.setEnabled', async (mgr, _event, id, enabled) => {
    if (typeof id !== 'string') return false
    return mgr.setEnabled(id, enabled === true)
  })
  register('orbitManagement.uninstall', async (mgr, event, id) => {
    if (typeof id !== 'string') return CWS_RESULT.UNKNOWN_ERROR
    const ok = await mgr.uninstall(id)
    if (ok && !event.sender.isDestroyed()) {
      queueMicrotask(() => {
        if (!event.sender.isDestroyed()) event.sender.send('orbitManagement.onUninstalled', id)
      })
      return CWS_RESULT.SUCCESS
    }
    return CWS_RESULT.UNKNOWN_ERROR
  })
}

export class ExtensionManager {
  private readonly registryFile: string
  private readonly extensionsDir: string
  private readonly compatDir: string
  private registry: ExtensionsRegistry
  private sessions = new Map<string, SessionExtState>()
  private sessionByRef = new Map<Session, SessionExtState>()
  private compatExtIds = new Set<string>()
  private installingIds = new Set<string>()
  private pendingAsks: PendingInstallAsk[] = []
  private iconCache = new Map<string, string>()
  private activePopupWin: BrowserWindow | null = null
  private activePopupExtId: string | null = null
  private activePopupCleanup: (() => void) | null = null
  private lastAnchorRectCss: Rect | null = null
  private actionsTimer: NodeJS.Timeout | null = null
  private stateTimer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(private readonly host: ExtensionManagerHost, userDataDir = app.getPath('userData')) {
    this.registryFile = join(userDataDir, 'extensions.json')
    this.extensionsDir = join(userDataDir, 'Extensions')
    this.compatDir = ensureOrbitCompatExtensionDir(userDataDir)
    this.registry = this.loadRegistry()
    ensureHardenedWebStoreIpc()
  }

  private loadRegistry(): ExtensionsRegistry {
    try {
      const raw = JSON.parse(readFileSync(this.registryFile, 'utf8')) as unknown
      return sanitizeExtensionsRegistry(raw)
    } catch {
      return { ...DEFAULT_EXTENSIONS_REGISTRY, extensions: [] }
    }
  }

  private saveRegistry(): void {
    try {
      mkdirSync(dirname(this.registryFile), { recursive: true })
      writeFileSync(this.registryFile, JSON.stringify(this.registry, null, 2) + '\n', 'utf8')
    } catch {
      /* non-fatal */
    }
  }

  isCompatExtension(id: string): boolean {
    return this.compatExtIds.has(id)
  }

  isPopupFocused(): boolean {
    return !!(this.activePopupWin && !this.activePopupWin.isDestroyed() && this.activePopupWin.isFocused())
  }

  closePopup(): void {
    const cleanup = this.activePopupCleanup
    this.activePopupCleanup = null
    if (cleanup) cleanup()
    const pw = this.activePopupWin
    this.activePopupWin = null
    this.activePopupExtId = null
    if (pw && !pw.isDestroyed()) pw.destroy()
  }

  /**
   * Attaches extension support + Orbit's internal DNR compat extension to a persistent
   * web session (`persist:web` or isolated `persist:ws-<id>`).
   * Strictly refuses private/non-persistent sessions and session.defaultSession.
   */
  attachSession(partition: string, sess: Session): Promise<void> {
    if (!shouldLoadExtensionsForPartition(partition) || sess === session.defaultSession) {
      return Promise.resolve()
    }
    const existing = this.sessions.get(partition)
    if (existing) return existing.readyPromise

    // Ensure session.webRequest.onBeforeSendHeaders is NOT attached (it disables DNR!).
    detachSessionCompat(sess)

    const ecePreload = resolvePreloadFile('chrome-extension-api.preload.js')
    const compatPreload = resolvePreloadFile('ext-compat.js')
    const webstorePreload = resolvePreloadFile('webstore.js')

    const ece = new ElectronChromeExtensions({
      session: sess,
      createTab: async (details) => {
        const win = this.host.getWindow()
        if (!win || win.isDestroyed()) throw new Error('No browser window available')
        const url = typeof details.url === 'string' ? details.url : ''
        // Defense-in-depth URL check (primary per-extension check runs in the wrapped tabs.create handler).
        if (url && !isAllowedUrl(url) && !url.startsWith('chrome-extension://')) {
          throw new Error('URL is not allowed')
        }
        const ownerExtId = url.startsWith('chrome-extension://') ? new URL(url).hostname : undefined
        if (ownerExtId && (!validateExtensionId(ownerExtId) || !sess.extensions.getExtension(ownerExtId) || this.isCompatExtension(ownerExtId))) {
          throw new Error('Extension URL is not allowed')
        }
        const wc = this.host.createTabFromExtension(url, {
          activate: details.active !== false,
          partition,
          ownerExtensionId: ownerExtId
        })
        if (!wc) throw new Error('Failed to create tab')
        return [wc, win]
      },
      selectTab: (tab) => {
        this.host.activateTabByWebContents(tab)
      },
      removeTab: (tab) => {
        this.host.closeTabByWebContents(tab)
      },
      assignTabDetails: (details, tab) => {
        const info = this.host.tabDetailsForWebContents(tab)
        if (info) {
          details.pinned = info.pinned
          details.index = info.index
          details.discarded = info.discarded
          details.active = info.active
        }
      },
      createWindow: async (details) => {
        const win = this.host.getWindow()
        if (!win || win.isDestroyed()) throw new Error('No browser window available')
        const rawUrls = details?.url ? (Array.isArray(details.url) ? details.url : [details.url]) : []
        for (const u of rawUrls) {
          if (typeof u !== 'string') continue
          if (!isAllowedUrl(u) && !u.startsWith('chrome-extension://')) {
            throw new Error('URL is not allowed')
          }
          const ownerExtId = u.startsWith('chrome-extension://') ? new URL(u).hostname : undefined
          if (ownerExtId && (!validateExtensionId(ownerExtId) || !sess.extensions.getExtension(ownerExtId) || this.isCompatExtension(ownerExtId))) {
            throw new Error('Extension URL is not allowed')
          }
          this.host.createTabFromExtension(u, {
            activate: true,
            partition,
            ownerExtensionId: ownerExtId
          })
        }
        return win
      },
      removeWindow: () => {
        /* Extensions cannot close Orbit's main browser window */
      },
      requestPermissions: async () => false
    })

    // Ensure the bundled chrome-extension-api preload, then Orbit's browser<-chrome mirror, then hardened Web Store preload are registered in order.
    if (typeof sess.registerPreloadScript === 'function') {
      const registerOrReplace = (id: string, type: 'frame' | 'service-worker', filePath: string): void => {
        if (!existsSync(filePath)) return
        try {
          sess.unregisterPreloadScript(id)
        } catch {
          /* not yet registered */
        }
        sess.registerPreloadScript({ id, type, filePath })
      }
      registerOrReplace('crx-mv2-preload', 'frame', ecePreload)
      registerOrReplace('crx-mv3-preload', 'service-worker', ecePreload)
      registerOrReplace('orbit-ext-compat-frame', 'frame', compatPreload)
      registerOrReplace('orbit-ext-compat-sw', 'service-worker', compatPreload)
      registerOrReplace('orbit-webstore-frame', 'frame', webstorePreload)
    }

    webStoreManagers.set(sess, this)

    const st: SessionExtState = {
      partition,
      session: sess,
      ece,
      compatExtId: null,
      readyPromise: Promise.resolve()
    }
    this.sessions.set(partition, st)
    this.sessionByRef.set(sess, st)

    this.hardenEceSession(st)

    ece.on('browser-action-popup-created', (popup: EcePopupView) => {
      this.wirePopupView(popup, partition)
    })

    const internal = ece as unknown as EceInternal
    const origOnUpdate = internal.api.browserAction.onUpdate.bind(internal.api.browserAction)
    internal.api.browserAction.onUpdate = () => {
      origOnUpdate()
      this.scheduleActionsBroadcast()
    }

    st.readyPromise = this.initializeSessionExtensions(st)
    return st.readyPromise
  }

  /** Waits until orbit-compat DNR rules (and initial extensions) are loaded for a partition. */
  async whenSessionReady(partition: string): Promise<void> {
    const st = this.sessions.get(partition)
    if (st) await st.readyPromise
  }

  private hardenEceSession(st: SessionExtState): void {
    const internal = st.ece as unknown as EceInternal
    const handlers = internal.ctx.router.handlers

    // Security Fix (a): Require 'cookies' permission AND matching host permissions on all cookies.* APIs.
    const cookieMethods = ['cookies.get', 'cookies.getAll', 'cookies.set', 'cookies.remove', 'cookies.getAllCookieStores']
    for (const method of cookieMethods) {
      const entry = handlers.get(method)
      if (!entry) continue
      entry.permission = 'cookies'
      const orig = entry.callback
      entry.callback = async (event, ...args) => {
        const manifest = event.extension?.manifest
        if (!hasManifestPermission(manifest, 'cookies')) {
          throw new Error(`${method} requires the cookies permission`)
        }
        const hostPerms = extractHostPermissions(manifest)
        if (method === 'cookies.getAllCookieStores') {
          return orig(event, ...args)
        }
        const details = (args[0] ?? {}) as { url?: unknown }
        if (method === 'cookies.getAll') {
          if (hostPerms.length === 0) return []
          if (typeof details.url === 'string' && details.url && !isUrlPermittedByHostPermissions(details.url, hostPerms)) {
            return []
          }
          const raw = (await orig(event, ...args)) as Electron.Cookie[]
          return Array.isArray(raw) ? filterCookiesByHostPermissions(raw, hostPerms) : []
        }
        if (!canAccessCookiesForUrl(manifest, typeof details.url === 'string' ? details.url : '')) {
          throw new Error(`No host permissions for cookie URL in ${method}`)
        }
        return orig(event, ...args)
      }
    }

    // Also replace cookies.onChanged broadcast so only extensions with 'cookies' + matching host permissions receive changes.
    if (internal.api.cookies?.onChanged) {
      st.session.cookies.off('changed', internal.api.cookies.onChanged as (...args: unknown[]) => void)
      const filteredOnChanged = (_event: Electron.Event, cookie: Electron.Cookie, cause: string, removed: boolean): void => {
        const listeners = internal.ctx.router.listeners.get('cookies.onChanged')
        if (!listeners || listeners.length === 0) return
        const normalizedCause = cause === 'expired-overwrite' ? 'expired_overwrite' : cause
        const changeInfo = {
          cause: normalizedCause,
          cookie: {
            ...cookie,
            domain: cookie.domain || '',
            hostOnly: Boolean(cookie.hostOnly),
            session: Boolean(cookie.session),
            path: cookie.path || '',
            httpOnly: Boolean(cookie.httpOnly),
            secure: Boolean(cookie.secure),
            storeId: '0'
          },
          removed
        }
        const seenExt = new Set<string>()
        for (const listener of listeners) {
          if (seenExt.has(listener.extensionId)) continue
          seenExt.add(listener.extensionId)
          const ext = st.session.extensions.getExtension(listener.extensionId)
          if (!ext || this.isCompatExtension(ext.id)) continue
          const manifest = ext.manifest as ManifestLike
          if (!hasManifestPermission(manifest, 'cookies')) continue
          const hostPerms = extractHostPermissions(manifest)
          if (!isCookiePermittedByHostPermissions(cookie, hostPerms)) continue
          internal.ctx.router.sendEvent(ext.id, 'cookies.onChanged', changeInfo)
        }
      }
      st.cookieChangedListener = filteredOnChanged
      st.session.cookies.on('changed', filteredOnChanged)
    }

    // Security Fix (b): Enforce Orbit's strict URL allowlist (http(s) + caller's own chrome-extension://) on tabs.create, tabs.update, windows.create.
    const tabsCreate = handlers.get('tabs.create')
    if (tabsCreate) {
      const orig = tabsCreate.callback
      tabsCreate.callback = async (event, rawDetails) => {
        const extId = event.extension?.id ?? ''
        const details = (rawDetails && typeof rawDetails === 'object' ? { ...(rawDetails as Record<string, unknown>) } : {}) as Record<string, unknown>
        if (details.url !== undefined && details.url !== '') {
          const resolved = resolveAllowedExtensionTabUrl(details.url, extId)
          if (!resolved) throw new Error('URL is not allowed')
          details.url = resolved
        }
        return orig(event, details)
      }
    }

    const tabsUpdate = handlers.get('tabs.update')
    if (tabsUpdate) {
      const orig = tabsUpdate.callback
      tabsUpdate.callback = async (event, arg1, arg2) => {
        const extId = event.extension?.id ?? ''
        const hasId = typeof arg1 === 'number'
        const rawProps = (hasId ? arg2 : arg1) as Record<string, unknown> | undefined
        const props = rawProps && typeof rawProps === 'object' ? { ...rawProps } : {}
        if (props.url !== undefined && props.url !== '') {
          const resolved = resolveAllowedExtensionTabUrl(props.url, extId)
          if (!resolved) throw new Error('URL is not allowed')
          props.url = resolved
          if (resolved.startsWith(`chrome-extension://${extId}/`)) {
            const targetWc = hasId
              ? internal.ctx.store.getTabById(arg1 as number)
              : internal.ctx.store.getActiveTabOfCurrentWindow()
            if (targetWc && !targetWc.isDestroyed()) {
              this.host.authorizeExtensionTabNavigation(targetWc, extId)
            }
          }
        }
        return hasId ? orig(event, arg1, props) : orig(event, props)
      }
    }

    const windowsCreate = handlers.get('windows.create')
    if (windowsCreate) {
      const orig = windowsCreate.callback
      windowsCreate.callback = async (event, rawDetails) => {
        const extId = event.extension?.id ?? ''
        const details = (rawDetails && typeof rawDetails === 'object' ? { ...(rawDetails as Record<string, unknown>) } : {}) as Record<string, unknown>
        if (details.url !== undefined) {
          const list = Array.isArray(details.url) ? details.url : [details.url]
          const resolvedList: string[] = []
          for (const item of list) {
            const resolved = resolveAllowedExtensionTabUrl(item, extId)
            if (!resolved) throw new Error('URL is not allowed')
            resolvedList.push(resolved)
          }
          details.url = Array.isArray(details.url) ? resolvedList : resolvedList[0]
        }
        return orig(event, details)
      }
    }

    // Security Fix (c): Disable Native Messaging unconditionally.
    for (const nativeMethod of ['runtime.connectNative', 'runtime.disconnectNative', 'runtime.sendNativeMessage']) {
      const entry = handlers.get(nativeMethod)
      if (entry) {
        entry.callback = () => {
          throw new Error('Native messaging is disabled in Veyra Orbit')
        }
      }
    }

    // Close remote IPC surface (`crx-msg-remote`) since Orbit drives toolbar buttons via its own fromUiSurface IPC.
    for (const remoteMethod of [
      'browserAction.getState',
      'browserAction.activate',
      'browserAction.addObserver',
      'browserAction.removeObserver'
    ]) {
      const entry = handlers.get(remoteMethod)
      if (entry) {
        entry.allowRemote = false
        entry.extensionContext = true
      }
    }
  }

  private async initializeSessionExtensions(st: SessionExtState): Promise<void> {
    // 1. Always load Orbit's hidden internal DNR compatibility extension first.
    try {
      const compatExt = await st.session.extensions.loadExtension(this.compatDir, { allowFileAccess: false })
      st.compatExtId = compatExt.id
      this.compatExtIds.add(compatExt.id)
    } catch (err) {
      console.error('[extensions] Failed to load orbit-compat DNR extension:', err)
    }

    // 2. Load enabled user extensions into this session.
    for (const entry of this.registry.extensions) {
      if (!entry.enabled) continue
      if (entry.source === 'unpacked' && !this.registry.developerMode) continue
      await this.loadEntryIntoSession(entry, st)
    }

    this.scheduleStateBroadcast()
    this.scheduleActionsBroadcast()
  }

  private resolveEntryDir(entry: StoredExtensionEntry): string | null {
    if (entry.source === 'unpacked') {
      return entry.unpackedPath && existsSync(join(entry.unpackedPath, 'manifest.json')) ? entry.unpackedPath : null
    }
    return findLatestStoreVersionDir(this.extensionsDir, entry.id)
  }

  private async loadEntryIntoSession(entry: StoredExtensionEntry, st: SessionExtState): Promise<Electron.Extension | null> {
    if (this.isCompatExtension(entry.id)) return null
    const existing = st.session.extensions.getExtension(entry.id)
    if (existing) return existing
    const dir = this.resolveEntryDir(entry)
    if (!dir) return null
    try {
      const loaded = await st.session.extensions.loadExtension(dir, { allowFileAccess: false })
      const manifest = loaded.manifest as ManifestLike
      if (typeof manifest.name === 'string' && manifest.name) entry.name = manifest.name
      if (typeof manifest.version === 'string' && manifest.version) entry.version = manifest.version
      if (typeof manifest.description === 'string') entry.description = manifest.description
      void this.ensureWorkerRunning(st, loaded)
      return loaded
    } catch (err) {
      console.error(`[extensions] Failed to load ${entry.id} into ${st.partition}:`, err)
      return null
    }
  }

  /**
   * An MV3 extension loaded while Orbit is running (installed, re-enabled, loaded unpacked) doesn't
   * always get its background service worker started, so nothing it does (ad-block rules included)
   * works until Orbit restarts. Give Electron a moment to start it, then start it ourselves.
   * Calling startWorkerForScope straight after loadExtension is too early, hence the wait.
   */
  private async ensureWorkerRunning(st: SessionExtState, ext: Electron.Extension): Promise<void> {
    const bg = (ext.manifest as { background?: { service_worker?: unknown } }).background
    if (!bg || typeof bg.service_worker !== 'string') return
    const scope = `chrome-extension://${ext.id}/`
    const running = (): boolean => {
      try {
        return Object.values(st.session.serviceWorkers.getAllRunning()).some((w) => w.scope === scope)
      } catch {
        return false
      }
    }
    for (const delay of [400, 1000, 2500]) {
      await new Promise((r) => setTimeout(r, delay))
      if (!st.session.extensions.getExtension(ext.id)) return // removed meanwhile
      if (running()) return
      try {
        await st.session.serviceWorkers.startWorkerForScope(scope)
        return
      } catch {
        /* not registered yet: try again after the next wait */
      }
    }
    console.error(`[extensions] ${ext.id}: background worker didn't start in ${st.partition}`)
  }

  // ---- Tab lifecycle notifications from Tabs --------------------------------

  addTab(partition: string, wc: WebContents, win: BrowserWindow): void {
    const st = this.sessions.get(partition)
    if (!st || wc.isDestroyed() || win.isDestroyed()) return
    if (wc.session !== st.session) return
    try {
      st.ece.addTab(wc, win)
    } catch {
      /* ignore if already tracked */
    }
  }

  removeTab(partition: string, wc: WebContents): void {
    const st = this.sessions.get(partition)
    if (!st) return
    try {
      st.ece.removeTab(wc)
    } catch {
      /* ignore */
    }
  }

  selectTab(partition: string, wc: WebContents | null): void {
    const st = this.sessions.get(partition)
    if (st && wc && !wc.isDestroyed() && wc.session === st.session) {
      try {
        st.ece.selectTab(wc)
      } catch {
        /* ignore */
      }
    }
    this.scheduleActionsBroadcast()
  }

  getContextMenuItems(wc: WebContents, params: Electron.ContextMenuParams): MenuItem[] {
    const st = this.sessionByRef.get(wc.session)
    if (!st) return []
    try {
      return st.ece.getContextMenuItems(wc, params)
    } catch {
      return []
    }
  }

  /**
   * Used by Permissions (security.ts) to allow clipboard-read / notifications
   * inside loaded chrome-extension://<id> pages ONLY when declared in manifest.
   */
  isExtensionPermissionAllowed(sess: Session, url: string, permission: string): boolean {
    if (permission !== 'clipboard-read' && permission !== 'notifications') return false
    try {
      const u = new URL(url)
      if (u.protocol !== 'chrome-extension:') return false
      const extId = u.hostname
      if (!validateExtensionId(extId) || this.isCompatExtension(extId)) return false
      const ext = sess.extensions.getExtension(extId)
      if (!ext) return false
      const manifest = ext.manifest as ManifestLike
      const needed = permission === 'clipboard-read' ? 'clipboardRead' : 'notifications'
      return hasManifestPermission(manifest, needed)
    } catch {
      return false
    }
  }

  hasLoadedExtension(partition: string, extensionId: string): boolean {
    if (!validateExtensionId(extensionId) || this.isCompatExtension(extensionId)) return false
    const st = this.sessions.get(partition)
    if (!st) return false
    return !!st.session.extensions.getExtension(extensionId)
  }

  // ---- Memory reporting -----------------------------------------------------

  private collectMemoryByExtension(): Map<string, number> {
    const pidsByExt = new Map<string, Set<number>>()
    const addPid = (extId: string, pid: number): void => {
      if (!pid || this.isCompatExtension(extId)) return
      let set = pidsByExt.get(extId)
      if (!set) {
        set = new Set<number>()
        pidsByExt.set(extId, set)
      }
      set.add(pid)
    }

    // 1. Running extension frames (popups, options pages, background pages) expose exact OS PID.
    const rphToOsPid = new Map<number, number>()
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed()) continue
      const osPid = wc.getOSProcessId()
      const rphId = wc.getProcessId()
      if (rphId && osPid) rphToOsPid.set(rphId, osPid)
      const url = wc.getURL()
      if (url.startsWith('chrome-extension://')) {
        try {
          const extId = new URL(url).hostname
          if (validateExtensionId(extId)) addPid(extId, osPid)
        } catch {
          /* ignore */
        }
      }
    }

    // 2. Running MV3 service workers per session.
    const metrics = app.getAppMetrics()
    const metricByPid = new Map<number, Electron.ProcessMetric>()
    for (const m of metrics) metricByPid.set(m.pid, m)

    const swByRph = new Map<number, string>()
    for (const st of this.sessions.values()) {
      try {
        const running = st.session.serviceWorkers.getAllRunning()
        for (const info of Object.values(running)) {
          if (!info.scope?.startsWith('chrome-extension://')) continue
          const extId = new URL(info.scope).hostname
          if (!validateExtensionId(extId) || this.isCompatExtension(extId)) continue
          const mappedOsPid = rphToOsPid.get(info.renderProcessId)
          if (mappedOsPid) {
            addPid(extId, mappedOsPid)
          } else if (metricByPid.has(info.renderProcessId)) {
            addPid(extId, info.renderProcessId)
          } else {
            swByRph.set(info.renderProcessId, extId)
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Fallback for MV3 SWs whose renderProcessId is a Chromium RPH ID rather than OS PID:
    // attribute unmatched renderer processes (those not owned by any WebContents) evenly or by order.
    if (swByRph.size > 0) {
      const knownWebContentsPids = new Set<number>()
      for (const wc of webContents.getAllWebContents()) {
        if (!wc.isDestroyed()) knownWebContentsPids.add(wc.getOSProcessId())
      }
      const unmatchedRenderers = metrics.filter(
        (m) => m.type === 'Tab' && !knownWebContentsPids.has(m.pid)
      )
      const swExtIds = [...new Set(swByRph.values())]
      if (swExtIds.length === 1 && unmatchedRenderers.length === 1) {
        addPid(swExtIds[0], unmatchedRenderers[0].pid)
      } else if (unmatchedRenderers.length > 0 && swExtIds.length > 0) {
        for (let i = 0; i < swExtIds.length && i < unmatchedRenderers.length; i++) {
          addPid(swExtIds[i], unmatchedRenderers[i].pid)
        }
      }
    }

    const mbByExt = new Map<string, number>()
    for (const [extId, pids] of pidsByExt) {
      let totalKb = 0
      for (const pid of pids) {
        const m = metricByPid.get(pid)
        if (!m) continue
        totalKb += m.memory.privateBytes ?? m.memory.workingSetSize ?? 0
      }
      if (totalKb > 0) {
        mbByExt.set(extId, Math.round((totalKb / 1024) * 10) / 10)
      }
    }
    return mbByExt
  }

  // ---- State & Toolbar Views ------------------------------------------------

  private iconForExtension(extId: string, dirPath: string | null, manifest: Record<string, unknown>, preferAction = false): string | undefined {
    const iconRel = pickManifestIconPath(manifest, preferAction)
    if (!dirPath || !iconRel) return undefined
    const abs = resolveFileInsideDir(dirPath, iconRel)
    if (!abs) return undefined
    const key = `${extId}:${abs}`
    const cached = this.iconCache.get(key)
    if (cached) return cached
    const dataUrl = fileToIconDataUrl(abs)
    if (dataUrl) this.iconCache.set(key, dataUrl)
    return dataUrl
  }

  private actionIconDataUrl(ext: Electron.Extension, action: EceActionDetails | undefined, activeWcId: number | null): string | undefined {
    const tabIcon = activeWcId !== null ? action?.tabs?.[String(activeWcId)]?.icon : undefined
    const icon = tabIcon ?? action?.icon
    if (icon) {
      if (typeof icon.imageData === 'string' && icon.imageData.startsWith('data:')) return icon.imageData
      if (icon.imageData && typeof icon.imageData === 'object') {
        const vals = Object.values(icon.imageData)
        const picked = vals[vals.length - 1]
        if (typeof picked === 'string' && picked.startsWith('data:')) return picked
      }
      if (typeof icon.path === 'string') {
        const abs = resolveFileInsideDir(ext.path, icon.path)
        if (abs) {
          const cacheKey = `${ext.id}:act:${abs}`
          const hit = this.iconCache.get(cacheKey)
          if (hit) return hit
          const url = fileToIconDataUrl(abs)
          if (url) {
            this.iconCache.set(cacheKey, url)
            return url
          }
        }
      } else if (icon.path && typeof icon.path === 'object') {
        const entries = Object.entries(icon.path)
          .map(([k, v]) => ({ size: Number(k) || 0, p: v }))
          .sort((a, b) => a.size - b.size)
        const chosen = entries.find((e) => e.size >= 32) ?? entries[entries.length - 1]
        if (chosen) {
          const abs = resolveFileInsideDir(ext.path, chosen.p)
          if (abs) {
            const cacheKey = `${ext.id}:act:${abs}`
            const hit = this.iconCache.get(cacheKey)
            if (hit) return hit
            const url = fileToIconDataUrl(abs)
            if (url) {
              this.iconCache.set(cacheKey, url)
              return url
            }
          }
        }
      }
    }
    return this.iconForExtension(ext.id, ext.path, ext.manifest as Record<string, unknown>, true)
  }

  getState(): ExtensionsState {
    const memMap = this.collectMemoryByExtension()
    const primarySession = this.sessions.get('persist:web') ?? [...this.sessions.values()][0]
    const list: ExtensionSummary[] = []

    for (const entry of this.registry.extensions) {
      if (this.isCompatExtension(entry.id)) continue
      const loaded = primarySession?.session.extensions.getExtension(entry.id)
      const dir = loaded?.path ?? this.resolveEntryDir(entry)
      const manifest = (loaded?.manifest as (ManifestLike & Record<string, unknown>) | undefined) ?? (dir ? readManifestFromDir(dir) : null)
      const name = (typeof manifest?.name === 'string' && !manifest.name.startsWith('__MSG_') ? manifest.name : loaded?.name) || entry.name || entry.id
      const version = (typeof manifest?.version === 'string' ? manifest.version : loaded?.version) || entry.version || ''
      const description =
        (typeof manifest?.description === 'string' && !manifest.description.startsWith('__MSG_') ? manifest.description : '') ||
        entry.description ||
        ''
      const rawPermissions = Array.isArray(manifest?.permissions)
        ? manifest.permissions.filter((p): p is string => typeof p === 'string')
        : []
      const hostPermissions = extractHostPermissions(manifest)
      const optionsPage =
        typeof manifest?.options_page === 'string'
          ? manifest.options_page
          : manifest?.options_ui && typeof (manifest.options_ui as { page?: unknown }).page === 'string'
            ? ((manifest.options_ui as { page: string }).page)
            : undefined
      const optionsUrl = optionsPage ? `chrome-extension://${entry.id}/${optionsPage.replace(/^\/+/, '')}` : undefined
      const iconDataUrl = manifest ? this.iconForExtension(entry.id, dir, manifest, false) : undefined
      const effectiveEnabled = entry.enabled && (entry.source !== 'unpacked' || this.registry.developerMode)

      list.push({
        id: entry.id,
        name,
        version,
        description,
        enabled: effectiveEnabled,
        pinned: entry.pinned,
        source: entry.source,
        ...(entry.unpackedPath ? { unpackedPath: entry.unpackedPath } : {}),
        permissions: describeManifestPermissions(manifest),
        rawPermissions,
        hostPermissions,
        ...(optionsUrl ? { optionsUrl } : {}),
        ...(iconDataUrl ? { iconDataUrl } : {}),
        memoryMB: effectiveEnabled ? (memMap.get(entry.id) ?? null) : null,
        ...(!dir ? { error: 'Extension files not found on disk.' } : {})
      })
    }

    return {
      extensions: list,
      developerMode: this.registry.developerMode
    }
  }

  getToolbarActions(): ExtensionActionView[] {
    const activePartition = this.host.activePartition()
    // Private workspaces NEVER have extensions.
    if (!shouldLoadExtensionsForPartition(activePartition)) return []
    const st = this.sessions.get(activePartition) ?? this.sessions.get('persist:web')
    if (!st) return []

    const internal = st.ece as unknown as EceInternal
    const activeWc = this.host.activeWebContents()
    const activeWcId = activeWc && !activeWc.isDestroyed() && activeWc.session === st.session ? activeWc.id : null

    const actions: ExtensionActionView[] = []
    for (const entry of this.registry.extensions) {
      if (!entry.enabled || this.isCompatExtension(entry.id)) continue
      if (entry.source === 'unpacked' && !this.registry.developerMode) continue
      const ext = st.session.extensions.getExtension(entry.id)
      if (!ext) continue
      const action = internal.api.browserAction.actionMap.get(ext.id)
      const tabAction = activeWcId !== null ? action?.tabs?.[String(activeWcId)] : undefined
      const title = tabAction?.title ?? action?.title ?? ext.name
      const badgeText = String(tabAction?.text ?? action?.text ?? '')
      const badgeColor = normalizeBadgeColor(tabAction?.color ?? action?.color)
      const popup = tabAction?.popup ?? action?.popup
      const iconDataUrl = this.actionIconDataUrl(ext, action, activeWcId)

      actions.push({
        id: ext.id,
        name: ext.name,
        title: title || ext.name,
        badgeText,
        badgeColor,
        ...(iconDataUrl ? { iconDataUrl } : {}),
        hasPopup: Boolean(popup),
        pinned: entry.pinned
      })
    }
    return actions
  }

  private scheduleStateBroadcast(): void {
    if (this.disposed || this.stateTimer) return
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null
      if (!this.disposed) this.host.onStateChanged(this.getState())
    }, 30)
  }

  private scheduleActionsBroadcast(): void {
    if (this.disposed || this.actionsTimer) return
    this.actionsTimer = setTimeout(() => {
      this.actionsTimer = null
      if (!this.disposed) this.host.onActionsChanged(this.getToolbarActions())
    }, 30)
  }

  // ---- Toolbar action click, popup clamping & lockdown ----------------------

  activateAction(extensionId: string, anchorRectCss: Rect): void {
    if (!validateExtensionId(extensionId) || this.isCompatExtension(extensionId)) return
    const activePartition = this.host.activePartition()
    if (!shouldLoadExtensionsForPartition(activePartition)) return
    const st = this.sessions.get(activePartition) ?? this.sessions.get('persist:web')
    if (!st) return

    // Toggle closed if clicking the same extension button while its popup is open.
    if (this.activePopupWin && !this.activePopupWin.isDestroyed() && this.activePopupExtId === extensionId) {
      this.closePopup()
      return
    }
    this.closePopup()
    this.host.onBeforeOpenPopup()
    this.lastAnchorRectCss = anchorRectCss

    const internal = st.ece as unknown as EceInternal
    const activeWc = this.host.activeWebContents()
    const validTabWc =
      activeWc &&
      !activeWc.isDestroyed() &&
      activeWc.session === st.session &&
      internal.ctx.store.tabs.has(activeWc)
        ? activeWc
        : null

    if (validTabWc) {
      try {
        internal.api.browserAction.activateClick({
          eventType: 'click',
          extensionId,
          tabId: validTabWc.id,
          anchorRect: anchorRectCss
        })
        return
      } catch (err) {
        console.error('[extensions] activateClick failed:', err)
      }
    }

    // Fallback when active tab is on Start Page or orbit:// (no web WebContents yet):
    // open the extension's default popup directly in a child window anchored to the button.
    const ext = st.session.extensions.getExtension(extensionId)
    if (!ext) return
    const popupUrl = internal.api.browserAction.getPopupUrl(extensionId, -1)
    if (!popupUrl) return
    this.openStandalonePopup(extensionId, popupUrl, st.session, activePartition, anchorRectCss)
  }

  private positionPopupWindow(pw: BrowserWindow, anchorCss: Rect | null): void {
    const parent = this.host.getWindow()
    if (!parent || parent.isDestroyed() || pw.isDestroyed()) return
    const cb = parent.getContentBounds()
    const z = parent.webContents.getZoomFactor()
    const cur = pw.getBounds()
    const width = Math.min(800, Math.max(120, cur.width))
    const height = Math.min(600, Math.max(80, cur.height))

    const anchorX = anchorCss
      ? Math.round(cb.x + (anchorCss.x + anchorCss.width) * z - width)
      : Math.round(cb.x + cb.width - width - 12)
    const anchorY = anchorCss
      ? Math.round(cb.y + (anchorCss.y + anchorCss.height + 6) * z)
      : Math.round(cb.y + Math.round(44 * z))

    const workArea = screen.getDisplayNearestPoint({ x: anchorX, y: anchorY }).workArea
    const placed = clampPopupBounds({ x: anchorX, y: anchorY }, { width, height }, workArea, 8)
    pw.setBounds(placed)
  }

  private lockDownPopupWebContents(wc: WebContents, extensionId: string, partition: string): void {
    const extOrigin = `chrome-extension://${extensionId}`
    const handleNav = (e: Electron.Event, url: string): void => {
      if (url.startsWith(`${extOrigin}/`)) return
      e.preventDefault()
      if (isAllowedUrl(url)) {
        this.closePopup()
        this.host.createTabFromExtension(url, { activate: true, partition })
      }
    }
    wc.on('will-navigate', handleNav)
    wc.on('will-redirect', handleNav)
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        e.preventDefault()
        this.closePopup()
      }
    })
    wc.setWindowOpenHandler(({ url }) => {
      const resolved = resolveAllowedExtensionTabUrl(url, extensionId)
      if (!resolved) return { action: 'deny' }
      this.closePopup()
      this.host.createTabFromExtension(resolved, {
        activate: true,
        partition,
        ownerExtensionId: resolved.startsWith('chrome-extension://') ? extensionId : undefined
      })
      return { action: 'deny' }
    })
  }

  private wirePopupWindowLifecycle(pw: BrowserWindow, extensionId: string, partition: string, destroyPopup: () => void): void {
    const parent = this.host.getWindow()
    const anchor = this.lastAnchorRectCss
    this.activePopupWin = pw
    this.activePopupExtId = extensionId
    this.host.onPopupOpenChange(true)

    this.lockDownPopupWebContents(pw.webContents, extensionId, partition)

    const onParentMoveOrResize = (): void => destroyPopup()
    if (parent && !parent.isDestroyed()) {
      parent.on('move', onParentMoveOrResize)
      parent.on('resize', onParentMoveOrResize)
    }

    const onFocus = (): void => this.host.onPopupFocusChange(true)
    const onBlur = (): void => {
      this.host.onPopupFocusChange(false)
      if (!pw.isDestroyed() && !pw.webContents.isDevToolsOpened()) {
        destroyPopup()
      }
    }
    pw.on('focus', onFocus)
    pw.on('blur', onBlur)

    const cleanup = (): void => {
      if (parent && !parent.isDestroyed()) {
        parent.off('move', onParentMoveOrResize)
        parent.off('resize', onParentMoveOrResize)
      }
      if (!pw.isDestroyed()) {
        pw.off('focus', onFocus)
        pw.off('blur', onBlur)
      }
      if (this.activePopupWin === pw) {
        this.activePopupWin = null
        this.activePopupExtId = null
      }
      this.activePopupCleanup = null
      this.host.onPopupOpenChange(false)
      this.host.onPopupFocusChange(false)
    }
    this.activePopupCleanup = cleanup
    pw.once('closed', cleanup)

    // Ensure clamped initial placement once ready.
    const reposition = (): void => this.positionPopupWindow(pw, anchor)
    pw.once('show', reposition)
  }

  private wirePopupView(popup: EcePopupView, partition: string): void {
    const pw = popup.browserWindow
    if (!pw || pw.isDestroyed()) return
    const anchor = this.lastAnchorRectCss
    this.wirePopupWindowLifecycle(pw, popup.extensionId, partition, () => popup.destroy())
    const clampNow = (): void => this.positionPopupWindow(pw, anchor)
    popup.on('resized', clampNow)
    popup.on('moved', clampNow)
  }

  private openStandalonePopup(extensionId: string, popupUrl: string, sess: Session, partition: string, anchorCss: Rect): void {
    const parent = this.host.getWindow()
    if (!parent || parent.isDestroyed()) return
    const pw = new BrowserWindow({
      parent,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      backgroundColor: '#ffffff',
      width: 360,
      height: 480,
      webPreferences: {
        session: sess,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        enablePreferredSizeMode: true
      }
    })
    pw.setMenu(null)
    this.wirePopupWindowLifecycle(pw, extensionId, partition, () => {
      if (!pw.isDestroyed()) pw.destroy()
    })
    const wc = pw.webContents as WebContents & {
      on(event: 'preferred-size-changed', listener: (_e: Electron.Event, size: { width: number; height: number }) => void): void
    }
    wc.on('preferred-size-changed', (_e, size) => {
      if (pw.isDestroyed()) return
      const w = Math.min(800, Math.max(120, Math.ceil(size.width || 360)))
      const h = Math.min(600, Math.max(80, Math.ceil(size.height || 480)))
      pw.setBounds({ ...pw.getBounds(), width: w, height: h })
      this.positionPopupWindow(pw, anchorCss)
      if (!pw.isVisible()) pw.show()
    })
    void pw.loadURL(popupUrl).then(() => {
      if (!pw.isDestroyed() && !pw.isVisible()) {
        this.positionPopupWindow(pw, anchorCss)
        pw.show()
      }
    }).catch(() => {
      if (!pw.isDestroyed()) pw.destroy()
    })
  }

  openActionContextMenu(extensionId: string, anchorRectCss: Rect): void {
    if (!validateExtensionId(extensionId) || this.isCompatExtension(extensionId)) return
    const parent = this.host.getWindow()
    if (!parent || parent.isDestroyed()) return
    const entry = this.registry.extensions.find((e) => e.id === extensionId)
    if (!entry) return
    const summary = this.getState().extensions.find((e) => e.id === extensionId)
    const activePartition = this.host.activePartition()
    const st = this.sessions.get(activePartition) ?? this.sessions.get('persist:web')

    const template: Electron.MenuItemConstructorOptions[] = [
      { label: summary?.name || entry.name || extensionId, enabled: false },
      { type: 'separator' }
    ]

    if (st) {
      const internal = st.ece as unknown as EceInternal
      const extItems = internal.ctx.store.buildMenuItems(extensionId, 'browser_action')
      if (extItems.length > 0) {
        for (const item of extItems) {
          template.push({ label: item.label, enabled: item.enabled, click: () => item.click?.({} as never, parent, {} as never) })
        }
        template.push({ type: 'separator' })
      }
    }

    if (summary?.optionsUrl) {
      template.push({ label: 'Options', click: () => this.openOptions(extensionId) })
    }
    template.push(
      { label: entry.pinned ? 'Unpin from toolbar' : 'Pin to toolbar', click: () => void this.setPinned(extensionId, !entry.pinned) },
      { label: 'Manage extensions', click: () => this.host.openSettingsExtensions() },
      { type: 'separator' },
      { label: 'Remove extension', click: () => void this.uninstall(extensionId) }
    )

    const z = parent.webContents.getZoomFactor()
    const menu = Menu.buildFromTemplate(template)
    menu.popup({
      window: parent,
      x: Math.round(anchorRectCss.x * z),
      y: Math.round((anchorRectCss.y + anchorRectCss.height + 4) * z)
    })
  }

  // ---- Install confirmation strip & CRX3 verified download ------------------

  private requestInstallApproval(ask: Omit<ExtensionInstallAsk, 'requestId'>): Promise<boolean> {
    const requestId = randomUUID()
    const fullAsk: ExtensionInstallAsk = { ...ask, requestId }
    return new Promise<boolean>((resolvePromise) => {
      this.pendingAsks.push({ ask: fullAsk, resolve: resolvePromise })
      this.host.onInstallAsksChanged(this.pendingAsks.map((p) => p.ask))
    })
  }

  answerInstallAsk(requestId: string, allow: boolean): void {
    const idx = this.pendingAsks.findIndex((p) => p.ask.requestId === requestId)
    if (idx < 0) return
    const [item] = this.pendingAsks.splice(idx, 1)
    this.host.onInstallAsksChanged(this.pendingAsks.map((p) => p.ask))
    item.resolve(allow)
  }

  listInstallAsks(): ExtensionInstallAsk[] {
    return this.pendingAsks.map((p) => ({ ...p.ask }))
  }

  private getCrxDownloadUrl(extensionId: string): string {
    const url = new URL('https://clients2.google.com/service/update2/crx')
    url.searchParams.set('response', 'redirect')
    url.searchParams.set('acceptformat', 'crx3')
    url.searchParams.set('prodversion', process.versions.chrome || '140.0.0.0')
    url.searchParams.set('x', `id=${extensionId}&uc`)
    return url.toString()
  }

  /**
   * Downloads a CRX3 from Chrome Web Store, verifies its cryptographic signature
   * (RSA/ECDSA SHA-256) and extension ID, checks every ZIP entry for Zip-Slip,
   * unpacks into `userData/Extensions/<id>/<version>_0`, and returns the unpacked
   * directory + parsed manifest.
   */
  async downloadAndVerifyStoreExtension(extensionId: string): Promise<{ dir: string; manifest: ManifestLike & Record<string, unknown> }> {
    if (!validateExtensionId(extensionId)) throw new Error('Invalid extension ID')
    const url = this.getCrxDownloadUrl(extensionId)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Chrome Web Store download failed (HTTP ${response.status})`)
    }
    const rawBuffer = Buffer.from(await response.arrayBuffer())

    // Security Fix (d): Cryptographic CRX3 signature verification.
    const verified = parseAndVerifyCrx3(rawBuffer, extensionId)

    const zip = new AdmZip(Buffer.from(verified.zipBytes))
    const entries = zip.getEntries()
    if (entries.length === 0) throw new Error('CRX3 archive is empty')
    for (const entry of entries) {
      if (!isSafeZipEntryPath(entry.entryName)) {
        throw new Error(`Unsafe path in CRX archive: ${entry.entryName}`)
      }
    }

    const stagingDir = join(this.extensionsDir, extensionId, `.stage-${randomUUID()}`)
    mkdirSync(stagingDir, { recursive: true })
    try {
      zip.extractAllTo(stagingDir, true)
      const manifestPath = join(stagingDir, 'manifest.json')
      if (!existsSync(manifestPath)) throw new Error('Extension is missing manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestLike & Record<string, unknown>
      if (Number(manifest.manifest_version) < 3) {
        throw new Error('Only Manifest V3 extensions are supported')
      }
      if (typeof manifest.version !== 'string' || !/^[0-9][0-9.]{0,31}$/.test(manifest.version)) {
        throw new Error('Extension has an invalid manifest version')
      }
      manifest.key = verified.publicKeyBase64
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

      const finalDir = join(this.extensionsDir, extensionId, `${manifest.version}_0`)
      if (existsSync(finalDir)) rmSync(finalDir, { recursive: true, force: true })
      mkdirSync(dirname(finalDir), { recursive: true })
      // Move staged directory into versioned location
      const { renameSync } = await import('node:fs')
      renameSync(stagingDir, finalDir)
      return { dir: finalDir, manifest }
    } catch (err) {
      try {
        rmSync(stagingDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      throw err
    }
  }

  private async activateInstalledStoreExtension(
    extensionId: string,
    manifest: ManifestLike & Record<string, unknown>,
    autoPin = true
  ): Promise<void> {
    let entry = this.registry.extensions.find((e) => e.id === extensionId)
    if (!entry) {
      entry = {
        id: extensionId,
        source: 'webstore',
        enabled: true,
        pinned: autoPin,
        name: typeof manifest.name === 'string' && !manifest.name.startsWith('__MSG_') ? manifest.name : extensionId,
        version: typeof manifest.version === 'string' ? manifest.version : '',
        description: typeof manifest.description === 'string' && !manifest.description.startsWith('__MSG_') ? manifest.description : ''
      }
      this.registry.extensions.push(entry)
    } else {
      entry.enabled = true
      entry.source = 'webstore'
      if (typeof manifest.name === 'string' && !manifest.name.startsWith('__MSG_')) entry.name = manifest.name
      if (typeof manifest.version === 'string') entry.version = manifest.version
    }
    this.saveRegistry()

    for (const st of this.sessions.values()) {
      await this.loadEntryIntoSession(entry, st)
    }
    this.saveRegistry()
    this.scheduleStateBroadcast()
    this.scheduleActionsBroadcast()
  }

  // ---- Chrome Web Store IPC handlers (strict origin already verified) -------

  handleWebStoreGetStatus(rawId: unknown, rawManifestJson: unknown): string {
    if (!validateExtensionId(rawId) || this.isCompatExtension(rawId)) return CWS_STATUS.INSTALLABLE
    if (typeof rawManifestJson === 'string') {
      try {
        const m = JSON.parse(rawManifestJson) as { manifest_version?: number }
        if (typeof m.manifest_version === 'number' && m.manifest_version < 3) {
          return CWS_STATUS.DEPRECATED_MANIFEST_VERSION
        }
      } catch {
        /* ignore */
      }
    }
    const entry = this.registry.extensions.find((e) => e.id === rawId)
    if (!entry) return CWS_STATUS.INSTALLABLE
    return entry.enabled ? CWS_STATUS.ENABLED : CWS_STATUS.DISABLED
  }

  handleWebStoreManagementGetAll(): Record<string, unknown>[] {
    return this.getState().extensions.map((ext) => ({
      id: ext.id,
      name: ext.name,
      shortName: ext.name,
      description: ext.description,
      version: ext.version,
      enabled: ext.enabled,
      mayDisable: true,
      installType: ext.source === 'unpacked' ? 'development' : 'normal',
      type: 'extension',
      isApp: false,
      offlineEnabled: false,
      homepageUrl: '',
      updateUrl: '',
      optionsUrl: ext.optionsUrl || '',
      permissions: ext.rawPermissions,
      hostPermissions: ext.hostPermissions,
      icons: []
    }))
  }

  async handleWebStoreBeginInstall(
    event: IpcMainInvokeEvent,
    rawDetails: unknown
  ): Promise<{ result: string; message?: string }> {
    if (!rawDetails || typeof rawDetails !== 'object') return { result: CWS_RESULT.UNKNOWN_ERROR }
    const details = rawDetails as { id?: unknown; localizedName?: unknown; manifest?: unknown; iconUrl?: unknown }
    if (!validateExtensionId(details.id) || this.isCompatExtension(details.id)) {
      return { result: CWS_RESULT.BLOCKED_BY_POLICY }
    }
    const extensionId = details.id
    if (this.installingIds.has(extensionId)) {
      return { result: CWS_RESULT.INSTALL_IN_PROGRESS }
    }

    let manifest: ManifestLike & Record<string, unknown>
    try {
      if (typeof details.manifest !== 'string') throw new Error('missing manifest')
      manifest = JSON.parse(details.manifest) as ManifestLike & Record<string, unknown>
    } catch {
      return { result: CWS_RESULT.MANIFEST_ERROR }
    }
    if (Number(manifest.manifest_version) < 3) {
      return { result: CWS_RESULT.BLOCKED_BY_POLICY, message: 'Only Manifest V3 extensions are supported.' }
    }

    let iconDataUrl: string | undefined
    if (typeof details.iconUrl === 'string') {
      try {
        const iconUrl = new URL(details.iconUrl)
        if (iconUrl.protocol === 'https:') {
          const res = await fetch(iconUrl.href)
          if (res.ok) {
            const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
            if (!img.isEmpty()) iconDataUrl = img.resize({ width: 48, height: 48 }).toDataURL()
          }
        }
      } catch {
        /* icon is optional for prompt */
      }
    }

    const localizedName =
      typeof details.localizedName === 'string' && details.localizedName.trim()
        ? details.localizedName.trim()
        : typeof manifest.name === 'string'
          ? manifest.name
          : extensionId

    const approved = await this.requestInstallApproval({
      id: extensionId,
      name: localizedName,
      version: typeof manifest.version === 'string' ? manifest.version : '',
      iconDataUrl,
      permissions: describeManifestPermissions(manifest),
      source: 'webstore'
    })
    if (!approved) {
      return { result: CWS_RESULT.USER_CANCELLED }
    }

    this.installingIds.add(extensionId)
    try {
      const { manifest: diskManifest } = await this.downloadAndVerifyStoreExtension(extensionId)
      await this.activateInstalledStoreExtension(extensionId, { ...diskManifest, name: localizedName })
      const senderFrame = event.senderFrame
      if (senderFrame && !senderFrame.isDestroyed()) {
        const info = this.handleWebStoreManagementGetAll().find((x) => x.id === extensionId)
        if (info) {
          queueMicrotask(() => {
            if (!senderFrame.isDestroyed()) senderFrame.send('orbitManagement.onInstalled', info)
          })
        }
      }
      return { result: CWS_RESULT.SUCCESS }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { result: CWS_RESULT.INSTALL_ERROR, message: msg }
    } finally {
      this.installingIds.delete(extensionId)
    }
  }

  // ---- User actions (Settings & IPC) ----------------------------------------

  async installFromStoreById(
    idOrUrl: string,
    opts: { skipPrompt?: boolean } = {}
  ): Promise<{ ok: boolean; error?: string; id?: string }> {
    const extensionId = extractExtensionId(idOrUrl)
    if (!extensionId || this.isCompatExtension(extensionId)) {
      return { ok: false, error: 'Enter a valid Chrome Web Store URL or 32-character extension ID.' }
    }
    if (this.installingIds.has(extensionId)) {
      return { ok: false, error: 'This extension is already being installed.' }
    }

    this.installingIds.add(extensionId)
    try {
      const { dir, manifest } = await this.downloadAndVerifyStoreExtension(extensionId)
      if (!opts.skipPrompt) {
        const iconDataUrl = this.iconForExtension(extensionId, dir, manifest, false)
        const name =
          (typeof manifest.name === 'string' && !manifest.name.startsWith('__MSG_') ? manifest.name : extensionId)
        const approved = await this.requestInstallApproval({
          id: extensionId,
          name,
          version: typeof manifest.version === 'string' ? manifest.version : '',
          iconDataUrl,
          permissions: describeManifestPermissions(manifest),
          source: 'id'
        })
        if (!approved) {
          try {
            rmSync(join(this.extensionsDir, extensionId), { recursive: true, force: true })
          } catch {
            /* ignore */
          }
          return { ok: false, error: 'Installation cancelled.' }
        }
      }
      await this.activateInstalledStoreExtension(extensionId, manifest)
      return { ok: true, id: extensionId }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      this.installingIds.delete(extensionId)
    }
  }

  async loadUnpackedFromDirectory(dirPath: string): Promise<{ ok: boolean; error?: string; id?: string }> {
    if (!this.registry.developerMode) {
      return { ok: false, error: 'Enable Developer mode to load unpacked extensions.' }
    }
    const cleanDir = resolve(dirPath)
    if (!existsSync(cleanDir) || !statSync(cleanDir).isDirectory()) {
      return { ok: false, error: 'Selected folder does not exist.' }
    }
    const manifest = readManifestFromDir(cleanDir)
    if (!manifest) {
      return { ok: false, error: 'Selected folder does not contain a valid manifest.json.' }
    }
    if (Number(manifest.manifest_version) < 3) {
      return { ok: false, error: 'Only Manifest V3 extensions are supported.' }
    }

    const primarySession = this.sessions.get('persist:web') ?? [...this.sessions.values()][0]
    if (!primarySession) {
      return { ok: false, error: 'No active browser session available.' }
    }

    try {
      const loaded = await primarySession.session.extensions.loadExtension(cleanDir, { allowFileAccess: false })
      if (this.isCompatExtension(loaded.id)) {
        return { ok: false, error: 'Cannot load internal extension.' }
      }
      const existing = this.registry.extensions.find((e) => e.id === loaded.id)
      const entry: StoredExtensionEntry = existing ?? {
        id: loaded.id,
        source: 'unpacked',
        enabled: true,
        pinned: true,
        unpackedPath: cleanDir
      }
      entry.source = 'unpacked'
      entry.unpackedPath = cleanDir
      entry.enabled = true
      entry.name = loaded.name
      entry.version = loaded.version
      if (typeof manifest.description === 'string') entry.description = manifest.description
      if (!existing) this.registry.extensions.push(entry)
      this.saveRegistry()

      for (const st of this.sessions.values()) {
        if (st !== primarySession) {
          await this.loadEntryIntoSession(entry, st)
        }
      }
      this.scheduleStateBroadcast()
      this.scheduleActionsBroadcast()
      return { ok: true, id: loaded.id }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async setEnabled(extensionId: string, enabled: boolean): Promise<boolean> {
    if (!validateExtensionId(extensionId) || this.isCompatExtension(extensionId)) return false
    const entry = this.registry.extensions.find((e) => e.id === extensionId)
    if (!entry) return false
    entry.enabled = enabled
    this.saveRegistry()

    if (!enabled) {
      if (this.activePopupExtId === extensionId) this.closePopup()
      for (const st of this.sessions.values()) {
        if (st.session.extensions.getExtension(extensionId)) {
          st.session.extensions.removeExtension(extensionId)
        }
      }
    } else if (entry.source !== 'unpacked' || this.registry.developerMode) {
      for (const st of this.sessions.values()) {
        await this.loadEntryIntoSession(entry, st)
      }
    }

    this.scheduleStateBroadcast()
    this.scheduleActionsBroadcast()
    return true
  }

  setPinned(extensionId: string, pinned: boolean): boolean {
    if (!validateExtensionId(extensionId) || this.isCompatExtension(extensionId)) return false
    const entry = this.registry.extensions.find((e) => e.id === extensionId)
    if (!entry) return false
    entry.pinned = pinned
    this.saveRegistry()
    this.scheduleStateBroadcast()
    this.scheduleActionsBroadcast()
    return true
  }

  async setDeveloperMode(enabled: boolean): Promise<boolean> {
    this.registry.developerMode = enabled
    this.saveRegistry()
    for (const entry of this.registry.extensions) {
      if (entry.source !== 'unpacked') continue
      if (!enabled) {
        if (this.activePopupExtId === entry.id) this.closePopup()
        for (const st of this.sessions.values()) {
          if (st.session.extensions.getExtension(entry.id)) {
            st.session.extensions.removeExtension(entry.id)
          }
        }
      } else if (entry.enabled) {
        for (const st of this.sessions.values()) {
          await this.loadEntryIntoSession(entry, st)
        }
      }
    }
    this.scheduleStateBroadcast()
    this.scheduleActionsBroadcast()
    return true
  }

  async uninstall(extensionId: string): Promise<boolean> {
    if (!validateExtensionId(extensionId) || this.isCompatExtension(extensionId)) return false
    const idx = this.registry.extensions.findIndex((e) => e.id === extensionId)
    if (idx < 0) return false
    const [entry] = this.registry.extensions.splice(idx, 1)
    this.saveRegistry()

    if (this.activePopupExtId === extensionId) this.closePopup()
    for (const st of this.sessions.values()) {
      if (st.session.extensions.getExtension(extensionId)) {
        st.session.extensions.removeExtension(extensionId)
      }
    }
    if (entry.source === 'webstore') {
      try {
        rmSync(join(this.extensionsDir, extensionId), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    this.scheduleStateBroadcast()
    this.scheduleActionsBroadcast()
    return true
  }

  openOptions(extensionId: string): void {
    if (!validateExtensionId(extensionId) || this.isCompatExtension(extensionId)) return
    const summary = this.getState().extensions.find((e) => e.id === extensionId)
    if (!summary?.optionsUrl) return
    const partition = shouldLoadExtensionsForPartition(this.host.activePartition())
      ? this.host.activePartition()
      : 'persist:web'
    this.host.createTabFromExtension(summary.optionsUrl, {
      activate: true,
      partition,
      ownerExtensionId: extensionId
    })
  }

  dispose(): void {
    this.disposed = true
    if (this.actionsTimer) {
      clearTimeout(this.actionsTimer)
      this.actionsTimer = null
    }
    if (this.stateTimer) {
      clearTimeout(this.stateTimer)
      this.stateTimer = null
    }
    this.closePopup()
    for (const pending of this.pendingAsks) pending.resolve(false)
    this.pendingAsks = []
    for (const st of this.sessions.values()) {
      if (st.cookieChangedListener) {
        st.session.cookies.off('changed', st.cookieChangedListener)
      }
    }
  }
}
