// The bridge for the browser's own UI. Web pages in tabs get no preload at all.
import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserState, PermissionAsk, Rect, VeyraApi } from '../shared/types'

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const f = (_e: Electron.IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, f)
  return () => ipcRenderer.off(channel, f)
}

const api: VeyraApi = {
  onState: (cb) => listen<BrowserState>('state', cb),
  onFocusOmnibox: (cb) => listen<void>('focus-omnibox', () => cb()),
  onPermission: (cb) => listen<PermissionAsk[]>('permissions', cb),
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
  answerPermission: (id, allow) => ipcRenderer.send('permission:answer', id, allow)
}

contextBridge.exposeInMainWorld('veyra', api)
