/*
 * Download manager for the web session. Files save automatically to the configured Downloads folder
 * with unique names ("file (1).pdf"), or prompt via a save dialog when "Ask where to save each file"
 * is enabled. Progress is pushed to the sidebar UI, and files are never opened automatically.
 */
import { app, nativeImage, shell, type DownloadItem, type Event, type NativeImage, type Session, type WebContents } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { DownloadInfo, DownloadState } from '../shared/types'
import { isRunnable, pickUniqueFilename } from '../shared/downloads'

export interface DownloadConfig {
  dir: string
  askWhereToSave: boolean
}

interface TrackedDownload {
  info: DownloadInfo
  item: DownloadItem | null
  fileIcon: NativeImage | null
}

const PROGRESS_THROTTLE_MS = 120

/** 16x16 subtle file glyph PNG fallback for native drag-out when an OS file icon isn't cached yet. */
const FALLBACK_DRAG_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWElEQVR4nGNgGAWjgP6A8T8DAwMDExMTEzMUMDAw/P//H6IJJMD4//9/mAYkA0A24DMg4P///2A2PjUwA5ANIGQArAEwGxC6gI2NjQlFMRMTExMjIyMpBgAA4/8P9W5m4zYAAAAASUVORK5CYII='

let cachedFallbackDragIcon: NativeImage | null = null
function fallbackDragIcon(): NativeImage {
  if (!cachedFallbackDragIcon) {
    cachedFallbackDragIcon = nativeImage.createFromDataURL(FALLBACK_DRAG_ICON_DATA_URL)
  }
  return cachedFallbackDragIcon
}

export class Downloads {
  private nextId = 1
  private items: TrackedDownload[] = []
  private inFlight = new Set<string>()
  private attached = new Set<Session>()
  private emitTimer: NodeJS.Timeout | null = null
  private lastEmit = 0

  private readonly onWillDownload = (e: Event, item: DownloadItem): void => {
    if (e.defaultPrevented) return
    this.handle(item)
  }

  constructor(
    private readonly getConfig: () => DownloadConfig,
    private readonly publish: (items: DownloadInfo[]) => void
  ) {}

  attach(sess: Session): void {
    if (this.attached.has(sess)) return
    this.attached.add(sess)
    sess.on('will-download', this.onWillDownload)
  }

  detachSession(sess: Session): void {
    if (!this.attached.delete(sess)) return
    sess.off('will-download', this.onWillDownload)
  }

  detach(): void {
    for (const sess of this.attached) {
      sess.off('will-download', this.onWillDownload)
    }
    this.attached.clear()
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
  }

  list(): DownloadInfo[] {
    return this.items.map((entry) => ({ ...entry.info }))
  }

  /** Records a file saved directly by Orbit (such as a screenshot PNG) in the Downloads list. */
  recordSavedFile(savePath: string, sizeBytes: number, sourceUrl = ''): DownloadInfo {
    const cleanPath = resolve(savePath)
    const filename = basename(cleanPath) || 'Screenshot.png'
    const safeBytes = Number.isFinite(sizeBytes) && sizeBytes >= 0 ? Math.round(sizeBytes) : 0
    const entry: TrackedDownload = {
      item: null,
      fileIcon: null,
      info: {
        id: this.nextId++,
        filename,
        savePath: cleanPath,
        url: sourceUrl,
        state: 'completed',
        receivedBytes: safeBytes,
        totalBytes: safeBytes,
        speed: 0,
        canResume: false,
        startedAt: Date.now()
      }
    }
    this.items.unshift(entry)
    void app
      .getFileIcon(cleanPath, { size: 'normal' })
      .then((img) => {
        if (!img.isEmpty()) entry.fileIcon = img
      })
      .catch(() => {
        /* fallback icon will be used */
      })
    this.emitNow()
    return { ...entry.info }
  }

