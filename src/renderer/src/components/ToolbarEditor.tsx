import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Columns2,
  Download,
  GripVertical,
  Home,
  Layers,
  PanelLeft,
  Plus,
  Puzzle,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  Star,
  X
} from 'lucide-react'
import type { ToolbarButtonId, ToolbarItemId } from '@shared/types'
import {
  DEFAULT_TOOLBAR_ITEMS,
  TOOLBAR_BUTTONS,
  addToolbarButton,
  availableToolbarButtons,
  isToolbarButtonId,
  isToolbarItemId,
  moveToolbarItem,
  removeToolbarButton,
  sanitizeToolbarItems
} from '@shared/toolbar'

function ToolbarItemIcon({ id, size = 13 }: { id: ToolbarItemId; size?: number }): React.JSX.Element {
  switch (id) {
    case 'address-bar':
      return <Search size={size} strokeWidth={1.75} aria-hidden />
    case 'back':
      return <ArrowLeft size={size} strokeWidth={1.75} aria-hidden />
    case 'forward':
      return <ArrowRight size={size} strokeWidth={1.75} aria-hidden />
    case 'reload':
      return <RotateCw size={size} strokeWidth={1.75} aria-hidden />
    case 'home':
      return <Home size={size} strokeWidth={1.75} aria-hidden />
    case 'bookmark-star':
      return <Star size={size} strokeWidth={1.75} aria-hidden />
    case 'downloads':
      return <Download size={size} strokeWidth={1.75} aria-hidden />
    case 'extensions':
      return <Puzzle size={size} strokeWidth={1.75} aria-hidden />
    case 'split':
      return <Columns2 size={size} strokeWidth={1.75} aria-hidden />
    case 'sidebar-toggle':
      return <PanelLeft size={size} strokeWidth={1.75} aria-hidden />
    case 'screenshot':
      return <Camera size={size} strokeWidth={1.75} aria-hidden />
    case 'workspaces':
      return <Layers size={size} strokeWidth={1.75} aria-hidden />
    case 'settings':
      return <Settings size={size} strokeWidth={1.75} aria-hidden />
  }
}

function itemLabel(id: ToolbarItemId): string {
  if (id === 'address-bar') return 'Address bar'
  return TOOLBAR_BUTTONS.find((b) => b.id === id)?.label ?? id
}

interface EditorProps {
  items: readonly ToolbarItemId[]
  onChange: (next: ToolbarItemId[]) => void
}

