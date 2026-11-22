import type { ResolvedAppearance } from '@shared/types'

const CUSTOM_CSS_STYLE_ID = 'orbit-custom-css'

function applyCustomCssStyle(css: string): void {
  if (typeof document === 'undefined' || !document.head) return
  let el = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null
  if (!css) {
    if (el) el.remove()
    return
  }
  if (!el) {
    el = document.createElement('style')
    el.id = CUSTOM_CSS_STYLE_ID
    document.head.appendChild(el)
  }
  if (el.textContent !== css) {
    el.textContent = css
  }
}

/**
 * Applies resolved appearance tokens live onto document.documentElement without reloading.
 * Used by the main browser window AND every floating renderer (menus, palette, peek, compact panels).
 */
export function applyResolvedAppearance(tokens: ResolvedAppearance): void {
  const root = document.documentElement
  root.classList.toggle('dark', tokens.isDark)
  root.style.colorScheme = tokens.isDark ? 'dark' : 'light'

  for (const [prop, val] of Object.entries(tokens.vars)) {
    root.style.setProperty(prop, val)
  }

  const prefersReduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const effectiveMotion =
    tokens.effectiveMotion === 'off'
      ? 'off'
      : tokens.effectiveMotion === 'reduced' || prefersReduced
        ? 'reduced'
        : 'full'

  for (const [key, val] of Object.entries(tokens.attrs)) {
    root.dataset[key] = key === 'motion' ? effectiveMotion : val
  }

  if (effectiveMotion === 'off') {
    root.style.setProperty('--t-fast', '0ms')
    root.style.setProperty('--t-base', '0ms')
    root.style.setProperty('--t-pop', '0ms')
    root.style.setProperty('--spring-snappy-ms', '0ms')
    root.style.setProperty('--spring-bouncy-ms', '0ms')
  } else if (effectiveMotion === 'reduced') {
    root.style.setProperty('--t-fast', '80ms')
    root.style.setProperty('--t-base', '100ms')
    root.style.setProperty('--t-pop', '100ms')
    root.style.setProperty('--spring-snappy-ms', '100ms')
    root.style.setProperty('--spring-bouncy-ms', '100ms')
  }

  applyCustomCssStyle(tokens.safeMode ? '' : tokens.customCss || '')
}
