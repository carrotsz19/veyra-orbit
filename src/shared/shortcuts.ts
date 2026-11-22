/*
 * Central keyboard shortcut registry, accelerator parser/validator, conflict detection,
 * input matching (Electron before-input-event & DOM KeyboardEvent), and sanitization.
 * Pure module (zero Electron/Node deps) shared across main, renderers, and unit tests.
 */

export type ShortcutCategory = 'tabs' | 'navigation' | 'view' | 'workspaces' | 'tools' | 'window'

export const SHORTCUT_CATEGORIES: readonly { id: ShortcutCategory; label: string }[] = Object.freeze([
  { id: 'tabs', label: 'Tabs' },
  { id: 'navigation', label: 'Navigation' },
  { id: 'view', label: 'View & layout' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'tools', label: 'Tools & pages' },
  { id: 'window', label: 'Window' }
])

export interface ShortcutDef {
  id: ShortcutId
  label: string
  defaultAccelerator: string
  category: ShortcutCategory
}

export const SHORTCUT_REGISTRY = [
  // Tabs
  { id: 'new-tab', label: 'New tab', defaultAccelerator: 'Ctrl+T', category: 'tabs' },
  { id: 'close-tab', label: 'Close tab', defaultAccelerator: 'Ctrl+W', category: 'tabs' },
  { id: 'reopen-closed-tab', label: 'Reopen closed tab', defaultAccelerator: 'Ctrl+Shift+T', category: 'tabs' },
  { id: 'next-tab', label: 'Next tab', defaultAccelerator: 'Ctrl+Tab', category: 'tabs' },
  { id: 'prev-tab', label: 'Previous tab', defaultAccelerator: 'Ctrl+Shift+Tab', category: 'tabs' },

  // Navigation
  { id: 'focus-omnibox', label: 'Focus address bar', defaultAccelerator: 'Ctrl+L', category: 'navigation' },
  { id: 'back', label: 'Back', defaultAccelerator: 'Alt+Left', category: 'navigation' },
  { id: 'forward', label: 'Forward', defaultAccelerator: 'Alt+Right', category: 'navigation' },
  { id: 'reload', label: 'Reload page', defaultAccelerator: 'Ctrl+R', category: 'navigation' },
  { id: 'hard-reload', label: 'Hard reload (ignore cache)', defaultAccelerator: 'Ctrl+Shift+R', category: 'navigation' },

  // View & layout
  { id: 'compact-mode', label: 'Compact mode', defaultAccelerator: 'Ctrl+Shift+S', category: 'view' },
  { id: 'bookmark-bar', label: 'Bookmark bar', defaultAccelerator: 'Ctrl+Shift+B', category: 'view' },
  { id: 'split-view', label: 'Split view with next tab', defaultAccelerator: 'Ctrl+Shift+\\', category: 'view' },
  { id: 'zoom-in', label: 'Zoom in', defaultAccelerator: 'Ctrl+=', category: 'view' },
  { id: 'zoom-out', label: 'Zoom out', defaultAccelerator: 'Ctrl+-', category: 'view' },
  { id: 'zoom-reset', label: 'Reset zoom', defaultAccelerator: 'Ctrl+0', category: 'view' },
  { id: 'fullscreen', label: 'Full screen', defaultAccelerator: 'F11', category: 'view' },

  // Workspaces
  { id: 'new-private-workspace', label: 'New private workspace', defaultAccelerator: 'Ctrl+Shift+N', category: 'workspaces' },
  { id: 'prev-workspace', label: 'Previous workspace', defaultAccelerator: 'Ctrl+Alt+Left', category: 'workspaces' },
  { id: 'next-workspace', label: 'Next workspace', defaultAccelerator: 'Ctrl+Alt+Right', category: 'workspaces' },

  // Tools & pages
  { id: 'command-palette', label: 'Command bar', defaultAccelerator: 'Ctrl+K', category: 'tools' },
  { id: 'find', label: 'Find in page', defaultAccelerator: 'Ctrl+F', category: 'tools' },
  { id: 'find-next', label: 'Find next match', defaultAccelerator: 'F3', category: 'tools' },
  { id: 'find-prev', label: 'Find previous match', defaultAccelerator: 'Shift+F3', category: 'tools' },
  { id: 'bookmark-toggle', label: 'Bookmark this page', defaultAccelerator: 'Ctrl+D', category: 'tools' },
  { id: 'bookmarks', label: 'Show all bookmarks', defaultAccelerator: 'Ctrl+Shift+O', category: 'tools' },
  { id: 'history', label: 'Show history', defaultAccelerator: 'Ctrl+H', category: 'tools' },
  { id: 'downloads', label: 'Show downloads', defaultAccelerator: 'Ctrl+J', category: 'tools' },
  { id: 'screenshot', label: 'Take screenshot', defaultAccelerator: 'Ctrl+Shift+2', category: 'tools' },
  { id: 'settings', label: 'Settings', defaultAccelerator: 'Ctrl+,', category: 'tools' },
  { id: 'print', label: 'Print page', defaultAccelerator: 'Ctrl+P', category: 'tools' },
  { id: 'devtools', label: 'Developer tools', defaultAccelerator: 'F12', category: 'tools' },

  // Window
  { id: 'quit', label: 'Quit Orbit', defaultAccelerator: 'Ctrl+Q', category: 'window' }
] as const

