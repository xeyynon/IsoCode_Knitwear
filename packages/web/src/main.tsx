import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

// After a deploy a stale tab can fail to preload a chunk: reload once, never in a loop.
import { shouldReload } from './ui/chunkReload'
window.addEventListener('vite:preloadError', () => {
  try {
    const last = Number(window.sessionStorage.getItem('orders.chunkReloadAt')) || null
    if (shouldReload(last, Date.now())) {
      window.sessionStorage.setItem('orders.chunkReloadAt', String(Date.now()))
      window.location.reload()
    }
  } catch { /* leave the error boundary to show its card */ }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
