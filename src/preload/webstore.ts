/*
 * Hardened Chrome Web Store preload for Veyra Orbit.
 *
 * Only activates on exact origin `https://chromewebstore.google.com` (never
 * `startsWith`, which would match lookalike domains). Exposes the minimal
 * `chrome.webstorePrivate` and `chrome.management` bridge expected by the
 * Chrome Web Store so its "Add to Chrome" / "Add to Veyra Orbit" button works.
 */
import { contextBridge, ipcRenderer, webFrame } from 'electron'

const STORE_ORIGIN = 'https://chromewebstore.google.com'

const ExtensionInstallStatus = {
  BLACKLISTED: 'blacklisted',
  BLOCKED_BY_POLICY: 'blocked_by_policy',
  CAN_REQUEST: 'can_request',
  CORRUPTED: 'corrupted',
  CUSTODIAN_APPROVAL_REQUIRED: 'custodian_approval_required',
  CUSTODIAN_APPROVAL_REQUIRED_FOR_INSTALLATION: 'custodian_approval_required_for_installation',
  DEPRECATED_MANIFEST_VERSION: 'deprecated_manifest_version',
  DISABLED: 'disabled',
  ENABLED: 'enabled',
  FORCE_INSTALLED: 'force_installed',
  INSTALLABLE: 'installable',
  REQUEST_PENDING: 'request_pending',
  TERMINATED: 'terminated'
}

const MV2DeprecationStatus = {
  INACTIVE: 'inactive',
  SOFT_DISABLE: 'soft_disable',
  WARNING: 'warning'
}

const Result = {
  ALREADY_INSTALLED: 'already_installed',
  BLACKLISTED: 'blacklisted',
  BLOCKED_BY_POLICY: 'blocked_by_policy',
  BLOCKED_FOR_CHILD_ACCOUNT: 'blocked_for_child_account',
  FEATURE_DISABLED: 'feature_disabled',
  ICON_ERROR: 'icon_error',
  INSTALL_ERROR: 'install_error',
  INSTALL_IN_PROGRESS: 'install_in_progress',
  INVALID_ICON_URL: 'invalid_icon_url',
  INVALID_ID: 'invalid_id',
  LAUNCH_IN_PROGRESS: 'launch_in_progress',
  MANIFEST_ERROR: 'manifest_error',
  MISSING_DEPENDENCIES: 'missing_dependencies',
  SUCCESS: 'success',
  UNKNOWN_ERROR: 'unknown_error',
  UNSUPPORTED_EXTENSION_TYPE: 'unsupported_extension_type',
  USER_CANCELLED: 'user_cancelled',
  USER_GESTURE_REQUIRED: 'user_gesture_required'
}

const WebGlStatus = {
  WEBGL_ALLOWED: 'webgl_allowed',
  WEBGL_BLOCKED: 'webgl_blocked'
}

function updateBranding(appName: string): void {
  const run = (): void => {
    requestAnimationFrame(() => {
      try {
        const nodes = Array.from(document.querySelectorAll('span')).filter((n) => n.innerText.includes('Chrome'))
        for (const node of nodes) {
          node.innerText = node.innerText.replace('Chrome', appName)
        }
      } catch {
        /* ignore DOM access errors */
      }
    })
  }
  run()
  setTimeout(run, 50)
}

