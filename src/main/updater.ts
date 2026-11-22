/*
 * Quiet background auto-updater.
 * Checks 10 seconds after launch, every 4 hours while running, and on system resume / window focus
 * when the last check is over 4 hours old. Downloads in the background in 'automatic' mode (or waits
 * for explicit user confirmation in 'notify' mode), and notifies the UI once ready to install.
 * Never forces a restart, never runs unpackaged (npm run dev), and keeps errors quiet.
 */
import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { autoUpdater } from 'electron-updater'
import type { UpdateMode } from '../shared/settings'
import {
  UPDATE_CHECK_INTERVAL_MS,
  classifyUpdateError,
  detectJustUpdated,
  redactSecrets,
  selectUpdateFeed,
  shouldAutoDownloadUpdate,
  shouldCheckOnWakeOrFocus,
  type UpdateFeedSelection,
  type UpdateState
} from '../shared/updates'

const START_DELAY_MS = 10_000
const POLL_INTERVAL_MS = UPDATE_CHECK_INTERVAL_MS

function embeddedDevToken(): string {
  return __CHANNEL__ === 'dev' && typeof __DEV_FEED_TOKEN__ === 'string' ? __DEV_FEED_TOKEN__ : ''
}

export interface UpdaterOptions {
  getMode?: () => UpdateMode
  onBeforeInstall?: () => void
  metaFile?: string
}

export class Updater {
  private current: UpdateState
  private selection: UpdateFeedSelection
  private configured = false
  private startTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private activeCheck: Promise<UpdateState> | null = null
  private readonly getMode: () => UpdateMode
  private readonly onBeforeInstall?: () => void

  constructor(
    private publish: (state: UpdateState) => void,
    opts: UpdaterOptions = {}
  ) {
    this.getMode = opts.getMode ?? (() => 'automatic')
    this.onBeforeInstall = opts.onBeforeInstall
    const token = embeddedDevToken()
    this.selection = selectUpdateFeed({
      channel: __CHANNEL__,
      isPackaged: app.isPackaged,
      devFeedToken: token,
      testFeedUrl: process.env.VEYRA_ORBIT_UPDATE_URL,
      disableUpdates: !!process.env.VEYRA_NO_UPDATE
    })
    const currentVersion = app.getVersion()
    const justUpdated = opts.metaFile ? this.detectAndRecordVersion(opts.metaFile, currentVersion) : null
    this.current = {
      status: this.selection.enabled ? 'idle' : 'unavailable',
      channel: __CHANNEL__,
      currentVersion,
      note: this.unavailableNote(),
      ...(justUpdated ? { justUpdated } : {})
    }
  }

  private detectAndRecordVersion(metaFile: string, currentVersion: string) {
    let previousVersion: string | null = null
    try {
      const raw = JSON.parse(readFileSync(metaFile, 'utf8')) as { lastVersion?: unknown }
      if (typeof raw?.lastVersion === 'string') previousVersion = raw.lastVersion
    } catch {
      previousVersion = null
    }
    const notice = detectJustUpdated(previousVersion, currentVersion, __CHANNEL__)
    try {
      mkdirSync(dirname(metaFile), { recursive: true })
      writeFileSync(metaFile, JSON.stringify({ lastVersion: currentVersion }, null, 2) + '\n', 'utf8')
    } catch {
      /* not fatal */
    }
    return notice
  }

  private unavailableNote(): string | undefined {
    if (this.selection.enabled) return undefined
    if (this.selection.reason === 'missing-dev-token') return 'Update checks are skipped because this Dev build has no feed token.'
    if (this.selection.reason === 'disabled') return 'Automatic updates are turned off for this session.'
    return 'Updates are only checked in installed builds.'
  }

  private emit(patch: Partial<UpdateState>): UpdateState {
    this.current = { ...this.current, ...patch }
    this.publish({ ...this.current })
    return this.state()
  }

  private configure(): void {
    if (this.configured || !this.selection.enabled) return
    this.configured = true
    autoUpdater.logger = null
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = this.getMode() === 'automatic'
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false
    if (this.selection.forceDevUpdateConfig) autoUpdater.forceDevUpdateConfig = true
    autoUpdater.setFeedURL(this.selection.feed)
  }

  syncMode(mode: UpdateMode): void {
    if (!this.configured) return
    autoUpdater.autoInstallOnAppQuit = mode === 'automatic' || this.current.status === 'ready'
    if (mode === 'automatic' && this.current.status === 'available' && this.current.availableVersion) {
      void this.download(this.current.availableVersion, false)
    }
  }

  private logError(context: string, err: unknown): void {
    const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    const token = embeddedDevToken()
    console.warn(`[updater] ${context}:`, redactSecrets(raw, token ? [token] : []))
  }

  state(): UpdateState {
    return { ...this.current }
  }

