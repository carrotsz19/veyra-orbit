// Minimal preload bridge for the floating menu window only.
// Exposes no Node APIs, no browser state, and no general IPC channels.
import { contextBridge, ipcRenderer } from 'electron'
import type { MenuPopupSpec, VeyraMenuWindowApi } from '../shared/types'

const api: VeyraMenuWindowApi = {
  ready: () => ipcRenderer.send('menu:ready'),
  onRender: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, spec: MenuPopupSpec): void => cb(spec)
    ipcRenderer.on('menu:render', h)
    return () => ipcRenderer.off('menu:render', h)
  },
  size: (width, height) => ipcRenderer.send('menu:size', width, height),
  pick: (id) => ipcRenderer.send('menu:pick', id),
  step: (by) => ipcRenderer.send('menu:step', by),
  dismiss: () => ipcRenderer.send('menu:dismiss')
}

contextBridge.exposeInMainWorld('veyraMenu', api)
