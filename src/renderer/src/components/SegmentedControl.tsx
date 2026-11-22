import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export interface SegmentedOption<T extends string | number> {
  value: T
  label: string
  tone?: 'allow' | 'block'
}

interface SegmentedControlProps<T extends string | number> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  compact?: boolean
  fullWidth?: boolean
  tabIndex?: number
}

/**
 * macOS-style segmented control with a smooth sliding selection pill.
 * Under reduced/off motion, CSS collapses the slide transition to a simple fade/instant update.
 */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  compact = false,
  fullWidth = false,
  tabIndex = 0
}: SegmentedControlProps<T>): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef(new Map<T, HTMLButtonElement | null>())
  const [thumb, setThumb] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false
  })

  const measure = useCallback((): void => {
    const track = trackRef.current
    const activeBtn = btnRefs.current.get(value)
    if (!track || !activeBtn) return
    const left = activeBtn.offsetLeft
    const width = activeBtn.offsetWidth
    if (width > 0) {
      setThumb((prev) =>
        prev.left === left && prev.width === width && prev.ready ? prev : { left, width, ready: true }
      )
    }
  }, [value])

  useLayoutEffect(() => {
    measure()
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(track)
    return () => ro.disconnect()
  }, [measure, options.length])

  return (
    <div
      ref={trackRef}
      className={`set-seg ${compact ? 'compact' : ''} ${fullWidth ? 'sp-seg-full' : ''}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {thumb.ready && (
        <span
          className="set-seg-thumb"
          aria-hidden
          style={{
            width: `${thumb.width}px`,
            transform: `translate3d(${thumb.left}px, 0, 0)`
          }}
        />
      )}
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            ref={(el) => void btnRefs.current.set(opt.value, el)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={tabIndex}
            className={`set-seg-btn ${active ? 'on' : ''} ${active && opt.tone ? opt.tone : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
