import { Link } from 'react-router-dom'
import { pieces } from '../../numberFormat'
import { percentText } from '../../stages/pieceProgress'
import { PieceBar } from '../atoms/PieceBar'
import './StageCard.css'

export interface StageCardLabels { today: string; done: string; due: string; update: string }

/**
 * One stage on the supervisor's Today list (UI/UX plan, phase 8A): the order and stage large, how far it is in real pieces with a bar,
 * today's count with a tick once something was entered, and one full-width Update button. It gets its words as props (no fetching, no
 * language of its own); `li.stage` and `a.stage__go` stay as the hooks the end-to-end checks and the focus code look for.
 * States: nothing entered today (a plain 0), entered today (a tick), over the plan (the bar stops at full, the numbers say the truth).
 */
export function StageCard({ po, meta, stageName, done, qty, today, dueText, href, labels }: {
  po: string; meta: string; stageName: string; done: number; qty: number; today: number; dueText: string; href: string; labels: StageCardLabels
}) {
  const share = percentText(done, qty)
  return (
    <li className="stage stagetile">
      <div className="stagetile__top">
        <span className="stagetile__stage">{stageName}</span>
        <span className="stagetile__due">{labels.due} <b>{dueText}</b></span>
      </div>
      <b className="mono stagetile__po">{po}</b>
      <span className="stagetile__meta">{meta}</span>
      <div className="stagetile__prog">
        <div className="stagetile__nums mono">
          <span className="stagetile__label">{labels.done}</span>
          <b className="stagetile__big">{pieces(done)}</b>
          <span className="stagetile__of">/ {pieces(qty)}</span>
          {share && <span className="stagetile__pct">{share}</span>}
        </div>
        <PieceBar done={done} qty={qty} />
      </div>
      <p className={`stagetile__today mono${today > 0 ? ' stagetile__today--done' : ''}`}>
        {today > 0 && (
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="9" r="7.5" /><path d="m5.6 9.2 2.4 2.4 4.4-4.8" />
          </svg>
        )}
        {labels.today} <b>{pieces(today)}</b>
      </p>
      <Link className="btn btn--primary btn--block stage__go" to={href}>{labels.update}</Link>
    </li>
  )
}
