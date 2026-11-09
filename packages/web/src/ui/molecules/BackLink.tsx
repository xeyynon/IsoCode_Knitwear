import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './BackLink.css'

/**
 * The way back to the place a page came from: one component for every page (the order page, New order, the status page, Update), so it
 * looks and behaves the same everywhere: a bordered box with an arrow, the same shape as the menu button, and the destination's name beside it.
 * A real link (middle-click, the browser's Back and the keyboard all work).
 *
 * States: wide enough = box and name; `compact` = on a narrow screen only the box shows, and the name stays for a screen reader (Update, where the
 * sync chip needs the room).
 */
export function BackLink({ to, children, compact = false }: { to: string; children: ReactNode; compact?: boolean }) {
  return (
    <Link className={`backlink${compact ? ' backlink--compact' : ''}`} to={to}>
      <span className="backlink__box" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
          <path d="M16 10H4M9.5 4.5 4 10l5.5 5.5" />
        </svg>
      </span>
      <span className="backlink__text">{children}</span>
    </Link>
  )
}
