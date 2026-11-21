/*
 * Askable site permissions, their labels, and origin validation.
 * Pure, shared between main (security/store), renderer (PermissionBar/Settings), and tests.
 */

/** Permissions the person can be asked for. Anything not listed is always denied (except ALWAYS in security.ts). */
export const ASKABLE_PERMISSIONS = [
  'media',
  'notifications',
  'geolocation',
  'clipboard-read',
  'midi',
  'idle-detection',
  'display-capture'
] as const

export type AskablePermission = (typeof ASKABLE_PERMISSIONS)[number]

const ASKABLE_SET = new Set<string>(ASKABLE_PERMISSIONS)

export const PERMISSION_LABELS: Record<AskablePermission, { ask: string; name: string }> = {
  media: { ask: 'use your camera or microphone', name: 'Camera and microphone' },
  notifications: { ask: 'show notifications', name: 'Notifications' },
  geolocation: { ask: 'know your location', name: 'Location' },
  'clipboard-read': { ask: 'see what you copied', name: 'Clipboard' },
  midi: { ask: 'use your MIDI devices', name: 'MIDI devices' },
  'idle-detection': { ask: "know when you're away", name: 'Idle detection' },
  'display-capture': { ask: 'see your screen', name: 'Screen sharing' }
}

export function isAskablePermission(permission: string): permission is AskablePermission {
  return ASKABLE_SET.has(permission)
}

export function permissionAskText(permission: string): string {
  return isAskablePermission(permission) ? PERMISSION_LABELS[permission].ask : permission
}

export function permissionName(permission: string): string {
  return isAskablePermission(permission) ? PERMISSION_LABELS[permission].name : permission
}

/** Normalizes an http(s) URL or origin to its canonical origin, or '' if not a valid web origin. */
export function normalizePermissionOrigin(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.origin === 'null' ? '' : u.origin
  } catch {
    return ''
  }
}
