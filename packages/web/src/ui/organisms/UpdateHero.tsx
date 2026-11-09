import { pieces } from '../../numberFormat'
import { barFraction, percentText } from '../../stages/pieceProgress'
import { CheckMark } from '../atoms/CheckMark'
import { ProgressRing } from '../atoms/ProgressRing'
import './UpdateHero.css'

/** The words the hero shows. The page passes them in (the hero has no language of its own); `n` and `pct` are already written the one way (pieces()). */
export interface UpdateHeroLabels {
  done: string
  addedToday: (n: string) => string
  nothingToday: string
  toGo: (n: string) => string
  complete: string
  share: (pct: string) => string
}

/**
 * The top of the Update screen (UI/UX plan, phase 8A; the "finished" area reworked after the form review): which order, how far the stage
 * is (a ring and the share in the middle), then what has been DONE as the largest figure, what today added as one quiet line, and what is
 * still to go as the secondary line. The work already made leads; the gap no longer does.
 *
 * States: nothing sent today (a plain neutral sentence, no check), sent today (a check in the action colour and the amount), stage complete
 * (says so instead of "to go"), over the plan (the true number, only the ring stops at full), no plan (no share, no "to go": nothing invented).
 * Kept short so the number field stays high on the screen when the keyboard is open. It keeps the <h1> the page had (the order number).
 */
export function UpdateHero({ po, meta, done, qty, todaySoFar, left, labels }: {
  po: string; meta: string; done: number; qty: number; todaySoFar: number; left: number; labels: UpdateHeroLabels
}) {
  const share = percentText(done, qty)
  const complete = qty > 0 && done >= qty
  const added = todaySoFar > 0
  return (
    <section className="updatehero">
      <div className="updatehero__top">
        <ProgressRing fraction={barFraction(done, qty)} size={64} stroke={7}><b className="updatehero__pct mono">{share}</b></ProgressRing>
        <div className="updatehero__who">
          <h1 className="mono">{po}</h1>
          <p className="updatehero__meta">{meta}</p>
        </div>
      </div>
      <div className="updatehero__nums">
        <dl className="updatehero__made">
          <dt>{labels.done}</dt>
          <dd className="mono">
            <b>{pieces(done)}</b>
            {qty > 0 && <span className="updatehero__of">/ {pieces(qty)}</span>}
            {share && <span className="visually-hidden"> ({labels.share(share)})</span>}
          </dd>
        </dl>
        <div className="updatehero__side">
          <p className={`updatehero__today${added ? ' updatehero__today--added' : ''}`}>
            {added && <CheckMark size={16} />}
            {added ? labels.addedToday(pieces(todaySoFar)) : labels.nothingToday}
          </p>
          {qty > 0 && <p className="updatehero__togo">{complete ? labels.complete : labels.toGo(pieces(left))}</p>}
        </div>
      </div>
    </section>
  )
}
