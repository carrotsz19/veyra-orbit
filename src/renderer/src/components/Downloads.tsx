import {
  Download,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  Package,
  Pause,
  Play,
  X
} from 'lucide-react'
import type { DownloadInfo } from '@shared/types'
import {
  RECENT_DOWNLOADS_LIMIT,
  downloadFileCategory,
  formatBytes,
  formatSpeed,
  summarizeDownloads,
  type DownloadFileCategory
} from '@shared/downloads'

const api = window.veyra

const CATEGORY_ICON: Record<DownloadFileCategory, typeof File> = {
  archive: FileArchive,
  audio: FileAudio,
  code: FileCode,
  document: FileText,
  image: FileImage,
  installer: Package,
  pdf: FileText,
  video: FileVideo,
  file: File
}

export function DownloadFileIcon({ filename, size = 14 }: { filename: string; size?: number }): React.JSX.Element {
  const cat = downloadFileCategory(filename)
  const Icon = CATEGORY_ICON[cat]
  return <Icon size={size} strokeWidth={1.75} className={`dl-file-icon cat-${cat}`} aria-hidden />
}

export function downloadMetaText(d: DownloadInfo): string {
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

interface TriggerProps {
  items: DownloadInfo[]
  open: boolean
  hasUnseen: boolean
  pulseTick: number
  onToggle: () => void
}

const RING_R = 11
const RING_C = 2 * Math.PI * RING_R

/**
 * Zen-style downloads button placed at the bottom-left of the sidebar footer.
 * Displays a circular progress ring while downloading and an active count badge.
 */
export function DownloadTriggerButton({ items, open, hasUnseen, pulseTick, onToggle }: TriggerProps): React.JSX.Element {
  const summary = summarizeDownloads(items)
  const downloading = summary.inProgressCount > 0
  const indeterminate = downloading && summary.progress === null
  const pct = summary.progress !== null ? Math.round(summary.progress * 100) : null
  const dashOffset = summary.progress !== null ? RING_C * (1 - summary.progress) : RING_C * 0.72

  const tooltip = downloading
    ? `Downloads · ${summary.inProgressCount} active${pct !== null ? ` (${pct}%)` : ''} · Ctrl+J`
    : items.length > 0
      ? `Downloads (${items.length}) · Ctrl+J`
      : 'Downloads · Ctrl+J'

  return (
    <button
      key={pulseTick > 0 ? `dl-trig-${pulseTick}` : 'dl-trig'}
      type="button"
      className={`dl-trigger ${open ? 'on' : ''} ${downloading ? 'active' : ''} ${summary.activeCount === 0 && summary.pausedCount > 0 ? 'paused' : ''} ${pulseTick > 0 ? 'pulse' : ''}`}
      aria-label={downloading ? `Downloads, ${summary.inProgressCount} in progress` : 'Downloads'}
      aria-expanded={open}
      title={tooltip}
      onClick={onToggle}
    >
      {downloading && (
        <svg className={`dl-ring-svg ${indeterminate ? 'indeterminate' : ''}`} viewBox="0 0 26 26" aria-hidden>
          <circle className="dl-ring-track" cx="13" cy="13" r={RING_R} />
          <circle
            className="dl-ring-arc"
            cx="13"
            cy="13"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={dashOffset}
          />
        </svg>
      )}
      <Download size={14} strokeWidth={1.85} aria-hidden />
      {summary.inProgressCount > 0 ? (
        <span className="dl-trigger-badge" aria-hidden>
          {summary.inProgressCount > 9 ? '9+' : summary.inProgressCount}
        </span>
      ) : hasUnseen ? (
        <span className="dl-trigger-dot" aria-hidden />
      ) : null}
    </button>
  )
}

interface Props {
  items: DownloadInfo[]
  onClose: () => void
}

/** Compact Zen-style downloads drawer anchored just above the sidebar footer. */
export function Downloads({ items, onClose }: Props): React.JSX.Element {
  const summary = summarizeDownloads(items)
  const recent = items.slice(0, RECENT_DOWNLOADS_LIMIT)
  const hasMore = items.length > recent.length

  const showAll = (): void => {
    api.openInternal('orbit://downloads')
    onClose()
  }

  return (
    <section className="downloads dl-drawer" aria-label="Recent downloads">
      <div className="downloads-head">
        <span className="downloads-title">
          Downloads
          {summary.activeCount > 0 && <span className="downloads-badge">{summary.activeCount}</span>}
        </span>
        <div className="downloads-head-actions">
          {summary.hasFinished && (
            <button type="button" className="downloads-clear" title="Clear finished downloads" onClick={() => api.clearFinishedDownloads()}>
              Clear
            </button>
          )}
          <button type="button" className="downloads-clear" title="Show all downloads (orbit://downloads)" onClick={showAll}>
            Show all
          </button>
          <button type="button" className="dl-btn" aria-label="Hide downloads" title="Hide downloads (Ctrl+J)" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
      </div>

      {recent.length === 0 ? (
        <div className="downloads-empty">No downloads yet</div>
      ) : (
        <div className="downloads-list">
          {recent.map((d) => {
            const active = d.state === 'progressing' || d.state === 'paused'
            const finished = !active && !(d.state === 'interrupted' && d.canResume)
            const completed = d.state === 'completed'
            const pct = d.totalBytes > 0 ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100)) : null
            return (
              <div
                key={d.id}
                className={`dl-item ${d.state} ${completed ? 'draggable' : ''}`}
                draggable={completed}
                onDragStart={(e) => {
                  if (!completed) return
                  e.preventDefault()
                  api.dragDownload(d.id)
                }}
              >
                <div className="dl-top">
                  <span className="dl-icon">
                    <DownloadFileIcon filename={d.filename} size={14} />
                  </span>
                  <div className="dl-body">
                    {completed ? (
                      <button
                        type="button"
                        className="dl-name clickable"
                        title={`${d.filename}\nClick to open · Drag to another app`}
                        onClick={() => api.openDownload(d.id)}
                      >
                        {d.filename}
                      </button>
                    ) : (
                      <span className="dl-name" title={d.filename}>
                        {d.filename}
                      </span>
                    )}
                    <div className="dl-meta">{downloadMetaText(d)}</div>
                  </div>
                  <div className="dl-actions">
                    {d.state === 'progressing' && (
                      <button type="button" className="dl-btn" aria-label="Pause download" title="Pause" onClick={() => api.pauseDownload(d.id)}>
                        <Pause size={12} />
                      </button>
                    )}
                    {(d.state === 'paused' || (d.state === 'interrupted' && d.canResume)) && (
                      <button
                        type="button"
                        className="dl-btn"
                        aria-label="Resume download"
                        title="Resume"
                        disabled={!d.canResume}
                        onClick={() => api.resumeDownload(d.id)}
                      >
                        <Play size={12} />
                      </button>
                    )}
                    {(active || (d.state === 'interrupted' && d.canResume)) && (
                      <button type="button" className="dl-btn" aria-label="Cancel download" title="Cancel" onClick={() => api.cancelDownload(d.id)}>
                        <X size={12} />
                      </button>
                    )}
                    {completed && (
                      <button type="button" className="dl-btn" aria-label="Show in folder" title="Show in folder" onClick={() => api.showDownload(d.id)}>
                        <FolderOpen size={12} />
                      </button>
                    )}
                    {finished && (
                      <button
                        type="button"
                        className="dl-btn"
                        aria-label="Remove from list"
                        title="Remove from list"
                        onClick={() => api.removeDownload(d.id)}
                      >
                        <X size={12} />
                      </button>
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
              </div>
            )
          })}
          {hasMore && (
            <button type="button" className="dl-show-more" onClick={showAll}>
              Show all {items.length} downloads
            </button>
          )}
        </div>
      )}
    </section>
  )
}
