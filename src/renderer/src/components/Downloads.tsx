import { Download, ExternalLink, FolderOpen, Pause, Play, X } from 'lucide-react'
import type { DownloadInfo } from '@shared/types'
import { formatBytes, formatSpeed } from '@shared/downloads'

const api = window.veyra

interface Props {
  items: DownloadInfo[]
  onClose: () => void
}

function metaText(d: DownloadInfo): string {
  const received = formatBytes(d.receivedBytes)
  const total = d.totalBytes > 0 ? formatBytes(d.totalBytes) : ''
  if (d.state === 'progressing') {
    const size = total ? `${received} / ${total}` : received
    const speed = formatSpeed(d.speed)
    return speed ? `${size} · ${speed}` : size
  }
  if (d.state === 'paused') {
    const size = total ? `${received} / ${total}` : received
    return `Paused · ${size}`
  }
  if (d.state === 'completed') return formatBytes(d.totalBytes || d.receivedBytes)
  if (d.state === 'cancelled') return 'Cancelled'
  return 'Interrupted'
}

export function Downloads({ items, onClose }: Props): React.JSX.Element {
  const activeCount = items.filter((d) => d.state === 'progressing').length
  const hasFinished = items.some((d) => d.state === 'completed' || d.state === 'cancelled' || (d.state === 'interrupted' && !d.canResume))

  return (
    <section className="downloads" aria-label="Downloads">
      <div className="downloads-head">
        <span className="downloads-title">
          <Download size={13} />
          Downloads
          {activeCount > 0 && <span className="downloads-badge">{activeCount}</span>}
        </span>
        <div className="downloads-head-actions">
          {hasFinished && (
            <button className="downloads-clear" title="Clear finished downloads" onClick={() => api.clearFinishedDownloads()}>
              Clear
            </button>
          )}
          <button className="dl-btn" aria-label="Hide downloads" title="Hide downloads (Ctrl+J)" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="downloads-empty">No downloads yet</div>
      ) : (
        <div className="downloads-list">
          {items.map((d) => {
            const active = d.state === 'progressing' || d.state === 'paused'
            const pct = d.totalBytes > 0 ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100)) : null
            return (
              <div key={d.id} className={`dl-item ${d.state}`}>
                <div className="dl-top">
                  {d.state === 'completed' ? (
                    <button className="dl-name clickable" title={`${d.filename}\nClick to open`} onClick={() => api.openDownload(d.id)}>
                      {d.filename}
                    </button>
                  ) : (
                    <span className="dl-name" title={d.filename}>
                      {d.filename}
                    </span>
                  )}
                  <div className="dl-actions">
                    {d.state === 'progressing' && (
                      <button className="dl-btn" aria-label="Pause download" title="Pause" onClick={() => api.pauseDownload(d.id)}>
                        <Pause size={12} />
                      </button>
                    )}
                    {(d.state === 'paused' || (d.state === 'interrupted' && d.canResume)) && (
                      <button className="dl-btn" aria-label="Resume download" title="Resume" disabled={!d.canResume} onClick={() => api.resumeDownload(d.id)}>
                        <Play size={12} />
                      </button>
                    )}
                    {(active || (d.state === 'interrupted' && d.canResume)) && (
                      <button className="dl-btn" aria-label="Cancel download" title="Cancel" onClick={() => api.cancelDownload(d.id)}>
                        <X size={12} />
                      </button>
                    )}
                    {d.state === 'completed' && (
                      <>
                        <button className="dl-btn" aria-label="Open file" title="Open file" onClick={() => api.openDownload(d.id)}>
                          <ExternalLink size={12} />
                        </button>
                        <button className="dl-btn" aria-label="Show in folder" title="Show in folder" onClick={() => api.showDownload(d.id)}>
                          <FolderOpen size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {active && (
                  <div className="dl-track" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                    <div
                      className={`dl-bar ${d.state === 'paused' ? 'paused' : ''} ${pct === null ? 'indeterminate' : ''}`}
                      style={pct !== null ? { width: `${pct}%` } : undefined}
                    />
                  </div>
                )}
                <div className="dl-meta">{metaText(d)}</div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
