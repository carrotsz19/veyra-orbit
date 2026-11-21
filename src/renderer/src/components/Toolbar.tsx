import { ArrowLeft, ArrowRight, RotateCw, X } from 'lucide-react'
import type { TabInfo } from '@shared/types'
import { Omnibox } from './Omnibox'
import { isInternalUrl } from '@shared/url'

const api = window.veyra

export function Toolbar({ tab, onPageShot }: { tab?: TabInfo; onPageShot: (shot: string | null) => void }): React.JSX.Element {
  return (
    <header className="bar">
      <div className="nav">
        <button className="icon-btn" aria-label="Back" title="Back (Alt+Left)" disabled={!tab?.canGoBack} onClick={() => api.back()}>
          <ArrowLeft size={17} />
        </button>
        <button className="icon-btn" aria-label="Forward" title="Forward (Alt+Right)" disabled={!tab?.canGoForward} onClick={() => api.forward()}>
          <ArrowRight size={17} />
        </button>
        {tab?.loading ? (
          <button className="icon-btn" aria-label="Stop" title="Stop" onClick={() => api.stop()}>
            <X size={17} />
          </button>
        ) : (
          <button className="icon-btn" aria-label="Reload" title="Reload (Ctrl+R)" disabled={!tab?.url || isInternalUrl(tab.url)} onClick={() => api.reload()}>
            <RotateCw size={16} />
          </button>
        )}
      </div>

      <Omnibox tab={tab} onPageShot={onPageShot} />
      <div className="caption-space" />
    </header>
  )
}
