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
