import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './library.css'
import './settings.css'

const q = new URLSearchParams(location.search)
document.documentElement.dataset.material = q.get('material') === 'acrylic' ? 'acrylic' : 'solid'
document.documentElement.dataset.platform = q.get('platform') ?? 'win32'
if (__CHANNEL__ === 'dev') document.title = 'Veyra Orbit Dev'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
