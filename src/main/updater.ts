/*
 * Quiet background auto-updater.
 * Checks 10 seconds after launch and every 4 hours while running, downloads updates in the
 * background, and notifies the UI once an update is ready to install on restart.
 * Never forces a restart, never runs unpackaged (npm run dev), and keeps errors quiet.
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { classifyUpdateError, redactSecrets, selectUpdateFeed, type UpdateFeedSelection, type UpdateState } from '../shared/updates'

const START_DELAY_MS = 10_000
const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000

function embeddedDevToken(): string {
  return __CHANNEL__ === 'dev' && typeof __DEV_FEED_TOKEN__ === 'string' ? __DEV_FEED_TOKEN__ : ''
}

export class Updater {
  private current: UpdateState
  private selection: UpdateFeedSelection
  private configured = false
  private startTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private activeCheck: Promise<UpdateState> | null = null

  constructor(private publish: (state: UpdateState) => void) {
    const token = embeddedDevToken()
    this.selection = selectUpdateFeed({
      channel: __CHANNEL__,
      isPackaged: app.isPackaged,
      devFeedToken: token,
      testFeedUrl: process.env.VEYRA_ORBIT_UPDATE_URL,
      disableUpdates: !!process.env.VEYRA_NO_UPDATE
    })
    this.current = {
      status: this.selection.enabled ? 'idle' : 'unavailable',
      channel: __CHANNEL__,
      currentVersion: app.getVersion(),
      note: this.unavailableNote()
    }
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
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false
    if (this.selection.forceDevUpdateConfig) autoUpdater.forceDevUpdateConfig = true
    autoUpdater.setFeedURL(this.selection.feed)
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

  check(manual = false): Promise<UpdateState> {
    if (!this.selection.enabled) return Promise.resolve(this.state())
    if (this.current.status === 'downloading' || this.current.status === 'ready') return Promise.resolve(this.state())
    if (this.activeCheck) return this.activeCheck
    this.activeCheck = this.runCheck(manual).finally(() => {
      this.activeCheck = null
    })
    return this.activeCheck
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
        status: prevStatus === 'up-to-date' ? 'up-to-date' : 'idle',
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
    if (process.env.VEYRA_ORBIT_UPDATE_DRYRUN) return
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
  }
}
