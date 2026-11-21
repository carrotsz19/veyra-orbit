/*
 * Sleeping tabs eligibility rules and timeout resolution.
 * Pure, so it can be shared between main and unit tests.
 */
import { isAllowedUrl, isInternalUrl } from './url.ts'

export const SLEEP_MINUTES_OPTIONS = [0, 15, 30, 60, 120] as const
export type SleepMinutes = (typeof SLEEP_MINUTES_OPTIONS)[number]

export interface SleepCandidate {
  isActive: boolean
  sleeping: boolean
  /** True when the tab currently has a live WebContentsView backing it. */
  hasLoadedWebView: boolean
  url: string
  hasError: boolean
  audible: boolean
  pinned: boolean
  hasPendingPermission: boolean
  hasActiveFind: boolean
  isFullscreen: boolean
  lastActiveAt: number
}

export interface SleepPolicy {
  /** Idle threshold in milliseconds. 0 disables automatic sleeping. */
  timeoutMs: number
  /** Whether pinned tabs are allowed to sleep automatically. */
  sleepPinnedTabs: boolean
}

/**
 * Returns true if a tab is eligible to be put to sleep.
 * Never sleeps: the active tab, already-sleeping/unloaded tabs, blank/internal/error tabs,
 * tabs playing audio, tabs with a pending permission prompt, tabs with active find, or fullscreen tabs.
 * Automatic sleep also respects timeoutMs and sleepPinnedTabs; manual sleep bypasses only timeout & pinned.
 */
export function canSleepTab(tab: SleepCandidate, policy: SleepPolicy, now: number, manual = false): boolean {
  if (tab.isActive) return false
  if (tab.sleeping || !tab.hasLoadedWebView) return false
  if (!tab.url || tab.hasError || isInternalUrl(tab.url) || !isAllowedUrl(tab.url)) return false
  if (tab.audible) return false
  if (tab.hasPendingPermission) return false
  if (tab.hasActiveFind) return false
  if (tab.isFullscreen) return false
  if (manual) return true
  if (policy.timeoutMs <= 0) return false
  if (tab.pinned && !policy.sleepPinnedTabs) return false
  return now - tab.lastActiveAt >= policy.timeoutMs
}

/**
 * Resolves the effective sleep timeout in ms.
 * Unpackaged dev/test runs may pass VEYRA_SLEEP_TEST_MINUTES (supports fractional minutes, e.g. 0.05 = 3s).
 */
export function resolveSleepTimeoutMs(settingMinutes: SleepMinutes, testEnvValue: string | undefined, isPackaged: boolean): number {
  if (!isPackaged && testEnvValue !== undefined && testEnvValue.trim() !== '') {
    const parsed = Number(testEnvValue)
    if (Number.isFinite(parsed) && parsed > 0) return Math.max(250, Math.round(parsed * 60_000))
  }
  return settingMinutes > 0 ? settingMinutes * 60_000 : 0
}
