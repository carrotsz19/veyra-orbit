/*
 * Pure download helpers: safe filename cleaning, unique filename picking ("file (1).pdf"),
 * and human-readable byte / speed formatting. No Node or Electron imports so this runs in
 * main, renderer, and node:test alike.
 */

const COMPOUND_EXTS = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst']
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_FILENAME_LEN = 200

/** Splits a filename into stem and extension, preserving dotfiles and common compound extensions. */
export function splitFilename(name: string): { stem: string; ext: string } {
  const lower = name.toLowerCase()
  for (const ext of COMPOUND_EXTS) {
    if (lower.endsWith(ext) && name.length > ext.length) {
      return { stem: name.slice(0, -ext.length), ext: name.slice(-ext.length) }
    }
  }
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' }
  return { stem: name.slice(0, dot), ext: name.slice(dot) }
}

/** Strips directory parts, invalid path characters, and Windows-reserved names. */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? ''
  let clean = base
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/, '')

  if (!clean || clean === '.' || clean === '..') return 'download'

  let { stem, ext } = splitFilename(clean)
  if (WINDOWS_RESERVED.test(stem)) stem = `_${stem}`
  if (stem.length + ext.length > MAX_FILENAME_LEN) {
    const maxStem = Math.max(1, MAX_FILENAME_LEN - ext.length)
    stem = stem.slice(0, maxStem).replace(/[. ]+$/, '') || 'download'
  }
  clean = stem + ext
  return clean || 'download'
}

/**
 * Picks a filename that does not collide according to `exists`.
 * If "file.pdf" exists, tries "file (1).pdf", "file (2).pdf", and so on.
 */
export function pickUniqueFilename(filename: string, exists: (name: string) => boolean): string {
  const clean = sanitizeFilename(filename)
  if (!exists(clean)) return clean
  const { stem, ext } = splitFilename(clean)
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!exists(candidate)) return candidate
  }
  return `${stem} (${Date.now()})${ext}`
}

/** Files that run code when opened on Windows. Orbit shows these in their folder instead of opening them. */
const RUNNABLE = new Set([
  'exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl',
  'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'lnk', 'url', 'reg', 'jar', 'msc', 'scf', 'inf', 'application', 'appref-ms'
])

export function isRunnable(filename: string): boolean {
  // Windows ignores trailing dots and spaces, so "a.exe. " is still a program.
  const name = filename.replace(/[. ]+$/, '')
  const dot = name.lastIndexOf('.')
  return dot >= 0 && RUNNABLE.has(name.slice(dot + 1).toLowerCase())
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** Formats a byte count like "12.4 MB" or "512 B". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${Number(value.toFixed(digits))} ${UNITS[unit]}`
}

/** Formats a transfer rate like "2.4 MB/s", or "" when idle. */
export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return ''
  return `${formatBytes(bytesPerSec)}/s`
}

/** Maximum recent items shown in the compact sidebar downloads drawer. */
export const RECENT_DOWNLOADS_LIMIT = 6

export type DownloadFileCategory = 'archive' | 'audio' | 'code' | 'document' | 'image' | 'installer' | 'pdf' | 'video' | 'file'

const CATEGORY_EXTS: Record<Exclude<DownloadFileCategory, 'file'>, ReadonlySet<string>> = {
  pdf: new Set(['pdf']),
  image: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic', 'tif', 'tiff']),
  video: new Set(['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'wmv']),
  audio: new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus']),
  archive: new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst', 'tgz']),
  installer: new Set(['exe', 'msi', 'msix', 'msixbundle', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'apk']),
  code: new Set(['js', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'py', 'json', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'scss', 'sql', 'sh', 'ps1', 'c', 'cpp', 'h', 'rs', 'go', 'java', 'md']),
  document: new Set(['txt', 'doc', 'docx', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ods', 'ppt', 'pptx', 'odp', 'epub'])
}

/** Classifies a filename into a broad visual icon category for the downloads UI. */
export function downloadFileCategory(filename: string): DownloadFileCategory {
  const clean = filename.replace(/[. ]+$/, '').toLowerCase()
  const { ext } = splitFilename(clean)
  if (!ext) return 'file'
  const raw = ext.startsWith('.') ? ext.slice(1) : ext
  const last = raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw
  for (const [cat, set] of Object.entries(CATEGORY_EXTS) as [Exclude<DownloadFileCategory, 'file'>, ReadonlySet<string>][]) {
    if (set.has(raw) || set.has(last)) return cat
  }
  return 'file'
}

export interface DownloadsSummaryInput {
  state: 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  totalBytes: number
  canResume: boolean
}

export interface DownloadsSummary {
  /** Number of items currently transferring (progressing). */
  activeCount: number
  /** Number of paused items. */
  pausedCount: number
  /** Active + paused count shown on the sidebar downloads button badge. */
  inProgressCount: number
  /** Aggregate 0..1 progress across active/paused items with known size, or null when indeterminate. */
  progress: number | null
  /** True if at least one active/paused download has an unknown total size. */
  hasIndeterminate: boolean
  /** True if any item can be cleared via "Clear". */
  hasFinished: boolean
}

/** Computes aggregate progress ring and badge metadata for the sidebar downloads button. */
export function summarizeDownloads(items: readonly DownloadsSummaryInput[]): DownloadsSummary {
  let activeCount = 0
  let pausedCount = 0
  let receivedKnown = 0
  let totalKnown = 0
  let hasIndeterminate = false
  let hasFinished = false

  for (const d of items) {
    if (d.state === 'progressing') activeCount++
    else if (d.state === 'paused') pausedCount++
    else if (d.state === 'completed' || d.state === 'cancelled' || (d.state === 'interrupted' && !d.canResume)) {
      hasFinished = true
    }

    if (d.state === 'progressing' || d.state === 'paused') {
      if (d.totalBytes > 0) {
        receivedKnown += Math.min(Math.max(0, d.receivedBytes), d.totalBytes)
        totalKnown += d.totalBytes
      } else {
        hasIndeterminate = true
      }
    }
  }

  const inProgressCount = activeCount + pausedCount
  const progress = totalKnown > 0 ? Math.min(1, Math.max(0, receivedKnown / totalKnown)) : null
  return {
    activeCount,
    pausedCount,
    inProgressCount,
    progress,
    hasIndeterminate,
    hasFinished
  }
}