export type ShortcutId = (typeof SHORTCUT_REGISTRY)[number]['id']

/** User overrides: key -> canonical accelerator string, or '' when explicitly disabled. */
export type ShortcutOverrides = Partial<Record<ShortcutId, string>>

/** Full resolved map of every shortcut ID to its active canonical accelerator (or '' if disabled). */
export type ResolvedShortcuts = Record<ShortcutId, string>

const REGISTRY_BY_ID = new Map<string, ShortcutDef>(SHORTCUT_REGISTRY.map((s) => [s.id, s]))

export function isShortcutId(v: unknown): v is ShortcutId {
  return typeof v === 'string' && REGISTRY_BY_ID.has(v)
}

export function getShortcutDef(id: ShortcutId): ShortcutDef {
  return REGISTRY_BY_ID.get(id)!
}

// ---- Key normalization ------------------------------------------------------

const FUNCTION_KEY_RE = /^F([1-9]|1[0-2])$/i
const MODIFIER_KEYS = new Set(['control', 'ctrl', 'shift', 'alt', 'meta', 'os', 'command', 'cmd', 'altgraph'])

const CODE_TO_KEY: Readonly<Record<string, string>> = Object.freeze({
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  NumpadAdd: '=',
  NumpadSubtract: '-',
  Numpad0: '0',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Escape: 'Escape'
})

const NAMED_KEY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  arrowleft: 'Left',
  left: 'Left',
  arrowright: 'Right',
  right: 'Right',
  arrowup: 'Up',
  up: 'Up',
  arrowdown: 'Down',
  down: 'Down',
  pageup: 'PageUp',
  pgup: 'PageUp',
  pagedown: 'PageDown',
  pgdn: 'PageDown',
  home: 'Home',
  end: 'End',
  insert: 'Insert',
  ins: 'Insert',
  delete: 'Delete',
  del: 'Delete',
  backspace: 'Backspace',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  space: 'Space',
  ' ': 'Space',
  escape: 'Escape',
  esc: 'Escape',
  plus: '=',
  '+': '=',
  '−': '-',
  minus: '-'
})

const VALID_PUNCTUATION = new Set([',', '.', '/', ';', "'", '[', ']', '\\', '-', '=', '`'])

