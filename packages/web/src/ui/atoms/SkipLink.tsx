import type { ReactNode } from 'react'
import './SkipLink.css'

/**
 * "Skip to main content" (AUDIT-03, finding 17): the first thing in every page, hidden until it has the keyboard, so a person who tabs does not
 * walk through the app bar and the board's controls first. It moves the focus to <main id="main" tabIndex={-1}> (a bare #main link only scrolls).
 * States: hidden (off to the side, still in the tab order), focused (drawn at the top left, on top, with the focus ring). Words come in as children.
 */
export function SkipLink({ children, target = 'main' }: { children: ReactNode; target?: string }) {
  return (
    <a className="skiplink" href={`#${target}`} onClick={(e) => { const el = document.getElementById(target); if (el) { e.preventDefault(); el.focus(); el.scrollIntoView?.({ block: 'start' }) } }}>
      {children}
    </a>
  )
}
