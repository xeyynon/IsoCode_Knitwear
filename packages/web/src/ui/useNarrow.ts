import { useEffect, useState } from 'react'

/** The same breakpoint the board uses to turn its table into cards (styles.css, max-width 720 px). */
export const NARROW_QUERY = '(max-width: 720px)'
const matches = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches

/** Whether the screen is narrow (a phone held upright), kept up to date when it is turned or resized. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(NARROW_QUERY)
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}