/** Reserved / forbidden system or standard-editing accelerators that cannot be rebound. */
const FORBIDDEN_ACCELERATORS: ReadonlyMap<string, string> = new Map([
  ['Alt+F4', 'Alt+F4 is reserved by the operating system to close windows.'],
  ['Alt+Tab', 'Alt+Tab is reserved by the operating system to switch windows.'],
  ['Alt+Shift+Tab', 'Alt+Shift+Tab is reserved by the operating system to switch windows.'],
  ['Alt+Escape', 'Alt+Escape is reserved by the operating system.'],
  ['Alt+Space', 'Alt+Space is reserved for the window menu.'],
  ['Ctrl+Alt+Delete', 'Ctrl+Alt+Delete is reserved by the operating system.'],
  ['Ctrl+Shift+Escape', 'Ctrl+Shift+Escape is reserved by the operating system.'],
  ['Ctrl+Escape', 'Ctrl+Escape is reserved by the operating system.'],
  ['Ctrl+C', 'Ctrl+C is reserved for Copy.'],
  ['Ctrl+V', 'Ctrl+V is reserved for Paste.'],
  ['Ctrl+X', 'Ctrl+X is reserved for Cut.'],
  ['Ctrl+A', 'Ctrl+A is reserved for Select all.'],
  ['Ctrl+Z', 'Ctrl+Z is reserved for Undo.'],
  ['Ctrl+Y', 'Ctrl+Y is reserved for Redo.']
])

for (let n = 1; n <= 9; n++) {
  ;(FORBIDDEN_ACCELERATORS as Map<string, string>).set(
    `Ctrl+${n}`,
    `Ctrl+${n} is reserved for switching to tab ${n}.`
  )
  ;(FORBIDDEN_ACCELERATORS as Map<string, string>).set(
    `Ctrl+Alt+${n}`,
    `Ctrl+Alt+${n} is reserved for switching to workspace ${n}.`
  )
}

function normalizeKeyToken(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (MODIFIER_KEYS.has(lower)) return null
  if (NAMED_KEY_ALIASES[lower]) return NAMED_KEY_ALIASES[lower]
  if (FUNCTION_KEY_RE.test(trimmed)) return trimmed.toUpperCase()
  if (/^[a-z]$/i.test(trimmed)) return trimmed.toUpperCase()
  if (/^[0-9]$/.test(trimmed)) return trimmed
  if (VALID_PUNCTUATION.has(trimmed)) return trimmed
  return null
}

function isFunctionKey(key: string): boolean {
  return FUNCTION_KEY_RE.test(key)
}

export interface AcceleratorValidation {
  ok: boolean
  accelerator?: string
  reason?: string
}

/**
 * Parses, canonicalizes, and validates an accelerator string (e.g. "ctrl+shift+s" -> "Ctrl+Shift+S").
 * Rejects bare non-function keys, Shift+letter/digit combos, and reserved OS / editing shortcuts.
 */
