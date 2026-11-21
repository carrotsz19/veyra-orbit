/*
 * Download manager for the web session. Files save automatically to the user's Downloads folder
 * with unique names ("file (1).pdf"), progress is pushed to the sidebar UI, and files are never
 * opened automatically.
 */
import { shell, type DownloadItem, type Event, type Session } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DownloadInfo, DownloadState } from '../shared/types'
import { isRunnable, pickUniqueFilename } from '../shared/downloads'

interface TrackedDownload {
  info: DownloadInfo
  item: DownloadItem | null
}

const PROGRESS_THROTTLE_MS = 120

export class Downloads {
  private nextId = 1
  private items: TrackedDownload[] = []
  private inFlight = new Set<string>()
  private attached: Session | null = null
  private emitTimer: NodeJS.Timeout | null = null
  private lastEmit = 0

  private readonly onWillDownload = (_e: Event, item: DownloadItem): void => {
    this.handle(item)
  }

  constructor(
    private readonly dir: string,
    private readonly publish: (items: DownloadInfo[]) => void
  ) {}

  attach(sess: Session): void {
    this.detach()
    this.attached = sess
    sess.on('will-download', this.onWillDownload)
  }

  detach(): void {
    if (this.attached) {
      this.attached.off('will-download', this.onWillDownload)
      this.attached = null
    }
    if (this.emitTimer) {
      clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
  }

  list(): DownloadInfo[] {
    return this.items.map((entry) => ({ ...entry.info }))
  }

  private handle(item: DownloadItem): void {
    const baseDir = resolve(this.dir)
    try {
      mkdirSync(baseDir, { recursive: true })
    } catch {
      /* Electron will also attempt to create the folder on setSavePath */
    }

    const filename = pickUniqueFilename(item.getFilename(), (name) => {
      const candidate = join(baseDir, name)
      return this.inFlight.has(candidate.toLowerCase()) || existsSync(candidate)
    })
    const savePath = join(baseDir, filename)
    const key = savePath.toLowerCase()
    this.inFlight.add(key)
    item.setSavePath(savePath)

    const entry: TrackedDownload = {
      item,
      info: {
        id: this.nextId++,
        filename,
        savePath,
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

    item.on('updated', (_e, state) => {
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
      this.inFlight.delete(key)
      entry.info.state = state
      entry.info.receivedBytes = item.getReceivedBytes()
      const total = item.getTotalBytes()
      entry.info.totalBytes = total > 0 ? total : state === 'completed' ? entry.info.receivedBytes : 0
      entry.info.speed = 0
      entry.info.canResume = false
      entry.item = null
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
