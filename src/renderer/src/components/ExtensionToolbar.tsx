import { useEffect, useRef } from 'react'
import { Puzzle } from 'lucide-react'
import type { ExtensionActionView } from '@shared/types'

const api = window.veyra

interface ExtensionToolbarProps {
  actions: ExtensionActionView[]
  compact?: boolean
  overflowOpen: boolean
  puzzleBtnRef: (el: HTMLButtonElement | null) => void
  onToggleOverflow: (e: React.MouseEvent<HTMLButtonElement>) => void
}

/**
 * Toolbar strip rendered next to the omnibox: shows pinned extension action buttons
 * (icon, badge text/colour, tooltip) and a puzzle-piece overflow menu button.
 */
export function ExtensionToolbar({
  actions,
  compact = false,
  overflowOpen,
  puzzleBtnRef,
  onToggleOverflow
}: ExtensionToolbarProps): React.JSX.Element | null {
  const toolbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Keep refs clean if actions disappear
  }, [actions.length])

  if (actions.length === 0) return null

  const maxPinned = compact ? 3 : 6
  const pinned = actions.filter((a) => a.pinned)
  const visiblePinned = pinned.slice(0, maxPinned)

  const sendClick = (id: string, el: HTMLElement): void => {
    const r = el.getBoundingClientRect()
    api.extensions.clickAction(id, { x: r.left, y: r.top, width: r.width, height: r.height })
  }

  const sendContextMenu = (id: string, el: HTMLElement): void => {
    const r = el.getBoundingClientRect()
    api.extensions.contextMenuAction(id, { x: r.left, y: r.top, width: r.width, height: r.height })
  }

  return (
    <div className="ext-toolbar" ref={toolbarRef} role="group" aria-label="Extensions">
      {visiblePinned.map((act) => (
        <button
          key={act.id}
          type="button"
          className="icon-btn ext-btn"
          aria-label={act.title || act.name}
          title={act.title || act.name}
          onClick={(e) => sendClick(act.id, e.currentTarget)}
          onContextMenu={(e) => {
            e.preventDefault()
            sendContextMenu(act.id, e.currentTarget)
          }}
        >
          {act.iconDataUrl ? (
            <img className="ext-btn-icon" src={act.iconDataUrl} alt="" draggable={false} />
          ) : (
            <Puzzle size={15} aria-hidden />
          )}
          {act.badgeText && (
            <span
              className="ext-badge"
              style={{ backgroundColor: act.badgeColor || 'var(--tint)' }}
              aria-hidden
            >
              {act.badgeText.slice(0, 4)}
            </span>
          )}
        </button>
      ))}
      <button
        type="button"
        ref={puzzleBtnRef}
        className={`icon-btn ext-puzzle-btn ${overflowOpen ? 'open' : ''}`}
        aria-label="Extensions menu"
        aria-haspopup="menu"
        aria-expanded={overflowOpen}
        title="Extensions"
        onMouseDown={onToggleOverflow}
      >
        <Puzzle size={15} strokeWidth={1.85} aria-hidden />
      </button>
    </div>
  )
}
