import type { ReactNode } from 'react'
import { ringFraction } from '../../stages/pieceProgress'
import { ProgressRing } from '../atoms/ProgressRing'
import './TodayHero.css'

/**
 * The top of the supervisor's Today (UI/UX plan, phase 8A): a ring for how many stages have an update today, the sentence in words,
 * the date the counts go to, and the sync chip ("3 waiting" / "All sent") where the eye already is. The words come in as props
 * (already in the supervisor's language), so this knows no language. The ring is only decoration for the sentence beside it.
 */
export function TodayHero({ updated, total, headline, dateLine, children }: { updated: number; total: number; headline: string; dateLine?: string; children?: ReactNode }) {
  return (
    <section className="todayhero">
      <div className="todayhero__main">
        <ProgressRing fraction={ringFraction(updated, total)} size={96} stroke={11}>
          <b className="todayhero__n mono">{updated}</b>
          <span className="todayhero__of mono">/ {total}</span>
        </ProgressRing>
        <div className="todayhero__text">
          <p className="todayhero__headline">{headline}</p>
          {dateLine && <p className="todayhero__date">{dateLine}</p>}
        </div>
      </div>
      {children && <div className="todayhero__chip">{children}</div>}
    </section>
  )
}
