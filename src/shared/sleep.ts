/*
 * Sleeping tabs eligibility rules and timeout resolution.
 * Pure, so it can be shared between main and unit tests.
 */
import { isAllowedUrl, isInternalUrl } from './url.ts'

export const SLEEP_MINUTES_OPTIONS = [0, 5, 15, 30, 60, 120] as const
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
  /** True when the tab is capturing camera/mic/screen or being screen-captured. */
  isCapturingMedia: boolean
  /** True when the tab has unsaved text typed into an editable form field. */
  hasUnsavedFormText: boolean
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
 * tabs playing audio, tabs with a pending permission prompt, tabs with active find,
 * fullscreen tabs, tabs using camera/mic/screen capture, or tabs with unsaved typed form text.
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
  if (tab.isCapturingMedia) return false
  if (tab.hasUnsavedFormText) return false
  if (manual) return true
  if (policy.timeoutMs <= 0) return false
  if (tab.pinned && !policy.sleepPinnedTabs) return false
  return now - tab.lastActiveAt >= policy.timeoutMs
}

/**
 * Cheap main-process gate for unsaved-form-text detection:
 * returns true only when a WebContents receives a text-editing keystroke (printable character
 * without Ctrl/Alt/Meta, Backspace/Delete/Enter, or Ctrl/Cmd+V paste). Tabs where the user
 * never typed never run any renderer DOM probe.
 */
export function isTypingKeyInput(input: {
  type: string
  key: string
  control?: boolean
  meta?: boolean
  alt?: boolean
}): boolean {
  if (input.type !== 'keyDown') return false
  const k = input.key
  if (!k) return false
  const mod = !!input.control || !!input.meta
  if (mod && !input.alt) {
    return k.toLowerCase() === 'v'
  }
  if (input.alt) return false
  if (k === 'Backspace' || k === 'Delete' || k === 'Enter') return true
  return k.length === 1
}

/**
 * Tiny, read-only, bounded DOM probe executed on demand ONLY for background tabs that have
 * already received typing input (`isTypingKeyInput`).
 *
 * Design choice: avoids injecting any persistent preload or page-load script into web pages
 * (keeping tabs sandboxed with zero extra listeners or memory overhead). Runs at most once
 * when leaving a typed tab and once right before auto-sleeping it. Checks whether any text
 * `<input>` or `<textarea>` differs from its HTML `defaultValue` with non-empty text, or
 * whether a `contenteditable` element contains non-empty text (bounded to the first 300 fields).
 */
export const FORM_DIRTY_CHECK_SCRIPT = `(() => {
  try {
    const fields = document.querySelectorAll('input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
    const limit = Math.min(fields.length, 300);
    for (let i = 0; i < limit; i++) {
      const el = fields[i];
      const tag = el.tagName;
      if (tag === 'TEXTAREA') {
        if (el.value !== el.defaultValue && el.value.trim().length > 0) return true;
      } else if (tag === 'INPUT') {
        const t = (el.type || 'text').toLowerCase();
        if (t === 'hidden' || t === 'submit' || t === 'button' || t === 'reset' || t === 'image' || t === 'checkbox' || t === 'radio' || t === 'range' || t === 'color' || t === 'file') continue;
        if (el.value !== el.defaultValue && el.value.trim().length > 0) return true;
      } else if (el.isContentEditable) {
        if ((el.textContent || '').trim().length > 0) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
})()`

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
