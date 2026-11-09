import { Link, useLocation } from 'react-router-dom'
import { NAV, activeNav, badgeText, type NavKey } from '../navRules'
import './NavTabs.css'

/** One 16 x 16 stroke icon per view, from a single path string each (no icon font, nothing to download). */
const ICON: Record<NavKey, string> = {
  board: 'M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z', // four squares: the board of orders
  review: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM5.3 8.3l1.9 1.9 3.5-3.8', // a check in a ring: decide what the buyer sees
  setup: 'M2 4h5M10.5 4H14M2 8h2M7.5 8H14M2 12h6.5M12 12h2M8.8 4a1.3 1.3 0 1 0 0 .01zM5.8 8a1.3 1.3 0 1 0 0 .01zM10.3 12a1.3 1.3 0 1 0 0 .01z', // three sliders
}

/**
 * The merchandiser's Board, Review and Setup: the centre tab of the top bar (the ORCA guide, adapted; UI/UX plan slice 3.3). Real links, so the
 * keyboard, a middle-click and the browser's Back all work. Each is an icon and a label; the current place carries aria-current, a heavier
 * label and a 2 px underline as well as the accent colour; each tooltip names the shortcut that goes there. The Review tab shows how many wait,
 * as a number to the eye and in words for a screen reader.
 */
export function NavTabs({ reviewCount }: { reviewCount: number | null }) {
  const current = activeNav(useLocation().pathname)
  return (
    <nav className="appbar__center navtabs" aria-label="Main">
      {NAV.map((tab) => {
        const badge = tab.key === 'review' ? badgeText(reviewCount) : null
        return (
          <Link key={tab.key} to={tab.to} className="navtab" aria-current={current === tab.key ? 'page' : undefined} title={`${tab.label} (${tab.keys})`}>
            <svg className="navtab__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d={ICON[tab.key]} />
            </svg>
            <span className="navtab__label">{tab.label}</span>
            {badge && (
              <>
                <span className="count" aria-hidden="true">{badge}</span>
                <span className="visually-hidden"> {reviewCount} waiting</span>
              </>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
