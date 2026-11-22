// Minimal preload bridge for the floating compact-mode sidebar and titlebar panels.
// Exposes only the subset of UI actions needed by Sidebar / TitleBar, with no privileged
// settings/privacy/bounds/overlay channels and no Node APIs.
import { contextBridge, ipcRenderer } from 'electron'
import type {
  BrowserState,
  CompactEdgeKind,
  CompactPinKind,
  CompactRevealState,
  DownloadInfo,
  ExtensionActionView,
  Rect,
  ResolvedAppearance,
  SettingsView,
  SplitOrientation,
  SplitPlacement,
  UpdateState,
  VeyraCompactPanelApi,
  WindowState,
  WorkspaceCreateInput,
  WorkspaceUpdateInput
} from '../shared/types'

function listen<T>(channel: string, cb: (v: T) => void): () => void {
  const f = (_e: Electron.IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, f)
  return () => ipcRenderer.off(channel, f)
}

// Subset of VeyraApi consumed by Sidebar and TitleBar / Omnibox.
const uiSubset = {
  onState: (cb: (s: BrowserState) => void) => listen<BrowserState>('state', cb),
  onFocusOmnibox: (cb: () => void) => listen<void>('focus-omnibox', () => cb()),
  onSettings: (cb: (s: SettingsView) => void) => listen<SettingsView>('settings', cb),
  onAppearance: (cb: (tokens: ResolvedAppearance) => void) => listen<ResolvedAppearance>('appearance:tokens', cb),
  onDownloads: (cb: (items: DownloadInfo[]) => void) => listen<DownloadInfo[]>('downloads', cb),
  onToggleDownloads: (cb: () => void) => listen<void>('downloads:toggle', () => cb()),
  onDataChanged: (cb: () => void) => listen<void>('data-changed', () => cb()),
  onUpdateState: (cb: (s: UpdateState) => void) => listen<UpdateState>('update:state', cb),
  onCompactState: (cb: (s: CompactRevealState) => void) => listen<CompactRevealState>('compact:state', cb),
  onWinState: (cb: (s: WindowState) => void) => listen<WindowState>('win:state', cb),
  onFocusMenuBar: (cb: () => void) => listen<void>('menu:focus-bar', () => cb()),
  newTab: (input?: string) => ipcRenderer.send('tab:new', input),
  closeTab: (id: number) => ipcRenderer.send('tab:close', id),
  activate: (id: number) => ipcRenderer.send('tab:activate', id),
  navigate: (id: number, input: string) => ipcRenderer.send('tab:navigate', id, input),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: () => ipcRenderer.send('nav:reload'),
  stop: () => ipcRenderer.send('nav:stop'),
  resetZoom: () => ipcRenderer.send('nav:zoom-reset'),
  togglePin: (id: number) => ipcRenderer.send('tab:pin', id),
  move: (id: number, to: number) => ipcRenderer.send('tab:move', id, to),
  toggleMute: (id: number) => ipcRenderer.send('tab:mute', id),
  sleepTab: (id: number) => ipcRenderer.send('tab:sleep', id),
  tabMenu: (id: number) => ipcRenderer.send('tab:menu', id),
  splitWith: (anchorId: number, otherId: number, placement?: SplitPlacement) =>
    ipcRenderer.send('split:with', anchorId, otherId, placement),
  splitDrop: (draggedTabId: number, placement: SplitPlacement) =>
    ipcRenderer.send('split:drop', draggedTabId, placement),
  splitWithNext: (orientation?: SplitOrientation) => ipcRenderer.send('split:next', orientation),
  rotateSplit: (groupId?: string) => ipcRenderer.send('split:rotate', groupId),
  unsplit: (tabId?: number) => ipcRenderer.send('split:unsplit', tabId),
  swapSplit: (groupId: string) => ipcRenderer.send('split:swap', groupId),
  switchWorkspace: (id: string) => ipcRenderer.send('workspace:switch', id),
  createWorkspace: (input: WorkspaceCreateInput) => ipcRenderer.invoke('workspace:create', input),
  updateWorkspace: (id: string, patch: WorkspaceUpdateInput) => ipcRenderer.invoke('workspace:update', id, patch),
  deleteWorkspace: (id: string) => ipcRenderer.invoke('workspace:delete', id),
  setCompactPin: (kind: CompactPinKind, pinned: boolean) => ipcRenderer.send('compact:pin', kind, pinned),
  setCompactHover: (edge: CompactEdgeKind, hovering: boolean) => ipcRenderer.send('compact:hover', edge, hovering),
  toggleCompactMode: () => ipcRenderer.send('compact:toggle'),
  pauseDownload: (id: number) => ipcRenderer.send('download:pause', id),
  resumeDownload: (id: number) => ipcRenderer.send('download:resume', id),
  cancelDownload: (id: number) => ipcRenderer.send('download:cancel', id),
  openDownload: (id: number) => ipcRenderer.send('download:open', id),
  showDownload: (id: number) => ipcRenderer.send('download:show', id),
  removeDownload: (id: number) => ipcRenderer.send('download:remove', id),
  dragDownload: (id: number) => ipcRenderer.send('download:drag', id),
  clearFinishedDownloads: () => ipcRenderer.send('download:clear'),
  suggest: (input: string) => ipcRenderer.invoke('suggest', input),
  history: (query: string, before: number | null) => ipcRenderer.invoke('history:list', query, before),
  bookmarks: () => ipcRenderer.invoke('bookmarks:list'),
  toggleBookmark: () => ipcRenderer.send('bookmark:toggle'),
  toggleBookmarkBar: () => ipcRenderer.send('bookmark-bar:toggle'),
  addBookmark: (url: string, title: string, folder?: string) => ipcRenderer.invoke('bookmark:add', url, title, folder),
  removeBookmark: (url: string) => ipcRenderer.invoke('bookmark:remove', url),
  renameBookmark: (url: string, title: string, folder?: string) => ipcRenderer.invoke('bookmark:rename', url, title, folder),
  reorderBookmarks: (order: { url: string; position: number }[]) => ipcRenderer.invoke('bookmark:reorder', order),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.send('update:install'),
  dismissJustUpdated: () => ipcRenderer.send('update:dismiss-just-updated'),
  reopenClosedTab: () => ipcRenderer.send('tab:reopen'),
  print: () => ipcRenderer.send('tab:print'),
  zoomIn: () => ipcRenderer.send('nav:zoom-in'),
  zoomOut: () => ipcRenderer.send('nav:zoom-out'),
  toggleDevTools: () => ipcRenderer.send('tab:devtools'),
  toggleDownloads: () => ipcRenderer.send('downloads:toggle'),
  openFind: () => ipcRenderer.send('find:open'),
  openPalette: (mode?: 'command' | 'new-tab') => ipcRenderer.send('palette:open-request', mode),
  openInternal: (url: string) => ipcRenderer.send('tab:open-internal', url),
  winCmd: (cmd: string) => ipcRenderer.send('win:cmd', cmd),
  menu: {
    open: (spec: unknown) => ipcRenderer.send('menu:open', spec),
    close: () => ipcRenderer.send('menu:close'),
    onPicked: (cb: (id: string) => void) => listen<string>('menu:picked', cb),
    onClosed: (cb: () => void) => listen<void>('menu:closed', () => cb()),
    onStep: (cb: (by: -1 | 1) => void) => listen<-1 | 1>('menu:step', cb)
  },
  extensions: {
    onActions: (cb: (actions: ExtensionActionView[]) => void) => listen<ExtensionActionView[]>('extensions:actions', cb),
    getActions: () => ipcRenderer.invoke('extensions:get-actions') as Promise<ExtensionActionView[]>,
    setPinned: (id: string, pinned: boolean) => ipcRenderer.invoke('extensions:set-pinned', id, pinned) as Promise<boolean>,
    clickAction: (id: string, anchorRect: Rect) => ipcRenderer.send('extensions:action-click', id, anchorRect),
    contextMenuAction: (id: string, anchorRect: Rect) => ipcRenderer.send('extensions:action-context-menu', id, anchorRect)
  }
}

