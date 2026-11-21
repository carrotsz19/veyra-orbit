// The bridge for the browser's own UI. Web pages in tabs get no preload at all.
import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserState, DownloadInfo, ExternalAppAsk, FindState, PermissionAsk, Rect, SettingsView, SitePermission, VeyraApi } from '../shared/types'

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const f = (_e: Electron.IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, f)
  return () => ipcRenderer.off(channel, f)
}

const api: VeyraApi = {
  onState: (cb) => listen<BrowserState>('state', cb),
  onFocusOmnibox: (cb) => listen<void>('focus-omnibox', () => cb()),
  onPermission: (cb) => listen<PermissionAsk[]>('permissions', cb),
  onExternalApps: (cb) => listen<ExternalAppAsk[]>('external-apps', cb),
  onSettings: (cb) => listen<SettingsView>('settings', cb),
  onSavedPermissions: (cb) => listen<SitePermission[]>('permissions:saved', cb),
  onDownloads: (cb) => listen<DownloadInfo[]>('downloads', cb),
  onToggleDownloads: (cb) => listen<void>('downloads:toggle', () => cb()),
  onFindOpen: (cb) => listen<void>('find:open', () => cb()),
  onFindClose: (cb) => listen<void>('find:close', () => cb()),
  onFindResult: (cb) => listen<FindState>('find:result', cb),
  ready: () => ipcRenderer.send('ready'),
  newTab: (input) => ipcRenderer.send('tab:new', input),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  activate: (id) => ipcRenderer.send('tab:activate', id),
  navigate: (id, input) => ipcRenderer.send('tab:navigate', id, input),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  stop: () => ipcRenderer.send('nav:stop'),
  resetZoom: () => ipcRenderer.send('nav:zoom-reset'),
  togglePin: (id) => ipcRenderer.send('tab:pin', id),
  move: (id, to) => ipcRenderer.send('tab:move', id, to),
  setBounds: (r: Rect | null) => ipcRenderer.send('bounds', r),
  answerPermission: (id, allow, remember) => ipcRenderer.send('permission:answer', id, allow, remember),
  answerExternalApp: (id, open) => ipcRenderer.send('external-app:answer', id, open),
  find: (text, opts) => ipcRenderer.send('find:start', text, opts),
  stopFind: () => ipcRenderer.send('find:stop'),
  toggleMute: (id) => ipcRenderer.send('tab:mute', id),
  tabMenu: (id) => ipcRenderer.send('tab:menu', id),
  onPageFullscreen: (cb) => listen<boolean>('page-fullscreen', cb),
  pauseDownload: (id) => ipcRenderer.send('download:pause', id),
  resumeDownload: (id) => ipcRenderer.send('download:resume', id),
  cancelDownload: (id) => ipcRenderer.send('download:cancel', id),
  openDownload: (id) => ipcRenderer.send('download:open', id),
  showDownload: (id) => ipcRenderer.send('download:show', id),
  clearFinishedDownloads: () => ipcRenderer.send('download:clear'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  chooseDownloadsDir: () => ipcRenderer.invoke('settings:choose-downloads-dir'),
  savedPermissions: () => ipcRenderer.invoke('permissions:list'),
  setSavedPermission: (origin, permission, allow) => ipcRenderer.invoke('permissions:set', origin, permission, allow),
  removeSavedPermission: (origin, permission) => ipcRenderer.invoke('permissions:remove', origin, permission),
  clearBrowsingData: (req) => ipcRenderer.invoke('privacy:clear', req),
  suggest: (input) => ipcRenderer.invoke('suggest', input),
  overlay: async (open) => {
    const shot = (await ipcRenderer.invoke('overlay', open)) as string | null
    return shot
  },
  history: (query, before) => ipcRenderer.invoke('history:list', query, before),
  deleteHistory: (id) => void ipcRenderer.invoke('history:delete', id),
  clearHistory: (msAgo) => ipcRenderer.invoke('history:clear', msAgo),
  bookmarks: () => ipcRenderer.invoke('bookmarks:list'),
  toggleBookmark: () => ipcRenderer.send('bookmark:toggle'),
  removeBookmark: (url) => ipcRenderer.invoke('bookmark:remove', url),
  renameBookmark: (url, title) => ipcRenderer.invoke('bookmark:rename', url, title),
  onDataChanged: (cb) => listen<void>('data-changed', () => cb()),
  hidePageForOverlay: () => ipcRenderer.send('overlay:hide')
}

contextBridge.exposeInMainWorld('veyra', api)