export function ToolbarEditor({ items, onChange }: EditorProps): React.JSX.Element {
  const activeItems = sanitizeToolbarItems(items)
  const available = availableToolbarButtons(activeItems)
  const [dragId, setDragId] = useState<ToolbarItemId | null>(null)
  const [dropZone, setDropZone] = useState<'active' | 'available' | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const isDefault =
    activeItems.length === DEFAULT_TOOLBAR_ITEMS.length &&
    activeItems.every((id, i) => id === DEFAULT_TOOLBAR_ITEMS[i])

  const startDrag = (e: React.DragEvent, id: ToolbarItemId): void => {
    e.dataTransfer.setData('text/x-orbit-toolbar', id)
    e.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }

  const endDrag = (): void => {
    setDragId(null)
    setDropZone(null)
    setDropIndex(null)
  }

  const readDraggedId = (e: React.DragEvent): ToolbarItemId | null => {
    if (dragId) return dragId
    const raw = e.dataTransfer.getData('text/x-orbit-toolbar')
    return isToolbarItemId(raw) ? raw : null
  }

  const handleDropOnActive = (e: React.DragEvent, index?: number): void => {
    e.preventDefault()
    e.stopPropagation()
    const id = readDraggedId(e)
    endDrag()
    if (!id) return
    const target = index !== undefined ? index : activeItems.length
    onChange(moveToolbarItem(activeItems, id, target))
  }

  const handleDropOnAvailable = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const id = readDraggedId(e)
    endDrag()
    if (!id || !isToolbarButtonId(id)) return
    onChange(removeToolbarButton(activeItems, id))
  }

  return (
    <div className="tb-ed">
      <div className="tb-ed-group">
        <div className="tb-ed-head">
          <span className="tb-ed-title">In toolbar</span>
          <button
            type="button"
            className="btn sm ghost"
            disabled={isDefault}
            onClick={() => onChange([...DEFAULT_TOOLBAR_ITEMS])}
          >
            <RotateCcw size={12} aria-hidden />
            <span>Reset</span>
          </button>
        </div>
        <div
          className={`tb-ed-zone ${dropZone === 'active' ? 'drag-over' : ''}`}
          role="list"
          aria-label="Buttons in toolbar"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropZone('active')
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDropZone(null)
              setDropIndex(null)
            }
          }}
          onDrop={(e) => handleDropOnActive(e)}
        >
          {activeItems.map((id, idx) => {
            const locked = id === 'address-bar'
            return (
              <div
                key={id}
                role="listitem"
                draggable
                className={`tb-ed-chip ${locked ? 'locked' : ''} ${dragId === id ? 'dragging' : ''} ${dropZone === 'active' && dropIndex === idx ? 'insert-before' : ''}`}
                title={locked ? 'Address bar (drag buttons before or after it)' : `${itemLabel(id)} — drag to reorder or remove`}
                onDragStart={(e) => startDrag(e, id)}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'move'
                  setDropZone('active')
                  setDropIndex(idx)
                }}
                onDrop={(e) => handleDropOnActive(e, idx)}
              >
                <GripVertical size={11} className="tb-ed-grip" aria-hidden />
                <ToolbarItemIcon id={id} />
                <span className="tb-ed-label">{itemLabel(id)}</span>
                {!locked && (
                  <button
                    type="button"
                    className="tb-ed-rm"
                    aria-label={`Remove ${itemLabel(id)} from toolbar`}
                    title="Remove from toolbar"
                    onClick={() => onChange(removeToolbarButton(activeItems, id as ToolbarButtonId))}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="tb-ed-group">
        <div className="tb-ed-head">
          <span className="tb-ed-title">Available</span>
          <span className="tb-ed-sub">Drag onto the toolbar or click to add</span>
        </div>
        <div
          className={`tb-ed-zone available ${dropZone === 'available' ? 'drag-over' : ''}`}
          role="list"
          aria-label="Available toolbar buttons"
          onDragOver={(e) => {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropZone('available')
            setDropIndex(null)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropZone(null)
          }}
          onDrop={handleDropOnAvailable}
        >
          {available.length === 0 ? (
            <span className="tb-ed-empty">All buttons are in the toolbar. Drag any button here to hide it.</span>
          ) : (
            available.map((btn) => (
              <div
                key={btn.id}
                role="listitem"
                draggable
                className={`tb-ed-chip available ${dragId === btn.id ? 'dragging' : ''}`}
                title={`${btn.label} — ${btn.description}`}
                onDragStart={(e) => startDrag(e, btn.id)}
                onDragEnd={endDrag}
                onClick={() => onChange(addToolbarButton(activeItems, btn.id))}
              >
                <ToolbarItemIcon id={btn.id} />
                <span className="tb-ed-label">{btn.label}</span>
                <Plus size={11} className="tb-ed-add" aria-hidden />
              </div>
            ))
          )}
        </div>
      </div>

      <p className="tb-ed-note">The “Restart to update” pill appears automatically whenever an update is ready.</p>
    </div>
  )
}

export function ToolbarCustomizeSheet({
  items,
  onChange,
  onClose
}: {
  items: readonly ToolbarItemId[]
  onChange: (next: ToolbarItemId[]) => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tb-sheet-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <div className="sheet-card tb-sheet-card">
        <div className="sheet-head">
          <div>
            <h2 id="tb-sheet-title">Customize toolbar</h2>
            <p className="sheet-sub">Drag buttons to arrange them around the address bar.</p>
          </div>
          <button type="button" className="icon-btn small" aria-label="Close" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="sheet-body">
          <ToolbarEditor items={items} onChange={onChange} />
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
