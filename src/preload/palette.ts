// Minimal preload bridge for the floating Ctrl+K command palette window only.
// Exposes no Node APIs, no browser state, and sends only item IDs or typed query text.
import { contextBridge, ipcRenderer } from 'electron'
import type { PaletteOpenState, PaletteResultsPayload, VeyraPaletteWindowApi } from '../shared/types'

const api: VeyraPaletteWindowApi = {
  ready: () => ipcRenderer.send('palette:ready'),
  onOpen: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, init: PaletteOpenState): void => cb(init)
    ipcRenderer.on('palette:open', h)
    return () => ipcRenderer.off('palette:open', h)
  },
  onResults: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, payload: PaletteResultsPayload): void => cb(payload)
    ipcRenderer.on('palette:results', h)
    return () => ipcRenderer.off('palette:results', h)
  },
  query: (text) => ipcRenderer.send('palette:query', text),
  pick: (id, openInNewTab) => ipcRenderer.send('palette:pick', id, openInNewTab),
  submitText: (text, openInNewTab) => ipcRenderer.send('palette:submit-text', text, openInNewTab),
  size: (height) => ipcRenderer.send('palette:size', height),
  dismiss: () => ipcRenderer.send('palette:dismiss')
}

contextBridge.exposeInMainWorld('veyraPalette', api)
