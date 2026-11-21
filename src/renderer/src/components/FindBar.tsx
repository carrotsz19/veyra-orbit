import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { FindState } from '@shared/types'

const api = window.veyra

interface Props {
  open: boolean
  focusTick: number
  onClose: () => void
}

export function FindBar({ open, focusTick, onClose }: Props): React.JSX.Element | null {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<FindState | null>(null)

  useEffect(() => api.onFindResult(setResult), [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResult(null)
      return
    }
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [open, focusTick])

  if (!open) return null

  const close = (): void => {
    api.stopFind()
    setQuery('')
    setResult(null)
    onClose()
  }

  const step = (forward: boolean): void => {
    if (!query) return
    api.find(query, { forward, findNext: false })
  }

  const noMatches = query.length > 0 && result !== null && result.finalUpdate && result.matches === 0
  const hasMatches = query.length > 0 && result !== null && result.matches > 0

  return (
    <div className="find" role="search" aria-label="Find in page">
      <div className={`find-field ${noMatches ? 'empty' : ''}`}>
        <Search size={14} className="find-icon" />
        <input
          ref={inputRef}
          value={query}
          spellCheck={false}
          placeholder="Find in page"
          aria-label="Find in page"
          onChange={(e) => {
            const next = e.target.value
            setQuery(next)
            if (!next) setResult(null)
            api.find(next, { forward: true, findNext: true })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              step(!e.shiftKey)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
        />
        {query.length > 0 && result !== null && (
          <span className={`find-count ${noMatches ? 'empty' : ''}`} aria-live="polite">
            {hasMatches ? `${result.activeMatch} of ${result.matches}` : noMatches ? 'No matches' : ''}
          </span>
        )}
      </div>
      <div className="find-actions">
        <button className="icon-btn" aria-label="Previous match" title="Previous (Shift+Enter / Shift+F3)" disabled={!hasMatches} onClick={() => step(false)}>
          <ChevronUp size={16} />
        </button>
        <button className="icon-btn" aria-label="Next match" title="Next (Enter / F3)" disabled={!hasMatches} onClick={() => step(true)}>
          <ChevronDown size={16} />
        </button>
        <button className="icon-btn" aria-label="Close find bar" title="Close (Esc)" onClick={close}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
