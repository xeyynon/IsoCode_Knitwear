import { pieces } from '../../numberFormat'
import { barFraction, percentText } from '../../stages/pieceProgress'
import { ProgressRing } from '../atoms/ProgressRing'
import './UpdateHero.css'

/**
 * The top of the Update screen (UI/UX plan, phase 8A): which order, how far the stage is (a ring and the share in the middle), and the
 * two numbers the supervisor needs before typing, today so far and what is left, in big plain figures. The words come in as props.
 * It keeps the <h1> the page had (the order number), so the heading outline is the same.
 */
export function UpdateHero({ po, meta, done, qty, todaySoFar, left, labels }: {
  po: string; meta: string; done: number; qty: number; todaySoFar: number; left: number; labels: { todaySoFar: string; left: string }
}) {
  return (
    <section className="updatehero">
      <div className="updatehero__top">
        <ProgressRing fraction={barFraction(done, qty)} size={72} stroke={8}><b className="updatehero__pct mono">{percentText(done, qty)}</b></ProgressRing>
        <div className="updatehero__who">
          <h1 className="mono">{po}</h1>
          <p className="updatehero__meta">{meta}</p>
        </div>
      </div>
      <dl className="updatehero__nums">
        <div><dt>{labels.todaySoFar}</dt><dd className="mono">{pieces(todaySoFar)}</dd></div>
        <div><dt>{labels.left}</dt><dd className="mono">{pieces(left)}</dd></div>
      </dl>
    </section>
  )
}
