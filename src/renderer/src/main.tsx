import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const q = new URLSearchParams(location.search)
document.documentElement.dataset.material = q.get('material') === 'acrylic' ? 'acrylic' : 'solid'
document.documentElement.dataset.platform = q.get('platform') ?? 'win32'

const view = q.get('view')
if (view === 'menu') {
  void import('./components/MenuWindow').then(({ MenuWindow }) => {
    createRoot(document.getElementById('root')!).render(<MenuWindow />)
  })
} else if (view === 'compact-sidebar') {
  void import('./components/CompactPanels').then(({ CompactSidebarWindow }) => {
    createRoot(document.getElementById('root')!).render(<CompactSidebarWindow />)
  })
} else if (view === 'compact-titlebar') {
  void import('./components/CompactPanels').then(({ CompactTitlebarWindow }) => {
    createRoot(document.getElementById('root')!).render(<CompactTitlebarWindow />)
  })
} else {
  if (__CHANNEL__ === 'dev') document.title = 'Veyra Orbit Dev'
  void import('./App').then(({ App }) => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  })
}
