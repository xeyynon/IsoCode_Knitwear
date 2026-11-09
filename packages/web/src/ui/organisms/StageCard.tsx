import { pieces } from '../../numberFormat'
import { percentText } from '../../stages/pieceProgress'
import { ButtonLink } from '../atoms/Button'
import { CheckMark } from '../atoms/CheckMark'
import { PieceBar } from '../atoms/PieceBar'
import './StageCard.css'

export interface StageCardLabels {
  done: string; due: string; update: string
  addedToday: (n: string) => string; nothingToday: string; toGo: (n: string) => string; complete: string
}

/**
 * One stage on the supervisor's Today list (UI/UX plan, phase 8A; the "finished" area reworked after the form review): the order and stage
 * large, what is DONE as the biggest figure with the share and a bar, then one line for what today added and what is still to go, and one
 * full-width Update button. It gets its words as props (no fetching, no language of its own); `li.stage` and `a.stage__go` stay as the hooks
 * the end-to-end checks and the focus code look for.
 * States: nothing sent today (neutral words, no check), sent today (a check in the action colour and the amount), stage complete (says so),
 * over the plan (the bar stops at full, the numbers say the truth), no plan (no share, no "to go").
 */
export function StageCard({ po, meta, stageName, done, qty, today, dueText, href, labels }: {
  po: string; meta: string; stageName: string; done: number; qty: number; today: number; dueText: string; href: string; labels: StageCardLabels
}) {
  const share = percentText(done, qty)
  const complete = qty > 0 && done >= qty
  const added = today > 0
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
          {qty > 0 && <span className="stagetile__of">/ {pieces(qty)}</span>}
          {share && <span className="stagetile__pct">{share}</span>}
        </div>
        <PieceBar done={done} qty={qty} />
      </div>
      <div className="stagetile__foot">
        <p className={`stagetile__today${added ? ' stagetile__today--done' : ''}`}>
          {added && <CheckMark />}
          {added ? labels.addedToday(pieces(today)) : labels.nothingToday}
        </p>
        {qty > 0 && <p className="stagetile__togo">{complete ? labels.complete : labels.toGo(pieces(Math.max(0, qty - done)))}</p>}
      </div>
      <ButtonLink variant="primary" block className="stage__go" to={href}>{labels.update}</ButtonLink>
    </li>
  )
}
