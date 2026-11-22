import { useEffect, useRef, useState } from 'react'
import { RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import type {
  ClearDataRange,
  NewTabBehavior,
  SettingsPatch,
  SettingsView,
  SitePermission,
  SleepMinutes,
  StartupBehavior,
  UpdateState
} from '@shared/types'
import { SEARCH_ENGINES } from '@shared/settings'
import { SLEEP_MINUTES_OPTIONS } from '@shared/sleep'
import { pickActiveSection } from '@shared/compact'
import { permissionName } from '@shared/permissions'
import { ImportSection } from './ImportCard'
import { SegmentedControl, type SegmentedOption } from './SegmentedControl'
import { SettingsAppearance } from './SettingsAppearance'
import { SettingsExtensions } from './SettingsExtensions'
import { SettingsPerformanceMemory } from './SettingsPerformance'

const api = window.veyra

const STARTUP_OPTIONS: { id: StartupBehavior; label: string; detail: string }[] = [
  { id: 'restore', label: "Reopen last session's tabs", detail: 'Pick up where you left off. Restored tabs load only when you open them.' },
  { id: 'new-tab', label: 'Start with a new tab', detail: 'Open a clean start page each time Orbit launches.' }
]

const NEW_TAB_OPTIONS: { id: NewTabBehavior; label: string; detail: string }[] = [
  { id: 'start-page', label: 'Start page', detail: 'Open a fresh start page with the greeting and search bar.' },
  { id: 'command-bar', label: 'Command bar', detail: 'Open the floating Ctrl+K command bar in new-tab mode.' }
]

const SLEEP_LABELS: Record<SleepMinutes, string> = {
  0: 'Off',
  5: '5 min',
  15: '15 min',
  30: '30 min',
  60: '60 min',
  120: '120 min'
}

const CLEAR_RANGES: readonly SegmentedOption<ClearDataRange>[] = [
  { value: 'hour', label: 'Last hour' },
  { value: 'day', label: 'Last day' },
  { value: 'all', label: 'All time' }
]

const SLEEP_OPTIONS: readonly SegmentedOption<SleepMinutes>[] = SLEEP_MINUTES_OPTIONS.map((mins) => ({
  value: mins,
  label: SLEEP_LABELS[mins]
}))

const PERM_OPTIONS: readonly SegmentedOption<'allow' | 'block'>[] = [
  { value: 'allow', label: 'Allow', tone: 'allow' },
  { value: 'block', label: 'Block', tone: 'block' }
]

const SETTING_SECTIONS = [
  { id: 'set-general', label: 'General' },
  { id: 'set-import', label: 'Import data' },
  { id: 'set-appearance', label: 'Appearance' },
  { id: 'set-performance', label: 'Performance' },
  { id: 'set-downloads', label: 'Downloads' },
  { id: 'set-privacy', label: 'Privacy & data' },
  { id: 'set-permissions', label: 'Site permissions' },
  { id: 'set-extensions', label: 'Extensions' },
  { id: 'set-updates', label: 'Updates' }
]

function displayOrigin(origin: string): string {
  try {
    const u = new URL(origin)
    return u.protocol === 'https:' ? u.host : `${u.protocol}//${u.host}`
  } catch {
    return origin
  }
}

function updateStatusText(u: UpdateState): string {
  switch (u.status) {
    case 'checking':
      return 'Checking for updates…'
    case 'downloading':
      return u.availableVersion
        ? `Downloading ${u.availableVersion}… ${u.progress ?? 0}%`
        : `Downloading update… ${u.progress ?? 0}%`
    case 'ready':
      return u.availableVersion ? `Update ${u.availableVersion} ready — restart to update.` : 'Update ready — restart to update.'
    case 'up-to-date':
      return 'Up to date.'
    case 'unavailable':
      return u.note || 'Updates are only checked in installed builds.'
    case 'error':
      return u.note || "Couldn't check for updates right now."
    default:
      return 'Checks automatically in the background.'
  }
}

export function SettingsPage({ settings: initial, update: initialUpdate }: { settings: SettingsView | null; update: UpdateState | null }): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsView | null>(initial)
  const [update, setUpdate] = useState<UpdateState | null>(initialUpdate)
  const [savedPerms, setSavedPerms] = useState<SitePermission[]>([])
  const [range, setRange] = useState<ClearDataRange>('hour')
  const [clearHistory, setClearHistory] = useState(true)
  const [clearSiteData, setClearSiteData] = useState(true)
  const [clearCache, setClearCache] = useState(true)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearDone, setClearDone] = useState(false)
  const [activeSection, setActiveSection] = useState(SETTING_SECTIONS[0].id)
  const rootRef = useRef<HTMLDivElement>(null)
  const loaded = settings !== null

  useEffect(() => {
    if (!loaded) return
    const root = rootRef.current
    if (!root) return

    let raf = 0
    const updateActive = (): void => {
      raf = 0
      const rootTop = root.getBoundingClientRect().top
      const items = SETTING_SECTIONS.map(({ id }) => {
        const el = document.getElementById(id)
        return el ? { id, top: el.getBoundingClientRect().top - rootTop } : null
      }).filter((x): x is { id: string; top: number } => x !== null)
      const picked = pickActiveSection(items, root.scrollTop, root.clientHeight, root.scrollHeight, 56)
      if (picked) setActiveSection(picked)
    }

    const onScroll = (): void => {
      if (!raf) raf = requestAnimationFrame(updateActive)
    }

    updateActive()
    root.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      root.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [loaded, savedPerms.length])

  useEffect(() => {
    if (initial) setSettings(initial)
  }, [initial])

  useEffect(() => {
    if (initialUpdate) setUpdate(initialUpdate)
  }, [initialUpdate])

  useEffect(() => {
    void api.getSettings().then((s) => s && setSettings(s))
    void api.getUpdateState().then((u) => u && setUpdate(u))
    void api.savedPermissions().then(setSavedPerms)
    const offSettings = api.onSettings(setSettings)
    const offUpdate = api.onUpdateState(setUpdate)
    const offPerms = api.onSavedPermissions(setSavedPerms)
    return () => {
      offSettings()
      offUpdate()
      offPerms()
    }
  }, [])

  useEffect(() => {
    if (!clearDone) return
    const timer = setTimeout(() => setClearDone(false), 4000)
    return () => clearTimeout(timer)
  }, [clearDone])

  useEffect(() => {
    if (!loaded) return
    const scrollTo = (id: string | null): void => {
      if (!id) return
      const el = document.getElementById(id)
      if (el) {
        setActiveSection(id)
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    const pending = sessionStorage.getItem('orbit.settingsSection')
    if (pending) {
      sessionStorage.removeItem('orbit.settingsSection')
      requestAnimationFrame(() => scrollTo(pending))
    }
    const onJump = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail
      sessionStorage.removeItem('orbit.settingsSection')
      scrollTo(id)
    }
    window.addEventListener('orbit:settings-section', onJump)
    return () => window.removeEventListener('orbit:settings-section', onJump)
  }, [loaded])

  const patch = (next: SettingsPatch): void => {
    void api.updateSettings(next).then((s) => s && setSettings(s))
  }

  const chooseFolder = (): void => {
    void api.chooseDownloadsDir().then((s) => s && setSettings(s))
  }

  const jumpToSection = (e: React.MouseEvent<HTMLAnchorElement>, id: string): void => {
    e.preventDefault()
    setActiveSection(id)
    const el = document.getElementById(id)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const nothingSelected = !clearHistory && !clearSiteData && !clearCache

  const runClear = async (): Promise<void> => {
    if (nothingSelected || clearing) return
    setClearing(true)
    try {
      await api.clearBrowsingData({
        range,
        history: clearHistory,
        siteData: clearSiteData,
        cache: clearCache
      })
      setConfirmClear(false)
      setClearDone(true)
    } finally {
      setClearing(false)
    }
  }

  if (!settings) {
    return (
      <div className="lib settings" ref={rootRef}>
        <header className="lib-head">
          <h1>Settings</h1>
        </header>
      </div>
    )
  }

  return (
    <div className="lib settings" ref={rootRef}>
      <header className="lib-head">
        <h1>Settings</h1>
      </header>

      <div className="set-main-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {SETTING_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={activeSection === section.id ? 'on' : ''}
              aria-current={activeSection === section.id ? 'location' : undefined}
              onClick={(e) => jumpToSection(e, section.id)}
            >
              {section.label}
            </a>
          ))}
        </nav>
        <div className="set-content">
          <section className="set-section" id="set-general" aria-labelledby="set-search-h">
            <h2 id="set-search-h">Search engine</h2>
            <div className="set-card">
              <div className="set-row stack">
                <div className="set-row-info">
                  <div className="set-label">Address bar search</div>
                  <div className="set-desc">Used when you search from the address bar, start page, or right-click menu.</div>
                </div>
                <div className="set-pills" role="radiogroup" aria-label="Search engine">
                  {SEARCH_ENGINES.map((engine) => (
                    <button
                      key={engine.id}
                      role="radio"
                      aria-checked={settings.searchEngine === engine.id}
                      className={`set-pill ${settings.searchEngine === engine.id ? 'on' : ''}`}
                      onClick={() => patch({ searchEngine: engine.id })}
                    >
                      {engine.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="set-section" aria-labelledby="set-startup-h">
            <h2 id="set-startup-h">On start</h2>
            <div className="set-card" role="radiogroup" aria-label="On start">
              {STARTUP_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  role="radio"
                  aria-checked={settings.startup === opt.id}
                  className={`set-row set-choice ${settings.startup === opt.id ? 'on' : ''}`}
                  onClick={() => patch({ startup: opt.id })}
                >
                  <span className="set-radio" aria-hidden />
                  <div className="set-row-info">
                    <div className="set-label">{opt.label}</div>
                    <div className="set-desc">{opt.detail}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="set-section" aria-labelledby="set-newtab-h">
            <h2 id="set-newtab-h">New tab opens</h2>
            <div className="set-card" role="radiogroup" aria-label="New tab opens">
              {NEW_TAB_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  role="radio"
                  aria-checked={settings.newTabBehavior === opt.id}
                  className={`set-row set-choice ${settings.newTabBehavior === opt.id ? 'on' : ''}`}
                  onClick={() => patch({ newTabBehavior: opt.id })}
                >
                  <span className="set-radio" aria-hidden />
                  <div className="set-row-info">
                    <div className="set-label">{opt.label}</div>
                    <div className="set-desc">{opt.detail}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
          <ImportSection />

          <SettingsAppearance settings={settings} onPatch={patch} onSettingsReplaced={setSettings} />

          <section className="set-section" id="set-performance" aria-labelledby="set-performance-h">
            <h2 id="set-performance-h">Performance</h2>
            <div className="set-card">
              <div className="set-row stack">
                <div className="set-row-info">
                  <div className="set-label">Sleep inactive tabs</div>
                  <div className="set-desc">
                    Discard background tabs to free memory after they sit unused. Active tabs, audio, camera/mic/screen capture, unsaved form text, prompts, find, and full-screen tabs never sleep.
                  </div>
                </div>
                <SegmentedControl
                  options={SLEEP_OPTIONS}
                  value={settings.sleepAfterMinutes}
                  onChange={(mins) => patch({ sleepAfterMinutes: mins })}
                  ariaLabel="Sleep inactive tabs after"
                />
              </div>
              <div className="set-row">
                <div className="set-row-info">
                  <div className="set-label">Sleep pinned tabs</div>
                  <div className="set-desc">Allow pinned tabs to sleep automatically when inactive.</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.sleepPinnedTabs}
                  aria-label="Sleep pinned tabs"
                  className={`set-switch ${settings.sleepPinnedTabs ? 'on' : ''}`}
                  onClick={() => patch({ sleepPinnedTabs: !settings.sleepPinnedTabs })}
                >
                  <span className="set-switch-thumb" />
                </button>
              </div>
            </div>
            <SettingsPerformanceMemory />
          </section>

          <section className="set-section" id="set-downloads" aria-labelledby="set-downloads-h">
            <h2 id="set-downloads-h">Downloads</h2>
            <div className="set-card">
              <div className="set-row">
                <div className="set-row-info">
                  <div className="set-label">Downloads folder</div>
                  <div className="set-path" title={settings.effectiveDownloadsDir}>
                    {settings.effectiveDownloadsDir}
                  </div>
                  {settings.downloadsOverridden && <div className="set-note">Overridden by VEYRA_DOWNLOADS for this session.</div>}
                </div>
                <div className="set-row-actions">
                  {settings.downloadsDir && !settings.downloadsOverridden && (
                    <button className="icon-btn small" title="Reset to default folder" aria-label="Reset to default folder" onClick={() => patch({ downloadsDir: '' })}>
                      <RotateCcw size={14} />
                    </button>
                  )}
                  <button className="btn" onClick={chooseFolder} disabled={settings.downloadsOverridden}>
                    Choose…
                  </button>
                </div>
              </div>
              <div className="set-row">
                <div className="set-row-info">
                  <div className="set-label">Ask where to save each file</div>
                  <div className="set-desc">Show a save dialog before downloading instead of saving straight to the folder above.</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.askWhereToSave}
                  aria-label="Ask where to save each file"
                  className={`set-switch ${settings.askWhereToSave ? 'on' : ''}`}
                  onClick={() => patch({ askWhereToSave: !settings.askWhereToSave })}
                >
                  <span className="set-switch-thumb" />
                </button>
              </div>
            </div>
          </section>

          <section className="set-section" id="set-privacy" aria-labelledby="set-privacy-h">
            <h2 id="set-privacy-h">Privacy</h2>
            <div className="set-card">
              <div className="set-row stack">
                <div className="set-row-top">
                  <div className="set-row-info">
                    <div className="set-label">Clear browsing data</div>
                    <div className="set-desc">Remove history, cookies, site storage, or cached files from this profile.</div>
                  </div>
                  <SegmentedControl
                    options={CLEAR_RANGES}
                    value={range}
                    onChange={(next) => {
                      setRange(next)
                      setClearDone(false)
                    }}
                    ariaLabel="Time range"
                  />
                </div>

                <div className="set-checks">
                  <label className="set-check">
                    <input
                      type="checkbox"
                      checked={clearHistory}
                      onChange={(e) => {
                        setClearHistory(e.target.checked)
                        setConfirmClear(false)
                        setClearDone(false)
                      }}
                    />
                    <span>Browsing history</span>
                  </label>
                  <label className="set-check">
                    <input
                      type="checkbox"
                      checked={clearSiteData}
                      onChange={(e) => {
                        setClearSiteData(e.target.checked)
                        setConfirmClear(false)
                        setClearDone(false)
                      }}
                    />
                    <span>Cookies and site data</span>
                  </label>
                  <label className="set-check">
                    <input
                      type="checkbox"
                      checked={clearCache}
                      onChange={(e) => {
                        setClearCache(e.target.checked)
                        setConfirmClear(false)
                        setClearDone(false)
                      }}
                    />
                    <span>Cached files</span>
                  </label>
                </div>

                {range !== 'all' && (clearSiteData || clearCache) && (
                  <div className="set-note">Time range applies to history. Cookies, site data, and cached files are cleared for all time.</div>
                )}

                <div className="set-clear-bar">
                  {confirmClear ? (
                    <div className="set-confirm" role="group" aria-label="Confirm clearing browsing data">
                      <span>Clear the selected data?</span>
                      <button className="btn" onClick={() => setConfirmClear(false)} disabled={clearing}>
                        Cancel
                      </button>
                      <button className="btn danger" onClick={() => void runClear()} disabled={clearing}>
                        {clearing ? 'Clearing…' : 'Clear data'}
                      </button>
                    </div>
                  ) : (
                    <>
                      <button className="btn" onClick={() => setConfirmClear(true)} disabled={nothingSelected}>
                        Clear browsing data…
                      </button>
                      {clearDone && <span className="set-status">Browsing data cleared.</span>}
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="set-section" id="set-permissions" aria-labelledby="set-perms-h">
            <h2 id="set-perms-h">Site permissions</h2>
            <div className="set-card">
              {savedPerms.length === 0 ? (
                <div className="set-empty">
                  No saved site permissions yet. Remembered decisions from permission prompts appear here.
                </div>
              ) : (
                <ul className="set-perms">
                  {savedPerms.map((p) => (
                    <li key={`${p.origin}|${p.permission}`} className="set-row">
                      <div className="set-row-info">
                        <div className="set-label" title={p.origin}>
                          {displayOrigin(p.origin)}
                        </div>
                        <div className="set-desc">{permissionName(p.permission)}</div>
                      </div>
                      <div className="set-row-actions">
                        <SegmentedControl
                          compact
                          options={PERM_OPTIONS}
                          value={p.allow ? 'allow' : 'block'}
                          onChange={(val) => void api.setSavedPermission(p.origin, p.permission, val === 'allow')}
                          ariaLabel={`${permissionName(p.permission)} for ${displayOrigin(p.origin)}`}
                        />
                        <button
                          className="icon-btn small"
                          aria-label={`Remove ${permissionName(p.permission)} permission for ${displayOrigin(p.origin)}`}
                          title="Remove saved decision"
                          onClick={() => void api.removeSavedPermission(p.origin, p.permission)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <SettingsExtensions />

          <section className="set-section" id="set-updates" aria-labelledby="set-updates-h">
            <h2 id="set-updates-h">Updates</h2>
            <div className="set-card">
              <div className="set-row">
                <div className="set-row-info">
                  <div className="set-label">
                    {__CHANNEL__ === 'dev' ? 'Veyra Orbit Dev' : 'Veyra Orbit'}
                    {update?.currentVersion && <span className="set-version">Version {update.currentVersion}</span>}
                  </div>
                  <div className={`set-desc ${update?.status === 'ready' ? 'set-update-ready' : ''}`}>
                    {update ? updateStatusText(update) : 'Loading update status…'}
                  </div>
                </div>
                <div className="set-row-actions">
                  {update?.status === 'ready' ? (
                    <button type="button" className="btn primary" onClick={() => api.installUpdate()}>
                      Restart
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn set-icon-btn"
                      disabled={!update || update.status === 'checking' || update.status === 'downloading' || update.status === 'unavailable'}
                      onClick={() => void api.checkForUpdates()}
                    >
                      <RefreshCw size={14} className={update?.status === 'checking' ? 'spin' : undefined} aria-hidden />
                      <span>{update?.status === 'checking' ? 'Checking…' : 'Check for updates'}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
