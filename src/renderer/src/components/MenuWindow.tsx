import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { isSelectable, reduceMenuKey, type MenuPopupSpec } from '@shared/menu'

/**
 * Floating acrylic menu window (src/main/floating.ts).
 * Runs in its own sandboxed BrowserWindow with a minimal preload (window.veyraMenu only)
 * so menus always render cleanly above native WebContentsViews with real backdrop blur.
 */
export function MenuWindow(): React.JSX.Element | null {
  const [spec, setSpec] = useState<MenuPopupSpec | null>(null)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  const menu = window.veyraMenu!

  useEffect(() => {
    document.documentElement.classList.add('menu-window')
    const off = menu.onRender((next) => {
      setSpec(next)
      const init = typeof next.initialActive === 'number' ? next.initialActive : -1
      setActive(init >= 0 && init < next.items.length && isSelectable(next.items[init]) ? init : -1)
    })
    menu.ready()
    return () => {
      off()
      document.documentElement.classList.remove('menu-window')
    }
  }, [menu])

  // Sync theme/accent and report exact CSS dimensions so main sizes & clamps the window.
  useLayoutEffect(() => {
    if (!spec || !boxRef.current) return
    const root = document.documentElement
    root.classList.toggle('dark', spec.dark)
    if (spec.accent) root.style.setProperty('--menu-accent', spec.accent)
    const r = boxRef.current.getBoundingClientRect()
    menu.size(Math.ceil(r.width), Math.ceil(r.height))
  }, [spec, menu])

  useEffect(() => {
    if (!spec) return
    const isCollapsedRoot = !spec.header && spec.items.length > 0 && spec.items.every((it) => it.kind === 'item' && it.hasSubmenu)
    const onKeyDown = (e: KeyboardEvent): void => {
      const res = reduceMenuKey(
        {
          items: spec.items,
          activeIndex: active,
          inSubmenu: !!spec.header,
          isCollapsedRoot
        },
        e.key
      )
      if (!res.handled) return
      e.preventDefault()
      if (res.activeIndex !== active) setActive(res.activeIndex)
      if (res.effect.type === 'pick') menu.pick(res.effect.id)
      else if (res.effect.type === 'step-menu') menu.step(res.effect.delta)
      else if (res.effect.type === 'leave-submenu' && spec.header) menu.pick(spec.header.backId)
      else if (res.effect.type === 'dismiss') menu.dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [spec, active, menu])

  if (!spec) return null

  return (
    <div ref={boxRef} className="menu-win" role="menu" aria-label={spec.header?.label ?? 'Menu'} onMouseLeave={() => setActive(-1)}>
      {spec.header && (
        <>
          <button
            type="button"
            className="wb-menu-back"
            onClick={() => menu.pick(spec.header!.backId)}
          >
            <ChevronLeft size={14} strokeWidth={2.2} aria-hidden />
            <span>{spec.header.label}</span>
          </button>
          <div className="wb-menu-sep" role="separator" />
        </>
      )}
      {spec.items.map((entry, idx) =>
        entry.kind === 'separator' ? (
          <div key={`sep-${idx}`} className="wb-menu-sep" role="separator" />
        ) : (
          <button
            key={entry.id}
            type="button"
            role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={entry.checked}
            aria-disabled={entry.disabled || undefined}
            disabled={entry.disabled}
            className={`wb-menu-item ${idx === active ? 'active' : ''} ${entry.disabled ? 'disabled' : ''}`}
            onMouseEnter={() => {
              if (!entry.disabled) setActive(idx)
            }}
            onClick={() => {
              if (!entry.disabled) menu.pick(entry.id)
            }}
          >
            <span className="wb-check" aria-hidden>
              {entry.checked && <Check size={13} strokeWidth={2.6} />}
            </span>
            <span className="wb-menu-label">{entry.label}</span>
            {entry.keys && <span className="wb-keys">{entry.keys}</span>}
            {entry.hasSubmenu && <ChevronRight size={13} className="wb-sub-arrow" aria-hidden />}
          </button>
        )
      )}
    </div>
  )
}
