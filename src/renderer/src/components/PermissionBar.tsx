import type { PermissionAsk } from '@shared/types'

const api = window.veyra

const WHAT: Record<string, string> = {
  media: 'use your camera or microphone',
  notifications: 'show notifications',
  geolocation: 'know your location',
  'clipboard-read': 'see what you copied',
  midi: 'use your MIDI devices',
  'idle-detection': "know when you're away",
  'display-capture': 'see your screen'
}

export function PermissionBar({ ask }: { ask: PermissionAsk }): React.JSX.Element {
  let host = ask.origin
  try {
    host = new URL(ask.origin).host
  } catch {
    /* keep the origin as given */
  }
  return (
    <div className="perm" role="alertdialog" aria-label="Permission request">
      <span>
        <b>{host}</b> wants to {WHAT[ask.permission] ?? ask.permission}.
      </span>
      <div className="perm-actions">
        <button className="btn" onClick={() => api.answerPermission(ask.id, false)}>
          Don't allow
        </button>
        <button className="btn primary" onClick={() => api.answerPermission(ask.id, true)}>
          Allow
        </button>
      </div>
    </div>
  )
}