const panelApi: VeyraCompactPanelApi = {
  ready: () => ipcRenderer.send('compact-panel:ready'),
  onVisible: (cb) => listen<boolean>('compact-panel:visible', cb),
  onNewWorkspace: (cb) => listen<void>('ui:new-workspace', () => cb()),
  onResetTransient: (cb) => listen<void>('compact-panel:reset-transient', () => cb()),
  requestNewWorkspace: () => ipcRenderer.send('compact-panel:new-workspace'),
  openSettingsSection: (sectionId) => ipcRenderer.send('compact-panel:settings-section', sectionId),
  setOmniboxOpen: (open) => ipcRenderer.send('compact-panel:omnibox-open', open),
  startWindowDrag: () => ipcRenderer.send('compact-panel:drag-start'),
  moveWindowDrag: () => ipcRenderer.send('compact-panel:drag-move'),
  endWindowDrag: () => ipcRenderer.send('compact-panel:drag-end'),
  startTabDrag: (tabId: number) => ipcRenderer.send('compact-panel:tab-drag-start', tabId),
  endTabDrag: () => ipcRenderer.send('compact-panel:tab-drag-end')
}

contextBridge.exposeInMainWorld('veyra', uiSubset)
contextBridge.exposeInMainWorld('veyraCompactPanel', panelApi)