export function validateAccelerator(raw: unknown): AcceleratorValidation {
  if (typeof raw !== 'string') return { ok: false, reason: 'Shortcut must be a string.' }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, reason: 'Shortcut cannot be empty.' }
  if (trimmed.length > 64) return { ok: false, reason: 'Shortcut is too long.' }

  // Split on '+' while preserving a trailing '+' or standalone '+' token (e.g. "Ctrl++").
  const tokens: string[] = []
  let cur = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '+' && cur.length > 0) {
      tokens.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.length > 0) tokens.push(cur)

  let ctrl = false
  let alt = false
  let shift = false
  let mainKey: string | null = null

  for (const tok of tokens) {
    const l = tok.trim().toLowerCase()
    if (l === 'ctrl' || l === 'control' || l === 'cmdorctrl' || l === 'commandorcontrol' || l === 'cmd' || l === 'command' || l === 'meta') {
      ctrl = true
    } else if (l === 'alt' || l === 'option') {
      alt = true
    } else if (l === 'shift') {
      shift = true
    } else {
      if (mainKey !== null) return { ok: false, reason: 'Use only one key with modifiers.' }
      const norm = normalizeKeyToken(tok)
      if (!norm) return { ok: false, reason: `Unsupported key “${tok}”.` }
      mainKey = norm
    }
  }

  if (!mainKey) return { ok: false, reason: 'Press a key together with Ctrl or Alt.' }
  if (mainKey === 'Escape' && !ctrl && !alt && !shift) {
    return { ok: false, reason: 'Escape cannot be used as a shortcut.' }
  }

  // Require Ctrl or Alt unless it's a function key (F1–F12).
  if (!ctrl && !alt && !isFunctionKey(mainKey)) {
    return {
      ok: false,
      reason: shift
        ? `Shift+${mainKey} would interfere with typing. Add Ctrl or Alt.`
        : `Single key “${mainKey}” would interfere with typing. Add Ctrl or Alt.`
    }
  }

  const parts: string[] = []
  if (ctrl) parts.push('Ctrl')
  if (alt) parts.push('Alt')
  if (shift) parts.push('Shift')
  parts.push(mainKey)
  const canonical = parts.join('+')

  const forbidden = FORBIDDEN_ACCELERATORS.get(canonical)
  if (forbidden) return { ok: false, reason: forbidden }

  return { ok: true, accelerator: canonical }
}

/** Input shape common to Electron's before-input-event `Input` and DOM `KeyboardEvent`. */
export interface KeyEventLike {
  key: string
  code?: string
  control?: boolean
  ctrlKey?: boolean
  meta?: boolean
  metaKey?: boolean
  alt?: boolean
  altKey?: boolean
  shift?: boolean
  shiftKey?: boolean
}

/** Extracts a canonical accelerator string from a key event, or null if modifier-only / unsupported. */
export function acceleratorFromKeyEvent(ev: KeyEventLike, platform: string = 'win32'): string | null {
  const keyLower = (ev.key || '').toLowerCase()
  if (MODIFIER_KEYS.has(keyLower)) return null

  const ctrl = platform === 'darwin' ? !!(ev.meta ?? ev.metaKey) : !!(ev.control ?? ev.ctrlKey)
  const alt = !!(ev.alt ?? ev.altKey)
  const shift = !!(ev.shift ?? ev.shiftKey)

  let mainKey: string | null = null
  const code = ev.code || ''
  if (/^Key([A-Z])$/.test(code)) {
    mainKey = code.slice(3)
  } else if (/^Digit([0-9])$/.test(code)) {
    mainKey = code.slice(5)
  } else if (code && CODE_TO_KEY[code]) {
    mainKey = CODE_TO_KEY[code]
  } else if (/^F([1-9]|1[0-2])$/.test(code)) {
    mainKey = code
  } else {
    mainKey = normalizeKeyToken(ev.key || '')
  }

  if (!mainKey) return null
  const parts: string[] = []
  if (ctrl) parts.push('Ctrl')
  if (alt) parts.push('Alt')
  if (shift) parts.push('Shift')
  parts.push(mainKey)
  return parts.join('+')
}

// ---- Resolution, sanitization, conflicts, and matching ----------------------

export function defaultResolvedShortcuts(): ResolvedShortcuts {
  const map = {} as ResolvedShortcuts
  for (const def of SHORTCUT_REGISTRY) {
    map[def.id] = def.defaultAccelerator
  }
  return map
}

export function resolveShortcuts(overrides?: ShortcutOverrides | null): ResolvedShortcuts {
  const out = defaultResolvedShortcuts()
  if (!overrides || typeof overrides !== 'object') return out
  for (const def of SHORTCUT_REGISTRY) {
    if (!Object.prototype.hasOwnProperty.call(overrides, def.id)) continue
    const raw = overrides[def.id]
    if (raw === '') {
      out[def.id] = ''
    } else if (typeof raw === 'string') {
      const v = validateAccelerator(raw)
      if (v.ok && v.accelerator) out[def.id] = v.accelerator
    }
  }
  return out
}

