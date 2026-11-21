import { CloudOff, ShieldAlert, Unplug } from 'lucide-react'
import type { TabInfo } from '@shared/types'
import { displayUrl } from '@shared/url'

const api = window.veyra

function explain(code: string): { title: string; body: string; icon: 'shield' | 'offline' | 'other'; retry: boolean } {
  if (code.startsWith('ERR_CERT_') || code === 'ERR_SSL_PROTOCOL_ERROR' || code === 'ERR_BAD_SSL_CLIENT_AUTH_CERT')
    return { title: "This site isn't safe to open", body: "Its security certificate isn't valid, so someone could be reading or changing what you send it. Veyra won't open it.", icon: 'shield', retry: false }
  if (code === 'ERR_INTERNET_DISCONNECTED') return { title: "You're offline", body: 'Check your Wi-Fi or network, then try again.', icon: 'offline', retry: true }
  if (code === 'ERR_NAME_NOT_RESOLVED') return { title: "Can't find this site", body: 'Check the address for typos. The site may also be down.', icon: 'other', retry: true }
  if (code === 'ERR_CONNECTION_REFUSED') return { title: 'This site refused to connect', body: "It may be down, or it doesn't accept connections here.", icon: 'other', retry: true }
  if (code === 'ERR_CONNECTION_TIMED_OUT' || code === 'ERR_TIMED_OUT') return { title: 'This site took too long to answer', body: 'Try again in a moment.', icon: 'other', retry: true }
  if (code === 'PAGE_CRASHED') return { title: 'This page stopped working', body: 'Reloading it usually helps.', icon: 'other', retry: true }
  if (code === 'ERR_BLOCKED_BY_CLIENT' || code === 'ERR_BLOCKED_BY_RESPONSE') return { title: 'This page was blocked', body: "The site doesn't allow itself to be shown here.", icon: 'shield', retry: false }
  return { title: "This page didn't load", body: 'Something went wrong while opening it.', icon: 'other', retry: true }
}

export function ErrorPage({ tab }: { tab: TabInfo }): React.JSX.Element {
  const err = tab.error!
  const code = err.description.replace(/^net::/, '')
  const e = explain(code)
  const Icon = e.icon === 'shield' ? ShieldAlert : e.icon === 'offline' ? CloudOff : Unplug
  return (
    <div className="error">
      <Icon size={36} strokeWidth={1.5} className={`error-icon ${e.icon}`} />
      <h1>{e.title}</h1>
      <p>{e.body}</p>
      <p className="error-meta">
        {displayUrl(err.url)} · <code>{code}</code>
      </p>
      <div className="error-actions">
        {e.retry && (
          <button className="btn primary" onClick={() => api.reload()}>
            Try again
          </button>
        )}
        {tab.canGoBack && (
          <button className="btn" onClick={() => api.back()}>
            Go back
          </button>
        )}
      </div>
    </div>
  )
}
