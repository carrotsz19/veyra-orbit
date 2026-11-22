import { useState } from 'react'
import { Check, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { SearchEngine, SettingsPatch, SettingsView } from '@shared/types'
import {
  DEFAULT_SEARCH_ENGINES,
  cloneDefaultSearchEngines,
  sanitizeSearchEngineName,
  sanitizeSearchKeyword,
  validateSearchUrlTemplate
} from '@shared/search'

interface Props {
  settings: SettingsView
  onPatch: (next: SettingsPatch) => void
}

interface EngineDraft {
  mode: 'add' | 'edit'
  id?: string
  name: string
  keyword: string
  urlTemplate: string
  error: string | null
}

export function SettingsSearch({ settings, onPatch }: Props): React.JSX.Element {
  const engines = settings.searchEngines
  const [draft, setDraft] = useState<EngineDraft | null>(null)

  const isDefaultList =
    engines.length === DEFAULT_SEARCH_ENGINES.length &&
    engines.every(
      (e, i) =>
        e.id === DEFAULT_SEARCH_ENGINES[i].id &&
        e.name === DEFAULT_SEARCH_ENGINES[i].name &&
        e.keyword === DEFAULT_SEARCH_ENGINES[i].keyword &&
        e.urlTemplate === DEFAULT_SEARCH_ENGINES[i].urlTemplate
    )

  const openAdd = (): void => {
    setDraft({
      mode: 'add',
      name: '',
      keyword: '',
      urlTemplate: '',
      error: null
    })
  }

  const openEdit = (engine: SearchEngine): void => {
    setDraft({
      mode: 'edit',
      id: engine.id,
      name: engine.name,
      keyword: engine.keyword,
      urlTemplate: engine.urlTemplate,
      error: null
    })
  }

  const saveDraft = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!draft) return
    const name = sanitizeSearchEngineName(draft.name)
    if (!name) {
      setDraft({ ...draft, error: 'Enter a name for this search engine.' })
      return
    }
    const keyword = sanitizeSearchKeyword(draft.keyword)
    if (!keyword) {
      setDraft({ ...draft, error: 'Keyword must be 1–16 letters, numbers, hyphens, or underscores (e.g. w, yt, scholar).' })
      return
    }
    const urlTemplate = validateSearchUrlTemplate(draft.urlTemplate)
    if (!urlTemplate) {
      setDraft({ ...draft, error: 'URL must start with https:// and include %s where the search query goes.' })
      return
    }
    const clash = engines.find(
      (eng) => eng.keyword.toLowerCase() === keyword && (draft.mode === 'add' || eng.id !== draft.id)
    )
    if (clash) {
      setDraft({ ...draft, error: `Keyword “${keyword}” is already used by ${clash.name}.` })
      return
    }

    if (draft.mode === 'add') {
      const idBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'engine'
      let id = idBase
      let n = 2
      while (engines.some((eng) => eng.id === id)) {
        id = `${idBase}-${n++}`
      }
      onPatch({ searchEngines: [...engines, { id, name, keyword, urlTemplate }] })
    } else if (draft.id) {
      onPatch({
        searchEngines: engines.map((eng) =>
          eng.id === draft.id ? { ...eng, name, keyword, urlTemplate } : eng
        )
      })
    }
    setDraft(null)
  }

  const removeEngine = (id: string): void => {
    if (engines.length <= 1) return
    const next = engines.filter((e) => e.id !== id)
    const nextDefault = settings.searchEngine === id ? next[0].id : settings.searchEngine
    onPatch({ searchEngines: next, searchEngine: nextDefault })
    if (draft?.id === id) setDraft(null)
  }

  const resetDefaults = (): void => {
    setDraft(null)
    onPatch({ searchEngines: cloneDefaultSearchEngines(), searchEngine: 'google' })
  }

  return (
    <section className="set-section" id="set-search" aria-labelledby="set-search-h">
      <div className="set-section-head">
        <h2 id="set-search-h">Search</h2>
        <div className="set-section-tools">
          <button type="button" className="btn sm set-icon-btn" onClick={openAdd}>
            <Plus size={13} aria-hidden />
            <span>Add engine</span>
          </button>
          <button type="button" className="btn sm ghost set-icon-btn" disabled={isDefaultList} onClick={resetDefaults}>
            <RotateCcw size={12} aria-hidden />
            <span>Reset defaults</span>
          </button>
        </div>
      </div>

      <div className="set-card">
        <div className="set-row">
          <div className="set-row-info">
            <div className="set-label">Default search engine</div>
            <div className="set-desc">
              Used for regular searches. Type any keyword or bang in the address bar (for example{' '}
              <code>w cats</code> or <code>!w cats</code>) to search another engine directly.
            </div>
          </div>
          <select
            className="se-select"
            aria-label="Default search engine"
            value={settings.searchEngine}
            onChange={(e) => onPatch({ searchEngine: e.target.value })}
          >
            {engines.map((eng) => (
              <option key={eng.id} value={eng.id}>
                {eng.name}
              </option>
            ))}
          </select>
        </div>

        {draft && (
          <form className="set-row stack se-form" onSubmit={saveDraft}>
            <div className="se-form-title">{draft.mode === 'add' ? 'Add search engine' : 'Edit search engine'}</div>
            <div className="se-form-grid">
              <label className="se-field">
                <span>Name</span>
                <input
                  type="text"
                  autoFocus
                  maxLength={48}
                  placeholder="Google Scholar"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value, error: null })}
                />
              </label>
              <label className="se-field">
                <span>Keyword</span>
                <input
                  type="text"
                  maxLength={17}
                  placeholder="gs"
                  value={draft.keyword}
                  onChange={(e) => setDraft({ ...draft, keyword: e.target.value, error: null })}
                />
              </label>
              <label className="se-field se-field-url">
                <span>Search URL (https:// with %s)</span>
                <input
                  type="text"
                  maxLength={2048}
                  placeholder="https://scholar.google.com/scholar?q=%s"
                  value={draft.urlTemplate}
                  onChange={(e) => setDraft({ ...draft, urlTemplate: e.target.value, error: null })}
                />
              </label>
            </div>
            {draft.error && (
              <div className="set-note" role="alert">
                {draft.error}
              </div>
            )}
            <div className="se-form-actions">
              <button type="button" className="btn sm ghost" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn sm primary">
                {draft.mode === 'add' ? 'Add engine' : 'Save changes'}
              </button>
            </div>
          </form>
        )}

        {engines.map((eng) => {
          const isDefault = eng.id === settings.searchEngine
          return (
            <div key={eng.id} className="set-row se-row">
              <div className="set-row-info">
                <div className="se-name-line">
                  <span className="set-label">{eng.name}</span>
                  <kbd className="se-kw" title={`Type “${eng.keyword} …” or “!${eng.keyword} …” in the address bar`}>
                    !{eng.keyword}
                  </kbd>
                  {isDefault && (
                    <span className="se-default-pill">
                      <Check size={11} strokeWidth={2.5} aria-hidden />
                      Default
                    </span>
                  )}
                </div>
                <div className="se-url" title={eng.urlTemplate}>
                  {eng.urlTemplate}
                </div>
              </div>
              <div className="set-row-actions">
                {!isDefault && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => onPatch({ searchEngine: eng.id })}
                  >
                    Set default
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn small"
                  aria-label={`Edit ${eng.name}`}
                  title={`Edit ${eng.name}`}
                  onClick={() => openEdit(eng)}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn small"
                  aria-label={`Remove ${eng.name}`}
                  title={engines.length <= 1 ? 'Keep at least one search engine' : `Remove ${eng.name}`}
                  disabled={engines.length <= 1}
                  onClick={() => removeEngine(eng.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