/**
 * Validates and cleans a persisted shortcut overrides object:
 * - Drops unknown shortcut IDs and invalid / forbidden accelerators.
 * - Keeps '' (explicitly disabled) and valid non-default bindings.
 * - Drops entries that match the default (so defaults stay clean & compact).
 */
export function sanitizeShortcutOverrides(raw: unknown): ShortcutOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const src = raw as Record<string, unknown>
  const out: ShortcutOverrides = {}
  for (const def of SHORTCUT_REGISTRY) {
    if (!Object.prototype.hasOwnProperty.call(src, def.id)) continue
    const val = src[def.id]
    if (val === '') {
      out[def.id] = ''
      continue
    }
    if (typeof val !== 'string') continue
    const v = validateAccelerator(val)
    if (v.ok && v.accelerator && v.accelerator !== def.defaultAccelerator) {
      out[def.id] = v.accelerator
    }
  }
  return out
}

/**
 * Merges a partial shortcut override patch onto existing overrides.
 * Setting a key to `null` or its default accelerator removes the override (resets it to default).
 * Setting a key to `''` disables the shortcut.
 */
export function mergeShortcutOverrides(current: ShortcutOverrides, patch: unknown): ShortcutOverrides {
  const next: ShortcutOverrides = { ...sanitizeShortcutOverrides(current) }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return next
  const src = patch as Record<string, unknown>
  for (const def of SHORTCUT_REGISTRY) {
    if (!Object.prototype.hasOwnProperty.call(src, def.id)) continue
    const val = src[def.id]
    if (val === null || val === undefined) {
      delete next[def.id]
    } else if (val === '') {
      next[def.id] = ''
    } else if (typeof val === 'string') {
      const v = validateAccelerator(val)
      if (v.ok && v.accelerator) {
        if (v.accelerator === def.defaultAccelerator) delete next[def.id]
        else next[def.id] = v.accelerator
      }
    }
  }
  return next
}

/** Returns the first OTHER shortcut currently bound to `candidateAccelerator`, or null if free. */
export function findShortcutConflict(
  overrides: ShortcutOverrides | undefined | null,
  targetId: ShortcutId,
  candidateAccelerator: string
): ShortcutDef | null {
  const resolved = resolveShortcuts(overrides)
  for (const def of SHORTCUT_REGISTRY) {
    if (def.id === targetId) continue
    if (resolved[def.id] && resolved[def.id] === candidateAccelerator) {
      return def
    }
  }
  return null
}

/** Matches a keyDown event against the active resolved shortcut map. */
export function matchShortcut(
  ev: KeyEventLike,
  resolved: ResolvedShortcuts,
  platform: string = 'win32'
): ShortcutId | null {
  const acc = acceleratorFromKeyEvent(ev, platform)
  if (!acc) return null
  for (const def of SHORTCUT_REGISTRY) {
    const bound = resolved[def.id]
    if (!bound) continue
    if (bound === acc) return def.id
  }
  // Treat Ctrl+Shift+= (e.g. Ctrl++) as Ctrl+= when zoom-in is still on Ctrl+= and Ctrl+Shift+= isn't bound.
  if (acc === 'Ctrl+Shift+=' && resolved['zoom-in'] === 'Ctrl+=') {
    return 'zoom-in'
  }
  return null
}

/** Formats a canonical accelerator for clean UI/menu display (e.g. Ctrl+- -> Ctrl+−). */
export function formatShortcutLabel(acc: string | undefined): string | undefined {
  if (!acc) return undefined
  return acc.replace(/\+-$/, '+−')
}

/** Converts a canonical accelerator to Electron MenuItem accelerator syntax. */
export function toElectronAccelerator(acc: string | undefined): string | undefined {
  if (!acc) return undefined
  return acc.replace(/^Ctrl\+/, 'CmdOrCtrl+')
}
