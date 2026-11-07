import { Link, useLocation } from 'react-router-dom'
import { NAV, activeNav, badgeText } from '../navRules'
import './NavTabs.css'

/**
 * The merchandiser's Board, Review and Setup, as tabs in the app bar (UI/UX plan, slice 3.3). Real links, so the keyboard, a
 * middle-click and the browser's Back all work; the current place carries aria-current and is marked by weight and an
 * underline as well as colour; each tooltip names the shortcut that goes there. The Review tab shows how many wait.
 */
export function NavTabs({ reviewCount }: { reviewCount: number | null }) {
  const current = activeNav(useLocation().pathname)
  return (
    <nav className="navtabs" aria-label="Main">
      {NAV.map((tab) => {
        const badge = tab.key === 'review' ? badgeText(reviewCount) : null
        return (
          <Link key={tab.key} to={tab.to} className="navtab" aria-current={current === tab.key ? 'page' : undefined} title={`${tab.label} (${tab.keys})`}>
            {tab.label}
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
