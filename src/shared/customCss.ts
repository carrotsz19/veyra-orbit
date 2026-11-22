/*
 * Custom CSS & built-in UI mods engine (Zen-style).
 * Applied strictly to Orbit's own UI windows via a <style> tag (never to web pages).
 * Pure module (zero Electron/Node deps) shared across main, renderers, and unit tests.
 */

export const MAX_CUSTOM_CSS_BYTES = 65_536

export const BUILTIN_MOD_IDS = [
  'hide-sidebar-footer',
  'larger-tab-rows',
  'hide-bookmark-icons'
] as const

export type BuiltinModId = (typeof BUILTIN_MOD_IDS)[number]

export interface BuiltinModDef {
  id: BuiltinModId
  name: string
  description: string
  css: string
}

export const BUILTIN_MODS: readonly BuiltinModDef[] = Object.freeze([
  {
    id: 'hide-sidebar-footer',
    name: 'Hide sidebar footer',
    description: 'Hides the workspace and downloads bar at the bottom of the sidebar for more vertical tab space.',
    css: '.side .ws-bar { display: none !important; }'
  },
  {
    id: 'larger-tab-rows',
    name: 'Larger tab rows',
    description: 'Gives tabs extra vertical height and slightly larger titles for easier scanning.',
    css: ':root { --tab-h: 40px; } .tab { font-size: 13.5px; } .top-tab { height: 32px; font-size: 13px; }'
  },
  {
    id: 'hide-bookmark-icons',
    name: 'Hide bookmark bar icons',
    description: 'Shows clean text-only labels on the bookmark bar without site favicons or folder icons.',
    css: '.bm-bar .bm-fav, .bm-bar .bm-fav-glyph, .bm-bar .bm-folder-icon { display: none !important; }'
  }
])

const MOD_MAP = new Map<string, BuiltinModDef>(BUILTIN_MODS.map((m) => [m.id, m]))

export function isBuiltinModId(v: unknown): v is BuiltinModId {
  return typeof v === 'string' && MOD_MAP.has(v)
}

