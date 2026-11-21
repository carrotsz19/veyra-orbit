/**
 * Pure update feed, token resolution, and error-classification helpers.
 * Kept free of Electron and Node fs imports so both main/config and unit tests share it directly.
 */

export type Channel = 'dev' | 'prod'

export const PROD_REPO = { owner: 'carrotsz19', repo: 'veyra-orbit' } as const
export const DEV_REPO = { owner: 'carrotsz19', repo: 'veyra-orbit-dev' } as const
export const DEV_FEED_TOKEN_FILE = 'C:/dev/tools/veyra-orbit-dev-feed.token'

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'unavailable' | 'error'

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