function setupWebStoreBridge(): void {
  let appName = ''
  const maybeUpdateBranding = (): void => {
    if (appName) updateBranding(appName)
  }

  const setExtensionError = (message: string | null): void => {
    void webFrame.executeJavaScript(`
      if (typeof chrome !== 'undefined') {
        if (!chrome.extension) chrome.extension = {};
        chrome.extension.lastError = ${JSON.stringify(message ? { message } : null)};
      }
    `)
  }

  const electronWebstore = {
    ExtensionInstallStatus,
    MV2DeprecationStatus,
    Result,
    WebGlStatus,
    beginInstallWithManifest3: async (details: unknown, callback?: (result: string) => void) => {
      const res = (await ipcRenderer.invoke('orbitWebstore.beginInstall', details)) as {
        result: string
        message?: string
      }
      const code = res?.result ?? Result.UNKNOWN_ERROR
      setExtensionError(code === Result.SUCCESS ? null : (res?.message ?? null))
      if (callback) callback(code)
      return code
    },
    completeInstall: async (id: string, callback?: (result: string) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.completeInstall', id)) as string
      if (callback) callback(result)
      maybeUpdateBranding()
      return result
    },
    enableAppLauncher: async (enable: boolean, callback?: (result: boolean) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.enableAppLauncher', enable)) as boolean
      if (callback) callback(result)
      return result
    },
    getBrowserLogin: async (callback?: (result: string) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.getBrowserLogin')) as string
      if (callback) callback(result)
      return result
    },
    getExtensionStatus: async (id: string, manifestJson: string, callback?: (result: string) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.getExtensionStatus', id, manifestJson)) as string
      if (callback) callback(result)
      maybeUpdateBranding()
      return result
    },
    getFullChromeVersion: async (callback?: (result: { version_number: string }) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.getFullChromeVersion')) as {
        version_number: string
        app_name?: string
      }
      if (result?.app_name) {
        appName = result.app_name
        updateBranding(appName)
        delete result.app_name
      }
      if (callback) callback(result)
      return result
    },
    getIsLauncherEnabled: async (callback?: (result: boolean) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.getIsLauncherEnabled')) as boolean
      if (callback) callback(result)
      return result
    },
    getMV2DeprecationStatus: async (callback?: (result: string) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.getMV2DeprecationStatus')) as string
      if (callback) callback(result)
      return result
    },
    getReferrerChain: async (callback?: (result: string) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.getReferrerChain')) as string
      if (callback) callback(result)
      return result
    },
    getStoreLogin: async (callback?: (result: string) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.getStoreLogin')) as string
      if (callback) callback(result)
      return result
    },
    getWebGLStatus: async (callback?: (result: string) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.getWebGLStatus')) as string
      if (callback) callback(result)
      return result
    },
    install: async (id: string, silentInstall?: boolean, callback?: (result: string) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.install', id, silentInstall)) as string
      if (callback) callback(result)
      return result
    },
    isInIncognitoMode: async (callback?: (result: boolean) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.isInIncognitoMode')) as boolean
      if (callback) callback(result)
      return result
    },
    isPendingCustodianApproval: async (id: string, callback?: (result: boolean) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.isPendingCustodianApproval', id)) as boolean
      if (callback) callback(result)
      return result
    },
    setStoreLogin: async (login: string, callback?: (result: boolean) => void) => {
      const result = (await ipcRenderer.invoke('orbitWebstore.setStoreLogin', login)) as boolean
      if (callback) callback(result)
      return result
    }
  }

  const electronRuntime = {
    lastError: null,
    getManifest: async () => ({})
  }

  const listenerMap = new WeakMap<(...args: unknown[]) => void, (_e: Electron.IpcRendererEvent, ...args: unknown[]) => void>()
  const wrapListener = (cb: (...args: unknown[]) => void) => {
    let wrapped = listenerMap.get(cb)
    if (!wrapped) {
      wrapped = (_e, ...args) => cb(...args)
      listenerMap.set(cb, wrapped)
    }
    return wrapped
  }

  const electronManagement = {
    onInstalled: {
      addListener: (cb: (...args: unknown[]) => void) => {
        ipcRenderer.on('orbitManagement.onInstalled', wrapListener(cb))
      },
      removeListener: (cb: (...args: unknown[]) => void) => {
        const w = listenerMap.get(cb)
        if (w) ipcRenderer.removeListener('orbitManagement.onInstalled', w)
      }
    },
    onUninstalled: {
      addListener: (cb: (...args: unknown[]) => void) => {
        ipcRenderer.on('orbitManagement.onUninstalled', wrapListener(cb))
      },
      removeListener: (cb: (...args: unknown[]) => void) => {
        const w = listenerMap.get(cb)
        if (w) ipcRenderer.removeListener('orbitManagement.onUninstalled', w)
      }
    },
    getAll: (callback?: (list: unknown[]) => void) => {
      return ipcRenderer.invoke('orbitManagement.getAll').then((list: unknown[]) => {
        if (callback) callback(list)
        return list
      })
    },
    setEnabled: async (id: string, enabled: boolean) => {
      return ipcRenderer.invoke('orbitManagement.setEnabled', id, enabled)
    },
    uninstall: (id: string, options?: unknown, callback?: () => void) => {
      return ipcRenderer.invoke('orbitManagement.uninstall', id, options).then(() => {
        if (callback) callback()
      })
    }
  }

  contextBridge.exposeInMainWorld('electronWebstore', electronWebstore)
  contextBridge.exposeInMainWorld('electronRuntime', electronRuntime)
  contextBridge.exposeInMainWorld('electronManagement', electronManagement)

  void webFrame.executeJavaScript(`
    (function () {
      if (typeof globalThis.chrome !== 'object' || !globalThis.chrome) globalThis.chrome = {};
      chrome.webstorePrivate = globalThis.electronWebstore;
      if (!chrome.runtime) chrome.runtime = {};
      Object.assign(chrome.runtime, globalThis.electronRuntime);
      if (!chrome.management) chrome.management = {};
      Object.assign(chrome.management, globalThis.electronManagement);
    }());
  `)

  void electronWebstore.getFullChromeVersion()
  if (typeof process !== 'undefined' && typeof process.once === 'function') {
    process.once('document-start' as never, maybeUpdateBranding)
  }
  const nav = (window as unknown as { navigation?: EventTarget }).navigation
  if (nav && typeof nav.addEventListener === 'function') {
    nav.addEventListener('navigate', maybeUpdateBranding)
  }
}

if (typeof location !== 'undefined' && location.origin === STORE_ORIGIN) {
  setupWebStoreBridge()
}
