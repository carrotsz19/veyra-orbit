// Minimal preload bridge for the floating Link Preview ("Peek") toolbar window only.
// Exposes no Node APIs, no browser state, and sends only fixed action IDs (never URLs).
import { contextBridge, ipcRenderer } from 'electron'
import type { PeekAction, PeekState, ResolvedAppearance, VeyraPeekWindowApi } from '../shared/types'

const api: VeyraPeekWindowApi = {
  ready: () => ipcRenderer.send('peek:ready'),
  onState: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, state: PeekState): void => cb(state)
    ipcRenderer.on('peek:state', h)
    return () => ipcRenderer.off('peek:state', h)
  },
  onAppearance: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, tokens: ResolvedAppearance): void => cb(tokens)
    ipcRenderer.on('appearance:tokens', h)
    return () => ipcRenderer.off('appearance:tokens', h)
  },
  action: (act: PeekAction) => ipcRenderer.send('peek:action', act)
}

contextBridge.exposeInMainWorld('veyraPeek', api)
