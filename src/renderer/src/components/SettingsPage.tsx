import { useEffect, useState } from 'react'
import { FolderOpen, Monitor, Moon, RefreshCw, RotateCcw, Shield, Sun, Trash2 } from 'lucide-react'
import type { ClearDataRange, SearchEngineId, SettingsView, SitePermission, StartupBehavior, ThemeSource, UpdateState } from '@shared/types'
import { SEARCH_ENGINES } from '@shared/settings'
import { permissionName } from '@shared/permissions'

const api = window.veyra

const THEMES: { id: ThemeSource; label: string; icon: typeof Monitor }[] = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon }
]

const STARTUP_OPTIONS: { id: StartupBehavior; label: string; detail: string }[] = [
  { id: 'restore', label: "Reopen last session's tabs", detail: 'Pick up where you left off. Restored tabs load only when you open them.' },
  { id: 'new-tab', label: 'Start with a new tab', detail: 'Open a clean start page each time Orbit launches.' }
]

const CLEAR_RANGES: { id: ClearDataRange; label: string }[] = [
  { id: 'hour', label: 'Last hour' },
  { id: 'day', label: 'Last day' },
  { id: 'all', label: 'All time' }
]

const SETTING_SECTIONS = [
  { id: 'set-general', label: 'General / search & start' },
  { id: 'set-appearance', label: 'Appearance' },
  { id: 'set-downloads', label: 'Downloads' },
  { id: 'set-privacy', label: 'Privacy & data' },
  { id: 'set-permissions', label: 'Site permissions' },
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

  useEffect(() => {
    const root = document.querySelector('.settings')
    const sections = SETTING_SECTIONS.map(({ id }) => document.getElementById(id)).filter((el): el is HTMLElement => !!el)
    if (!root || !sections.length) return
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) setActiveSection(visible[0].target.id)
    }, { root, rootMargin: '-8% 0px -72% 0px', threshold: 0 })
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

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

  const patch = (next: Partial<{ searchEngine: SearchEngineId; theme: ThemeSource; startup: StartupBehavior; downloadsDir: string; askWhereToSave: boolean }>): void => {
    void api.updateSettings(next).then((s) => s && setSettings(s))
  }

  const chooseFolder = (): void => {
    void api.chooseDownloadsDir().then((s) => s && setSettings(s))
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
      <div className="lib settings">
        <header className="lib-head">
          <h1>Settings</h1>
        </header>
      </div>
    )
  }

  return (
    <div className="lib settings">
      <header className="lib-head">
        <h1>Settings</h1>
      </header>

      <div className="set-main-layout">
      <nav className="set-nav" aria-label="Settings sections">
        {SETTING_SECTIONS.map((section) => <a key={section.id} href={`#${section.id}`} className={activeSection === section.id ? 'on' : ''} aria-current={activeSection === section.id ? 'location' : undefined}>{section.label}</a>)}
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

      <section className="set-section" id="set-appearance" aria-labelledby="set-appearance-h">
        <h2 id="set-appearance-h">Appearance</h2>
        <div className="set-card">
          <div className="set-row">
            <div className="set-row-info">
              <div className="set-label">Theme</div>
              <div className="set-desc">Follow your system theme or stay in light or dark mode.</div>
            </div>
            <div className="set-seg" role="radiogroup" aria-label="Theme">
              {THEMES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={settings.theme === id}
                  className={`set-seg-btn ${settings.theme === id ? 'on' : ''}`}
                  onClick={() => patch({ theme: id })}
                >
                  <Icon size={14} aria-hidden />
                  <span>{label}</span>
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
              <button className="btn set-icon-btn" onClick={chooseFolder} disabled={settings.downloadsOverridden}>
                <FolderOpen size={14} aria-hidden />
                <span>Choose…</span>
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
              <div className="set-seg" role="radiogroup" aria-label="Time range">
                {CLEAR_RANGES.map((r) => (
                  <button
                    key={r.id}
                    role="radio"
                    aria-checked={range === r.id}
                    className={`set-seg-btn ${range === r.id ? 'on' : ''}`}
                    onClick={() => {
                      setRange(r.id)
                      setClearDone(false)
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
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
              <Shield size={16} aria-hidden />
              <span>No saved site permissions yet. Answers you remember from the permission bar show up here.</span>
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
                    <div className="set-seg compact" role="radiogroup" aria-label={`${permissionName(p.permission)} for ${displayOrigin(p.origin)}`}>
                      <button
                        role="radio"
                        aria-checked={p.allow}
                        className={`set-seg-btn ${p.allow ? 'on allow' : ''}`}
                        onClick={() => void api.setSavedPermission(p.origin, p.permission, true)}
                      >
                        Allow
                      </button>
                      <button
                        role="radio"
                        aria-checked={!p.allow}
                        className={`set-seg-btn ${!p.allow ? 'on block' : ''}`}
                        onClick={() => void api.setSavedPermission(p.origin, p.permission, false)}
                      >
                        Block
                      </button>
                    </div>
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
