import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { ExternalAppAsk, PermissionAsk } from '@shared/types'
import { permissionAskText } from '@shared/permissions'

const api = window.veyra

function hostOf(origin: string): string {
  if (!origin) return 'This page'
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

export function PermissionBar({ ask }: { ask: PermissionAsk }): React.JSX.Element {
  const [remember, setRemember] = useState(true)
  useEffect(() => {
    setRemember(true)
  }, [ask.id])

  const host = hostOf(ask.origin)
  return (
    <div className="perm" role="alertdialog" aria-label="Permission request">
      <div className="perm-copy">
        <span>
          <b>{host}</b> wants to {permissionAskText(ask.permission)}.
        </span>
        <label className="perm-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Remember this decision</span>
        </label>
      </div>
      <div className="perm-actions">
        <button className="btn" onClick={() => api.answerPermission(ask.id, false, remember)}>
          Don't allow
        </button>
        <button className="btn primary" onClick={() => api.answerPermission(ask.id, true, remember)}>
          Allow
        </button>
      </div>
    </div>
  )
}

export function ExternalAppBar({ ask }: { ask: ExternalAppAsk }): React.JSX.Element {
  const host = hostOf(ask.origin)
  return (
    <div className="perm" role="alertdialog" aria-label="Open external application">
      <div className="perm-copy" title={ask.url}>
        <ExternalLink size={15} className="perm-icon" aria-hidden />
        <span>
          <b>{host}</b> wants to open <b>{ask.appName}</b> <span className="perm-scheme">({ask.scheme}:)</span>.
        </span>
      </div>
      <div className="perm-actions">
        <button className="btn" onClick={() => api.answerExternalApp(ask.id, false)}>
          Don't allow
        </button>
        <button className="btn primary" onClick={() => api.answerExternalApp(ask.id, true)}>
          Open
        </button>
      </div>
    </div>
  )
}
