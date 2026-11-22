import { useCallback, useEffect, useRef, useState } from 'react'
import { Moon } from 'lucide-react'
import type { MemoryUsageSnapshot } from '@shared/types'

const api = window.veyra
const POLL_MS = 2000

function formatMb(mb: number): string {
  return mb >= 1000 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

/**
 * Live memory breakdown inside Settings -> Performance.
 * Polls every ~2 s only while both the section is scrolled into view and the document is visible.
 */
export function SettingsPerformanceMemory(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<MemoryUsageSnapshot | null>(null)
  const [inView, setInView] = useState(true)
  const cardRef = useRef<HTMLDivElement>(null)
  const sleepRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback((): void => {
    void api.getMemoryUsage().then((data) => {
      if (data) setSnapshot(data)
    })
  }, [])

  // Track whether the Memory card is scrolled into view inside the Settings scroll container.
  useEffect(() => {
    const el = cardRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        setInView(entries.some((entry) => entry.isIntersecting))
      },
      { threshold: 0.01 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Initial fetch on mount so the section is ready immediately if scrolled to.
  useEffect(() => {
    refresh()
    return () => {
      if (sleepRefreshTimer.current) clearTimeout(sleepRefreshTimer.current)
    }
  }, [refresh])

  // Refresh every ~2 s ONLY while visible (section in view and window/document not hidden).
  useEffect(() => {
    if (!inView) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = (): void => {
      if (timer || document.hidden) return
      timer = setInterval(refresh, POLL_MS)
    }
    const stop = (): void => {
      if (!timer) return
      clearInterval(timer)
      timer = null
    }
    const onVis = (): void => {
      if (document.hidden) {
        stop()
      } else {
        refresh()
        start()
      }
    }
    if (!document.hidden) {
      refresh()
      start()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [inView, refresh])

  const handleSleep = (tabId: number): void => {
    api.sleepTab(tabId)
    if (sleepRefreshTimer.current) clearTimeout(sleepRefreshTimer.current)
    sleepRefreshTimer.current = setTimeout(() => {
      sleepRefreshTimer.current = null
      refresh()
    }, 250)
  }

  return (
    <div className="set-card perf-mem-card" ref={cardRef} aria-label="Memory usage">
      <div className="set-row stack">
        <div className="set-row-info">
          <div className="set-label">Memory usage</div>
          <div className="set-desc">Live estimate of memory used by Orbit, open tabs, and extensions.</div>
        </div>
        <div className="perf-summary">
          <div className="perf-stat">
            <span className="perf-stat-label">Total</span>
            <span className="perf-stat-value" data-testid="perf-total-mb">
              {snapshot ? formatMb(snapshot.totalMB) : '—'}
            </span>
          </div>
          <div className="perf-stat">
            <span className="perf-stat-label">Orbit UI</span>
            <span className="perf-stat-value" data-testid="perf-ui-mb">
              {snapshot ? formatMb(snapshot.uiMB) : '—'}
            </span>
          </div>
          <div className="perf-stat">
            <span className="perf-stat-label">
              Extensions{snapshot && snapshot.extensionCount > 0 ? ` (${snapshot.extensionCount})` : ''}
            </span>
            <span className="perf-stat-value" data-testid="perf-ext-mb">
              {snapshot ? formatMb(snapshot.extensionsMB) : '—'}
            </span>
          </div>
        </div>
      </div>

      {snapshot && snapshot.tabs.length > 0 && (
        <ul className="set-perms perf-tabs" aria-label="Memory per tab">
          {snapshot.tabs.map((tab) => (
            <li key={tab.id} className={`set-row perf-tab-row ${tab.sleeping ? 'sleeping' : ''}`}>
              <div className="set-row-info perf-tab-info">
                <div className="perf-tab-title-line">
                  <span className="set-label perf-tab-title" title={tab.title}>
                    {tab.title}
                  </span>
                  {tab.sleeping && <span className="perf-sleeping-tag">Sleeping</span>}
                </div>
              </div>
              <div className="set-row-actions perf-tab-actions">
                <span className="perf-mem-val">
                  {tab.sleeping ? '0 MB' : tab.memoryMB !== null ? formatMb(tab.memoryMB) : '—'}
                </span>
                <button
                  type="button"
                  className="btn set-icon-btn perf-sleep-btn"
                  disabled={!tab.canSleep}
                  title={
                    tab.sleeping
                      ? 'Already sleeping'
                      : tab.canSleep
                        ? 'Put tab to sleep to free memory'
                        : 'Active or protected tab cannot be put to sleep'
                  }
                  onClick={() => handleSleep(tab.id)}
                >
                  <Moon size={12} aria-hidden />
                  <span>Sleep</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