export function sanitizeEnabledMods(raw: unknown): BuiltinModId[] {
  if (!Array.isArray(raw)) return []
  const out: BuiltinModId[] = []
  const seen = new Set<BuiltinModId>()
  for (const item of raw) {
    if (!isBuiltinModId(item) || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/** Measures UTF-8 byte length cleanly in both Node and browser environments. */
export function utf8ByteLength(str: string): number {
  let bytes = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

function truncateUtf8(str: string, maxBytes: number): string {
  if (utf8ByteLength(str) <= maxBytes) return str
  let bytes = 0
  let end = 0
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    let step = 3
    if (code <= 0x7f) step = 1
    else if (code <= 0x7ff) step = 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      step = 4
    }
    if (bytes + step > maxBytes) break
    bytes += step
    end = step === 4 ? i + 2 : i + 1
    if (step === 4) i++
  }
  return str.slice(0, end)
}

/**
 * Unescapes simple CSS hex/backslash escapes in an identifier so obfuscations like
 * `@\69 mport` or `u\72 l(...)` cannot bypass sanitization.
 */
function decodeCssIdentEscapes(s: string): string {
  return s.replace(/\\([0-9a-fA-F]{1,6})\s?|\\([^\r\n\f0-9a-fA-F])/g, (_m, hex: string | undefined, ch: string | undefined) => {
    if (hex) {
      const cp = parseInt(hex, 16)
      if (cp > 0 && cp <= 0x10ffff) return String.fromCodePoint(cp)
      return ''
    }
    return ch ?? ''
  })
}

function isAllowedDataUri(rawInner: string): boolean {
  const unquoted = rawInner.trim().replace(/^['"]|['"]$/g, '').trim()
  const decoded = decodeCssIdentEscapes(unquoted).replace(/[\s\0]+/g, '')
  if (!/^data:/i.test(decoded)) return false
  // Disallow HTML or script data URIs; allow images/fonts/plain data URIs.
  if (/^data:(text\/html|text\/javascript|application\/javascript|application\/xhtml)/i.test(decoded)) {
    return false
  }
  return true
}

/**
 * Replaces every `url(...)` / `src(...)` (including backslash-escaped variants) whose target is not
 * a safe `data:` URI with `none`, preventing any remote network or local file loads from CSS.
 */
function stripRemoteUrls(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    // Match `url(` or `src(` allowing CSS backslash escapes inside the function name.
    const slice = css.slice(i)
    const m = /^((?:u|\\0*75\s?|\\0*55\s?|\\u)(?:r|\\0*72\s?|\\0*52\s?|\\r)(?:l|\\0*6c\s?|\\0*4c\s?|\\l)|(?:s|\\0*73\s?|\\0*53\s?|\\s)(?:r|\\0*72\s?|\\0*52\s?|\\r)(?:c|\\0*63\s?|\\0*43\s?|\\c))\s*\(/i.exec(slice)
    if (m) {
      const prevChar = i > 0 ? css[i - 1] : ''
      if (!/[a-zA-Z0-9_-]/.test(prevChar)) {
        const startArgs = i + m[0].length
        let j = startArgs
        let quote: string | null = null
        let depth = 1
        while (j < css.length && depth > 0) {
          const ch = css[j]
          if (quote) {
            if (ch === '\\' && j + 1 < css.length) j += 2
            else if (ch === quote) {
              quote = null
              j++
            } else j++
          } else {
            if (ch === '"' || ch === "'") {
              quote = ch
              j++
            } else if (ch === '(') {
              depth++
              j++
            } else if (ch === ')') {
              depth--
              j++
            } else j++
          }
        }
        const inner = css.slice(startArgs, depth === 0 ? j - 1 : j)
        if (isAllowedDataUri(inner)) {
          out += css.slice(i, j)
        } else {
          out += 'none'
        }
        i = j
        continue
      }
    }
    out += css[i]
    i++
  }
  return out
}

/**
 * Strips all `@import` rules (including backslash-escaped variants like `@\69 mport`)
 * and strips remote string URLs inside `image-set(...)`.
 */
function stripAtImports(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    if (css[i] === '@') {
      const m = /^@([a-zA-Z0-9_\\-]+)/.exec(css.slice(i))
      if (m && decodeCssIdentEscapes(m[1]).toLowerCase() === 'import') {
        // Advance past the terminating semicolon or line/EOF while respecting quoted strings and parens.
        let j = i + m[0].length
        let quote: string | null = null
        let paren = 0
        while (j < css.length) {
          const ch = css[j]
          if (quote) {
            if (ch === '\\' && j + 1 < css.length) j += 2
            else if (ch === quote) {
              quote = null
              j++
            } else j++
          } else if (ch === '"' || ch === "'") {
            quote = ch
            j++
          } else if (ch === '(') {
            paren++
            j++
          } else if (ch === ')' && paren > 0) {
            paren--
            j++
          } else if (ch === ';' && paren === 0) {
            j++
            break
          } else if (ch === '}' && paren === 0) {
            break
          } else {
            j++
          }
        }
        i = j
        continue
      }
    }
    out += css[i]
    i++
  }
  return out
}

/**
 * Strictly sanitizes user custom CSS:
 * - Enforces max size (64 KB UTF-8).
 * - Strips `@import` rules.
 * - Strips any `url(...)` / `src(...)` whose target is not a safe `data:` URI.
 * - Strips `</style>` tags, `image-set("http...")` remote loads, and legacy `expression()`/`behavior`/`-moz-binding`.
 */
export function sanitizeCustomCss(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return ''
  let css = raw.replace(/\0/g, '').replace(/\r\n?/g, '\n')
  css = truncateUtf8(css, MAX_CUSTOM_CSS_BYTES)
  // Strip any closing style tag attempts.
  css = css.replace(/<\/\s*style\b[^>]*>/gi, '')
  // Strip @import rules.
  css = stripAtImports(css)
  // Strip non-data: url(...) and src(...).
  css = stripRemoteUrls(css)
  // Strip raw remote URLs inside image-set("https://...") without url().
  css = css.replace(/image-set\s*\(([^)]*)\)/gi, (match, args: string) => {
    if (/(https?:|file:|ftp:|\/\/)/i.test(args)) return 'none'
    return match
  })
  // Strip legacy script-in-CSS vectors.
  css = css.replace(/expression\s*\([^)]*\)/gi, 'none')
  css = css.replace(/(?:behavior|-moz-binding)\s*:[^;}\n]*/gi, '')
  return truncateUtf8(css, MAX_CUSTOM_CSS_BYTES)
}

/** Combines enabled built-in mods and user custom CSS; returns '' when safeMode is active. */
export function buildEffectiveCustomCss(opts: {
  customCssEnabled: boolean
  customCss: string
  enabledMods: readonly BuiltinModId[]
  safeMode: boolean
}): string {
  if (opts.safeMode) return ''
  const chunks: string[] = []
  for (const modId of opts.enabledMods) {
    const def = MOD_MAP.get(modId)
    if (def) chunks.push(def.css)
  }
  if (opts.customCssEnabled && opts.customCss) {
    const clean = sanitizeCustomCss(opts.customCss)
    if (clean.trim()) chunks.push(clean)
  }
  return chunks.join('\n')
}

/** Detects safe-mode launch via `--safe-mode` CLI flag or `VEYRA_SAFE_MODE=1`. */
export function isSafeModeLaunch(argv: readonly string[], env: Record<string, string | undefined>): boolean {
  if (env.VEYRA_SAFE_MODE === '1') return true
  return argv.some((arg) => arg === '--safe-mode')
}
