import { Puzzle, ShieldAlert } from 'lucide-react'
import type { ExtensionInstallAsk } from '@shared/types'

const api = window.veyra

export function ExtensionInstallBar({ ask }: { ask: ExtensionInstallAsk }): React.JSX.Element {
  return (
    <div className="perm ext-install-bar" role="alertdialog" aria-label={`Add extension ${ask.name}`}>
      <div className="ext-install-head">
        <div className="ext-install-title-row">
          {ask.iconDataUrl ? (
            <img className="ext-install-icon" src={ask.iconDataUrl} alt="" />
          ) : (
            <span className="ext-install-icon ext-install-icon-fallback" aria-hidden>
              <Puzzle size={16} />
            </span>
          )}
          <div className="ext-install-meta">
            <div className="ext-install-name">
              Add <b>{ask.name}</b>
              {ask.version && <span className="ext-install-ver">v{ask.version}</span>}?
            </div>
            <div className="ext-install-sub">
              {ask.permissions.length > 0
                ? 'This extension can:'
                : 'This extension does not request any special site permissions.'}
            </div>
          </div>
        </div>
        <div className="perm-actions">
          <button type="button" className="btn" onClick={() => api.extensions.answerInstall(ask.requestId, false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => api.extensions.answerInstall(ask.requestId, true)}
          >
            Add extension
          </button>
        </div>
      </div>

      {ask.permissions.length > 0 && (
        <ul className="ext-install-perms">
          {ask.permissions.map((p) => (
            <li key={p.key} className={`ext-install-perm ${p.risk}`}>
              {p.risk === 'high' && <ShieldAlert size={13} className="ext-perm-warn" aria-hidden />}
              <span>{p.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
