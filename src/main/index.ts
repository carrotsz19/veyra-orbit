import { app, BrowserWindow, ipcMain, nativeTheme, shell, type IpcMainEvent } from 'electron'
import { join } from 'node:path'
import { release } from 'node:os'
import type { PermissionAsk, Rect } from '../shared/types'
import { toUrl } from '../shared/url'
import { Tabs } from './tabs'
import { Permissions, cleanUserAgent, hardenAll, webSession } from './security'

const APP_NAME = 'Veyra Orbit'
app.setName(APP_NAME)
// `npm run dev` and test runs keep their own profile, never the installed browser's.
if (process.env.VEYRA_USERDATA) app.setPath('userData', process.env.VEYRA_USERDATA)
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'veyra-orbit-dev'))

if (!app.requestSingleInstanceLock()) app.quit()

cleanUserAgent()
hardenAll()

const isWin = process.platform === 'win32'
/** Acrylic needs Windows 11 22H2 (build 22621) or newer. */
const acrylic = isWin && Number(release().split('.')[2] ?? 0) >= 22621
const TITLE_BAR_H = 40

function overlay(): Electron.TitleBarOverlayOptions {
  const dark = nativeTheme.shouldUseDarkColors
  return { color: acrylic ? '#00000000' : dark ? '#15140f' : '#f3f1ec', symbolColor: dark ? '#e9e5dc' : '#2c2a26', height: TITLE_BAR_H }
}

let win: BrowserWindow | null = null
let tabs: Tabs | null = null
let perms: Permissions | null = null
let asks: PermissionAsk[] = []

function createWindow(): void {
  const w = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: APP_NAME,
    icon: join(__dirname, '../../resources/icon.png'),
    autoHideMenuBar: true,
    ...(acrylic ? { backgroundColor: '#00000000', backgroundMaterial: 'acrylic' as const } : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#15140f' : '#f3f1ec' }),
    ...(isWin ? { titleBarStyle: 'hidden' as const, titleBarOverlay: overlay() } : { titleBarStyle: 'hiddenInset' as const }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })
  win = w

  // The browser's own UI never navigates and never opens windows; pages do that in tabs.
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  tabs = new Tabs(w, join(app.getPath('userData'), 'session.json'))
  const t = tabs
  w.webContents.on('before-input-event', (e, input) => {
    if (t.shortcut(input)) e.preventDefault()
  })

  perms = new Permissions(
    (wc) => t.tabIdOf(wc),
    (list) => {
      asks = list
      if (!w.isDestroyed()) w.webContents.send('permissions', list)
    }
  )
  perms.attach(webSession())
  const p = perms
  t.onTabGone = (id) => p.dropTab(id)

  w.once('ready-to-show', () => w.show())
  w.on('close', () => t.save())
  w.on('closed', () => {
    win = null
    tabs = null
  })

  const query = { material: acrylic ? 'acrylic' : 'solid', platform: process.platform }
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
  else void w.loadFile(join(__dirname, '../renderer/index.html'), { query })

  t.restore()
}

/** Only the browser's own UI may call these; pages have no preload and can't reach them anyway. */
function fromUi(e: IpcMainEvent): boolean {
  return !!win && e.sender === win.webContents
}

function on<A extends unknown[]>(channel: string, f: (t: Tabs, ...args: A) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromUi(e) && tabs) f(tabs, ...(args as A))
  })
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): v is string => typeof v === 'string' && v.length < 8192

on('ready', () => {
  if (!win || !tabs) return
  win.webContents.send('state', tabs.state())
  win.webContents.send('permissions', asks)
})
on('tab:new', (t, input?: unknown) => t.create((str(input) && toUrl(input)) || ''))
on('tab:close', (t, id: unknown) => num(id) && t.close(id))
on('tab:activate', (t, id: unknown) => num(id) && t.activate(id))
on('tab:navigate', (t, id: unknown, input: unknown) => num(id) && str(input) && t.navigate(id, input))
on('tab:pin', (t, id: unknown) => num(id) && t.togglePin(id))
on('tab:move', (t, id: unknown, to: unknown) => num(id) && num(to) && t.move(id, to))
on('nav:back', (t) => t.back())
on('nav:forward', (t) => t.forward())
on('nav:reload', (t) => t.reload())
on('nav:stop', (t) => t.stop())
on('nav:zoom-reset', (t) => t.resetZoom())
on('bounds', (t, r: unknown) => {
  const rect = r as Rect | null
  if (rect === null) return t.setBounds(null)
  if (rect && num(rect.x) && num(rect.y) && num(rect.width) && num(rect.height)) t.setBounds(rect)
})
ipcMain.on('permission:answer', (e, id: unknown, allow: unknown) => {
  if (fromUi(e) && num(id)) perms?.answer(id, allow === true)
})

nativeTheme.on('updated', () => {
  if (win && isWin) win.setTitleBarOverlay(overlay())
})

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

// Links to other apps (mailto:, zoommtg:, ...) aren't opened from pages for now.
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', (ev, url) => {
    if (/^mailto:/i.test(url)) {
      ev.preventDefault()
      void shell.openExternal(url)
    }
  })
})

void app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (!win) createWindow()
})
