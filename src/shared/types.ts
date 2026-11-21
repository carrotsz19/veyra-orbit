/** One tab as the browser UI sees it. The page itself lives in the main process. */
export interface TabInfo {
  id: number
  /** '' for a new tab that hasn't gone anywhere yet (the UI shows its start page). */
  url: string
  title: string
  favicon?: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  pinned: boolean
  /** Page zoom percentage, e.g. 100 for normal size. */
  zoom: number
  /** Set when the last load failed; the UI shows it in place of the page. */
  error?: { code: number; description: string; url: string }
}

export interface BrowserState {
  tabs: TabInfo[]
  activeId: number | null
}

/** A site asking for something (camera, notifications, ...). Denied unless the person allows it. */
export interface PermissionAsk {
  id: number
  tabId: number | null
  origin: string
  permission: string
}

/** Where the active page sits inside the window, in CSS pixels. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface VeyraApi {
  onState(cb: (s: BrowserState) => void): () => void
  onFocusOmnibox(cb: () => void): () => void
  onPermission(cb: (asks: PermissionAsk[]) => void): () => void
  ready(): void
  newTab(input?: string): void
  closeTab(id: number): void
  activate(id: number): void
  navigate(id: number, input: string): void
  back(): void
  forward(): void
  reload(): void
  stop(): void
  resetZoom(): void
  togglePin(id: number): void
  move(id: number, toIndex: number): void
  setBounds(r: Rect | null): void
  answerPermission(id: number, allow: boolean): void
}
