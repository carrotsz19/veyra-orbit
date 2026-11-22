/**
 * Pure update feed, token resolution, and error-classification helpers.
 * Kept free of Electron and Node fs imports so both main/config and unit tests share it directly.
 */

export type Channel = 'dev' | 'prod'

export const PROD_REPO = { owner: 'carrotsz19', repo: 'veyra-orbit' } as const
export const DEV_REPO = { owner: 'carrotsz19', repo: 'veyra-orbit-dev' } as const
export const DEV_FEED_TOKEN_FILE = 'C:/dev/tools/veyra-orbit-dev-feed.token'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'up-to-date' | 'unavailable' | 'error'

export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface JustUpdatedNotice {
  version: string
  /** Release notes tag URL for Prod builds, or null for Dev builds. */
  releaseNotesUrl: string | null
}

export interface UpdateState {
  status: UpdateStatus
  channel: Channel
  currentVersion: string
  availableVersion?: string
  /** Download progress percentage (0–100) while downloading. */
  progress?: number
  /** Timestamp (ms since 1970) of the last completed check. */
  checkedAt?: number
  /** Short calm explanation shown in Settings (e.g. why unavailable or manual check failed). */
  note?: string
  /** Set once on the first launch after updating to a new version. */
  justUpdated?: JustUpdatedNotice | null
}

export type UpdateFeedSelection =
  | { enabled: false; reason: 'disabled' | 'unpackaged' | 'missing-dev-token' }
  | { enabled: true; feed: { provider: 'generic'; url: string }; forceDevUpdateConfig: true }
  | { enabled: true; feed: { provider: 'github'; owner: string; repo: string; private: true; token: string }; forceDevUpdateConfig: false }
  | { enabled: true; feed: { provider: 'github'; owner: string; repo: string; private: false }; forceDevUpdateConfig: false }

export interface ResolveDevTokenOptions {
  channel: Channel
  envToken?: string
  envTokenFile?: string
  readTokenFile?: (path: string) => string | null
}

/**
 * Resolves the build-time read-only token for the private Dev releases repo.
 * Prod builds NEVER receive a token.
 */
export function resolveDevFeedToken(opts: ResolveDevTokenOptions): string {
  if (opts.channel !== 'dev') return ''
  const fromEnv = opts.envToken?.trim()
  if (fromEnv) return fromEnv
  const path = opts.envTokenFile?.trim() || DEV_FEED_TOKEN_FILE
  const fromFile = opts.readTokenFile?.(path)?.trim()
  return fromFile || ''
}

export interface SelectFeedOptions {
  channel: Channel
  isPackaged: boolean
  devFeedToken?: string
  testFeedUrl?: string
  disableUpdates?: boolean
}

/** Picks which update feed (if any) this build should query. */
export function selectUpdateFeed(opts: SelectFeedOptions): UpdateFeedSelection {
  if (opts.disableUpdates) return { enabled: false, reason: 'disabled' }
  const testUrl = opts.testFeedUrl?.trim()
  if (testUrl) {
    return { enabled: true, feed: { provider: 'generic', url: testUrl }, forceDevUpdateConfig: true }
  }
  if (!opts.isPackaged) return { enabled: false, reason: 'unpackaged' }
  if (opts.channel === 'dev') {
    const token = opts.devFeedToken?.trim() ?? ''
    if (!token) return { enabled: false, reason: 'missing-dev-token' }
    return {
      enabled: true,
      feed: { provider: 'github', owner: DEV_REPO.owner, repo: DEV_REPO.repo, private: true, token },
      forceDevUpdateConfig: false
    }
  }
  return {
    enabled: true,
    feed: { provider: 'github', owner: PROD_REPO.owner, repo: PROD_REPO.repo, private: false },
    forceDevUpdateConfig: false
  }
}

export type UpdateErrorKind = 'no-release' | 'network' | 'other'

/** Classifies updater errors so missing releases (e.g. Prod before first release) stay quiet. */
export function classifyUpdateError(err: unknown): UpdateErrorKind {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code ?? '') : ''
  const msg = err instanceof Error ? err.message : String(err ?? '')
  const text = `${code} ${msg}`
  if (/ERR_UPDATER_LATEST_VERSION_NOT_FOUND|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND|No published versions on GitHub|Unable to find latest version on GitHub|Cannot find latest\.yml|HttpError:\s*404|\b404\b/i.test(text)) {
    return 'no-release'
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|net::/i.test(text)) {
    return 'network'
  }
  return 'other'
}

/** Strips tokens and auth headers before writing an error to logs. */
export function redactSecrets(text: string, secrets: string[] = []): string {
  let out = text
  for (const s of secrets) {
    if (s) out = out.split(s).join('[redacted]')
  }
  out = out
    .replace(/\b(?:github_pat|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+\b/g, '[redacted]')
    .replace(/(Authorization:\s*(?:Bearer|token)\s+)\S+/gi, '$1[redacted]')
    .replace(/(token=)\S+/gi, '$1[redacted]')
  return out
}

const SAFE_VERSION_RE = /^[0-9]+(?:\.[0-9]+){1,3}(?:-[0-9A-Za-z.-]+)?$/

/** Builds the GitHub release tag URL for Prod builds, or null for Dev builds / invalid versions. */
export function releaseTagUrl(version: string, channel: Channel): string | null {
  if (channel !== 'prod') return null
  const clean = version.trim()
  if (!SAFE_VERSION_RE.test(clean)) return null
  return `https://github.com/${PROD_REPO.owner}/${PROD_REPO.repo}/releases/tag/v${clean}`
}

/**
 * Determines whether the "Updated to <version>" notice should show on launch.
 * Returns null on first launch (no previous version recorded) or when the version did not change.
 */
export function detectJustUpdated(
  previousVersion: string | null | undefined,
  currentVersion: string,
  channel: Channel
): JustUpdatedNotice | null {
  const prev = typeof previousVersion === 'string' ? previousVersion.trim() : ''
  const cur = currentVersion.trim()
  if (!prev || !cur || prev === cur || !SAFE_VERSION_RE.test(cur)) return null
  return {
    version: cur,
    releaseNotesUrl: releaseTagUrl(cur, channel)
  }
}

/** Returns true when enough time (> 4 h by default) has passed since the last check to recheck on focus/resume. */
export function shouldCheckOnWakeOrFocus(
  lastCheckedAt: number | undefined,
  now: number,
  intervalMs = UPDATE_CHECK_INTERVAL_MS
): boolean {
  if (lastCheckedAt === undefined || !Number.isFinite(lastCheckedAt)) return true
  return now - lastCheckedAt > intervalMs
}

/** Decides whether an available update should start downloading automatically right away. */
export function shouldAutoDownloadUpdate(mode: 'automatic' | 'notify'): boolean {
  return mode === 'automatic'
}