  start(): void {
    if (!this.selection.enabled) return
    this.configure()
    if (!this.startTimer) {
      this.startTimer = setTimeout(() => {
        this.startTimer = null
        void this.check(false)
      }, START_DELAY_MS)
      this.startTimer.unref?.()
    }
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        void this.check(false)
      }, POLL_INTERVAL_MS)
      this.pollTimer.unref?.()
    }
  }

  stop(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer)
      this.startTimer = null
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /** Triggers a quiet background check on system resume or window focus if the last check is > 4 h old. */
  checkIfStale(now = Date.now()): void {
    if (!this.selection.enabled) return
    if (this.current.status === 'checking' || this.current.status === 'downloading' || this.current.status === 'ready') return
    if (this.activeCheck) return
    if (!shouldCheckOnWakeOrFocus(this.current.checkedAt, now)) return
    void this.check(false)
  }

  check(manual = false): Promise<UpdateState> {
    if (!this.selection.enabled) return Promise.resolve(this.state())
    if (this.current.status === 'downloading' || this.current.status === 'ready') return Promise.resolve(this.state())
    if (this.activeCheck) return this.activeCheck
    this.activeCheck = this.runCheck(manual).finally(() => {
      this.activeCheck = null
    })
    return this.activeCheck
  }

  /** Explicitly starts downloading an update discovered in 'notify' mode. */
  downloadAvailable(): Promise<UpdateState> {
    if (!this.selection.enabled) return Promise.resolve(this.state())
    if (this.current.status !== 'available' || !this.current.availableVersion) return Promise.resolve(this.state())
    return this.download(this.current.availableVersion, true).then(() => this.state())
  }

  dismissJustUpdated(): void {
    if (!this.current.justUpdated) return
    this.emit({ justUpdated: null })
  }

  private async runCheck(manual: boolean): Promise<UpdateState> {
    this.configure()
    const prevStatus = this.current.status
    const prevCheckedAt = this.current.checkedAt
    this.emit({ status: 'checking', note: undefined })
    try {
      const result = await autoUpdater.checkForUpdates()
      const info = result?.updateInfo
      if (!result || !info || !result.isUpdateAvailable) {
        return this.emit({
          status: 'up-to-date',
          availableVersion: undefined,
          progress: undefined,
          checkedAt: Date.now(),
          note: undefined
        })
      }
      if (!shouldAutoDownloadUpdate(this.getMode())) {
        return this.emit({
          status: 'available',
          availableVersion: info.version,
          progress: undefined,
          checkedAt: Date.now(),
          note: undefined
        })
      }
      void this.download(info.version, manual)
      return this.state()
    } catch (err) {
      const kind = classifyUpdateError(err)
      if (kind === 'no-release') {
        return this.emit({
          status: 'up-to-date',
          availableVersion: undefined,
          progress: undefined,
          checkedAt: Date.now(),
          note: undefined
        })
      }
      this.logError('check failed', err)
      if (manual) {
        return this.emit({
          status: 'error',
          checkedAt: Date.now(),
          note: kind === 'network' ? "Couldn't reach GitHub. Check your connection." : "Couldn't check for updates right now."
        })
      }
      return this.emit({
        status: prevStatus === 'up-to-date' || prevStatus === 'available' ? prevStatus : 'idle',
        checkedAt: prevCheckedAt,
        note: undefined
      })
    }
  }

  private async download(version: string, manual: boolean): Promise<void> {
    if (this.current.status === 'downloading' || this.current.status === 'ready') return
    this.emit({
      status: 'downloading',
      availableVersion: version,
      progress: 0,
      checkedAt: Date.now(),
      note: undefined
    })
    const onProgress = (p: { percent?: number }): void => {
      const pct = typeof p.percent === 'number' && Number.isFinite(p.percent) ? Math.max(0, Math.min(100, Math.round(p.percent))) : 0
      this.emit({ progress: pct })
    }
    autoUpdater.on('download-progress', onProgress)
    try {
      await autoUpdater.downloadUpdate()
      autoUpdater.autoInstallOnAppQuit = true
      this.emit({
        status: 'ready',
        availableVersion: version,
        progress: 100,
        note: undefined
      })
    } catch (err) {
      this.logError('download failed', err)
      if (manual) {
        this.emit({
          status: 'error',
          availableVersion: undefined,
          progress: undefined,
          note: "Couldn't download the update right now."
        })
      } else {
        this.emit({
          status: 'idle',
          availableVersion: undefined,
          progress: undefined,
          note: undefined
        })
      }
    } finally {
      autoUpdater.removeListener('download-progress', onProgress)
    }
  }

  install(): void {
    if (this.current.status !== 'ready') return
    try {
      this.onBeforeInstall?.()
    } catch {
      /* proceed with install even if session save fails */
    }
    if (process.env.VEYRA_ORBIT_UPDATE_DRYRUN) return
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  }
}