  private handle(item: DownloadItem): void {
    const { dir, askWhereToSave } = this.getConfig()
    const baseDir = resolve(dir)
    try {
      mkdirSync(baseDir, { recursive: true })
    } catch {
      /* Electron will also attempt to create the folder on setSavePath */
    }

    const filename = pickUniqueFilename(item.getFilename(), (name) => {
      const candidate = join(baseDir, name)
      return this.inFlight.has(candidate.toLowerCase()) || existsSync(candidate)
    })
    const suggestedPath = join(baseDir, filename)
    let inFlightKey: string | null = null

    if (askWhereToSave) {
      item.setSaveDialogOptions({ defaultPath: suggestedPath })
    } else {
      inFlightKey = suggestedPath.toLowerCase()
      this.inFlight.add(inFlightKey)
      item.setSavePath(suggestedPath)
    }

    const entry: TrackedDownload = {
      item,
      fileIcon: null,
      info: {
        id: this.nextId++,
        filename,
        savePath: askWhereToSave ? '' : suggestedPath,
        url: item.getURL(),
        state: 'progressing',
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        speed: 0,
        canResume: false,
        startedAt: Date.now()
      }
    }
    this.items.unshift(entry)
    this.emitNow()

    const syncSavePath = (): void => {
      const actual = item.getSavePath()
      if (!actual) return
      entry.info.savePath = actual
      const actualName = basename(actual)
      if (actualName) entry.info.filename = actualName
      if (!inFlightKey) {
        inFlightKey = actual.toLowerCase()
        this.inFlight.add(inFlightKey)
      }
    }

    item.on('updated', (_e, state) => {
      if (!entry.info.savePath) syncSavePath()
      const prevState = entry.info.state
      const nextState: DownloadState = state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'
      entry.info.state = nextState
      entry.info.receivedBytes = item.getReceivedBytes()
      entry.info.totalBytes = item.getTotalBytes()
      entry.info.canResume = item.canResume()
      entry.info.speed = nextState === 'progressing' ? item.getCurrentBytesPerSecond() : 0
      if (nextState !== prevState) this.emitNow()
      else this.emitThrottled()
    })

    item.once('done', (_e, state) => {
      if (!entry.info.savePath) syncSavePath()
      if (inFlightKey) this.inFlight.delete(inFlightKey)
      entry.info.state = state
      entry.info.receivedBytes = item.getReceivedBytes()
      const total = item.getTotalBytes()
      entry.info.totalBytes = total > 0 ? total : state === 'completed' ? entry.info.receivedBytes : 0
      entry.info.speed = 0
      entry.info.canResume = false
      entry.item = null
      if (state === 'completed' && entry.info.savePath) {
        void app
          .getFileIcon(entry.info.savePath, { size: 'normal' })
          .then((img) => {
            if (!img.isEmpty()) entry.fileIcon = img
          })
          .catch(() => {
            /* fallback icon will be used */
          })
      }
      this.emitNow()
    })
  }

  private get(id: number): TrackedDownload | undefined {
    return this.items.find((entry) => entry.info.id === id)
  }

  pause(id: number): void {
    const entry = this.get(id)
    if (!entry?.item || entry.info.state !== 'progressing' || entry.item.isPaused()) return
    entry.item.pause()
    entry.info.state = 'paused'
    entry.info.speed = 0
    entry.info.canResume = entry.item.canResume()
    this.emitNow()
  }

  resume(id: number): void {
    const entry = this.get(id)
    if (!entry?.item || !entry.item.canResume()) return
    entry.item.resume()
    entry.info.state = 'progressing'
    this.emitNow()
  }

  cancel(id: number): void {
    const entry = this.get(id)
    if (!entry?.item) return
    entry.item.cancel()
  }

  open(id: number): void {
    const entry = this.get(id)
    if (!entry || entry.info.state !== 'completed' || !existsSync(entry.info.savePath)) return
    // A downloaded program or script never runs from one click here: it's shown in its folder instead.
    if (isRunnable(entry.info.filename)) shell.showItemInFolder(entry.info.savePath)
    else void shell.openPath(entry.info.savePath)
  }

  show(id: number): void {
    const entry = this.get(id)
    if (!entry || !entry.info.savePath || !existsSync(entry.info.savePath)) return
    shell.showItemInFolder(entry.info.savePath)
  }

  /** Removes one finished download from the list without touching the file on disk. */
  remove(id: number): void {
    const entry = this.get(id)
    if (!entry || entry.item !== null) return
    this.items = this.items.filter((e) => e.info.id !== id)
    this.emitNow()
  }

  /**
   * Starts a native OS file drag for a completed download tracked by Orbit.
   * Only files Orbit actually downloaded (looked up by ID in main) are permitted.
   */
  startDrag(id: number, sender: WebContents): boolean {
    if (sender.isDestroyed()) return false
    const entry = this.get(id)
    if (!entry || entry.info.state !== 'completed' || !entry.info.savePath || !existsSync(entry.info.savePath)) {
      return false
    }
    const icon = entry.fileIcon && !entry.fileIcon.isEmpty() ? entry.fileIcon : fallbackDragIcon()
    try {
      sender.startDrag({ file: entry.info.savePath, icon })
      return true
    } catch {
      return false
    }
  }

  clearFinished(): void {
    const before = this.items.length
    this.items = this.items.filter((entry) => entry.item !== null)
    if (this.items.length !== before) this.emitNow()
  }

  private emitNow(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    this.lastEmit = Date.now()
    this.publish(this.list())
  }

  private emitThrottled(): void {
    const wait = PROGRESS_THROTTLE_MS - (Date.now() - this.lastEmit)
    if (wait <= 0) {
      this.emitNow()
      return
    }
    if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null
        this.emitNow()
      }, wait)
    }
  }
}
