import { useState } from 'react'
import { Search } from 'lucide-react'

const api = window.veyra

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** What a new tab shows. Later: today's tasks, the focus timer and recent notes from Veyra Study. */
export function StartPage({ tabId }: { tabId: number }): React.JSX.Element {
  const [text, setText] = useState('')
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className="start">
      <p className="start-date">{today}</p>
      <h1 className="start-hello">{greeting()}.</h1>
      <form
        className="start-search"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) api.navigate(tabId, text)
        }}
      >
        <Search size={18} />
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search or type a web address" aria-label="Search or type a web address" />
      </form>
      <p className="start-hint">
        <kbd>Ctrl L</kbd> address bar · <kbd>Ctrl T</kbd> new tab · <kbd>Ctrl Shift T</kbd> reopen a closed tab
      </p>
    </div>
  )
}
