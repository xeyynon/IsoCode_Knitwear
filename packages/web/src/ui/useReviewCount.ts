import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { apiFetch } from '../api/session'
import { reviewCountFrom } from './navRules'

const CHANGED = 'orders:review-changed'
const POLL_MS = 60_000

/** The Review page calls this after it has loaded or acted, so the number in the app bar follows at once instead of at the next poll. */
export const notifyReviewChanged = (): void => { window.dispatchEvent(new Event(CHANGED)) }

/**
 * How many warnings wait for a merchandiser's decision, for the badge on the Review tab. Asked when a screen opens, when the
 * route changes, when the window comes back to the front, once a minute while visible, and when the Review page says it changed.
 * A failed answer leaves the last number alone and never disturbs the screen (the badge is a convenience, not the Review page).
 */
export function useReviewCount(enabled: boolean): number | null {
  const { pathname } = useLocation()
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    const ctl = new AbortController()
    const load = () => {
      apiFetch<unknown>('/api/review', { signal: ctl.signal })
        .then((p) => { const n = reviewCountFrom(p); if (live && n !== null) setCount(n) })
        .catch(() => undefined)
    }
    load()
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    window.addEventListener('focus', load)
    window.addEventListener(CHANGED, load)
    return () => { live = false; ctl.abort(); window.clearInterval(id); window.removeEventListener('focus', load); window.removeEventListener(CHANGED, load) }
  }, [enabled, pathname])
  return count
}
