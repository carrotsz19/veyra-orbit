import { ArrowLeft, ArrowRight, RotateCw, X } from 'lucide-react'
import type { TabInfo } from '@shared/types'
import { Omnibox } from './Omnibox'
import { isInternalUrl } from '@shared/url'

const api = window.veyra

export function Toolbar({
  tab,
  onPageShot,
  onEditingChange,
  onPointerEdge
}: {
  tab?: TabInfo
  onPageShot: (shot: string | null) => void
  onEditingChange?: (editing: boolean) => void
  onPointerEdge?: (inside: boolean) => void
}): React.JSX.Element {
  return (
    <header
      className="bar"
      onMouseEnter={() => onPointerEdge?.(true)}
      onMouseLeave={() => onPointerEdge?.(false)}
    >
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

      <Omnibox tab={tab} onPageShot={onPageShot} onEditingChange={onEditingChange} />
      {tab && tab.zoom !== 100 && (
        <button className="zoom-pill" aria-label={`Zoom ${tab.zoom}%, click to reset`} title="Reset zoom (Ctrl+0)" onClick={() => api.resetZoom()}>
          {tab.zoom}%
        </button>
      )}
      <div className="caption-space" />
    </header>
  )
}
