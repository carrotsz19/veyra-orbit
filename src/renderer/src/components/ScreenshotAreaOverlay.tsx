import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { ScreenshotAreaInit, ScreenshotAreaRect } from '@shared/types'
import { MIN_AREA_SELECTION_PX } from '@shared/screenshot'

interface Props {
  init: ScreenshotAreaInit
  onCommit: (rect: ScreenshotAreaRect) => void
  onCancel: () => void
}

/**
 * In-window area selection overlay drawn entirely by Orbit's own main UI (never injected into page JS).
 * Displays the frozen page capture while native WebContentsViews are hidden and lets the user drag a rectangle.
 */
export function ScreenshotAreaOverlay({ init, onCommit, onCancel }: Props): React.JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onCancel])

  const localPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(r.width, clientX - r.left)),
      y: Math.max(0, Math.min(r.height, clientY - r.top))
    }
  }

  const selection: ScreenshotAreaRect | null =
    start && current
      ? {
          x: Math.min(start.x, current.x),
          y: Math.min(start.y, current.y),
          width: Math.abs(current.x - start.x),
          height: Math.abs(current.y - start.y)
        }
      : null

  return (
    <div
      ref={wrapRef}
      className="shot-area-overlay"
      role="dialog"
      aria-label="Select screenshot area"
      style={{
        left: init.offsetX,
        top: init.offsetY,
        width: init.cssWidth,
        height: init.cssHeight
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        const pt = localPoint(e.clientX, e.clientY)
        setStart(pt)
        setCurrent(pt)
      }}
      onPointerMove={(e) => {
        if (!start) return
        setCurrent(localPoint(e.clientX, e.clientY))
      }}
      onPointerUp={(e) => {
        if (!start) return
        const end = localPoint(e.clientX, e.clientY)
        const rect: ScreenshotAreaRect = {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y)
        }
        setStart(null)
        setCurrent(null)
        if (rect.width >= MIN_AREA_SELECTION_PX && rect.height >= MIN_AREA_SELECTION_PX) {
          onCommit(rect)
        }
      }}
      onPointerCancel={() => {
        setStart(null)
        setCurrent(null)
      }}
    >
      <img src={init.imageDataUrl} alt="" className="shot-area-bg" draggable={false} />
      {(!selection || selection.width < 2 || selection.height < 2) && <div className="shot-area-scrim" aria-hidden />}
      {selection && selection.width >= 2 && selection.height >= 2 && (
        <div
          className="shot-area-rect"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height
          }}
        >
          <span className="shot-area-size">
            {Math.round(selection.width)} × {Math.round(selection.height)}
          </span>
        </div>
      )}
      <div className="shot-area-hint" onPointerDown={(e) => e.stopPropagation()}>
        <span>Drag to select an area · Esc to cancel</span>
        <button type="button" className="shot-area-cancel" aria-label="Cancel screenshot" onClick={onCancel}>
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
