// Minimal preload bridge for the floating screenshot chooser and preview toast windows only.
// Exposes no Node APIs, no browser state, and sends only validated capture/save/copy commands.
import { contextBridge, ipcRenderer } from 'electron'
import type {
  ResolvedAppearance,
  ScreenshotChooserPayload,
  ScreenshotMode,
  ScreenshotToastPayload,
  VeyraScreenshotWindowApi
} from '../shared/types'

const api: VeyraScreenshotWindowApi = {
  ready: () => ipcRenderer.send('screenshot-win:ready'),
  onChooser: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, payload: ScreenshotChooserPayload): void => cb(payload)
    ipcRenderer.on('screenshot-win:chooser', h)
    return () => ipcRenderer.off('screenshot-win:chooser', h)
  },
  onToast: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, payload: ScreenshotToastPayload): void => cb(payload)
    ipcRenderer.on('screenshot-win:toast', h)
    return () => ipcRenderer.off('screenshot-win:toast', h)
  },
  onAppearance: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, tokens: ResolvedAppearance): void => cb(tokens)
    ipcRenderer.on('appearance:tokens', h)
    return () => ipcRenderer.off('appearance:tokens', h)
  },
  choose: (mode: ScreenshotMode) => ipcRenderer.send('screenshot-win:choose', mode),
  save: (id: string) => ipcRenderer.invoke('screenshot-win:save', id),
  copy: (id: string) => ipcRenderer.invoke('screenshot-win:copy', id),
  showInFolder: (id: string) => ipcRenderer.send('screenshot-win:show', id),
  size: (width: number, height: number) => ipcRenderer.send('screenshot-win:size', width, height),
  setHover: (hovering: boolean) => ipcRenderer.send('screenshot-win:hover', hovering),
  dismiss: () => ipcRenderer.send('screenshot-win:dismiss')
}

contextBridge.exposeInMainWorld('veyraScreenshot', api)
