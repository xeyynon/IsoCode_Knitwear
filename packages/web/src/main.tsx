import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { getClaims } from './api/session'
import { applySignInLanguage } from './i18n'
import { startTheme } from './ui/theme'
import './fonts'
import './styles.css'

// After a deploy a stale tab can fail to preload a chunk: reload once, never in a loop.
import { shouldReload } from './ui/chunkReload'
import { watchForUpdate } from './ui/swUpdateStore'
window.addEventListener('vite:preloadError', () => {
  try {
    const last = Number(window.sessionStorage.getItem('orders.chunkReloadAt')) || null
    if (shouldReload(last, Date.now())) {
      window.sessionStorage.setItem('orders.chunkReloadAt', String(Date.now()))
      window.location.reload()
    }
  } catch { /* leave the error boundary to show its card */ }
})

// Keep the app itself available with no signal. Production builds only: in development a
// service worker would serve stale code. A new version waits until the person presses Reload
// on the banner (UpdateBanner); it is never swapped in by itself.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', watchForUpdate)
}

// A supervisor already signed in on this phone (before language defaults existed, or after a reload) gets the same default.
applySignInLanguage(getClaims()?.role)

// The saved theme (light unless the person chose dark): theme-init.js applied it before the first paint; this keeps the page and the menu in step.
startTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
