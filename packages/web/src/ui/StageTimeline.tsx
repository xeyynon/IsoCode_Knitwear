import type { CSSProperties } from 'react'
import { shortDate } from '../board/boardLogic'
import { timelineRows } from '../orders/orderDetailLogic'
import { buildTimeline, closedLabel, type CalendarUnit, type LayoutStage, type Marker } from '../orders/timelineLayout'
import { StatusBadge } from './StatusBadge'

interface Props {
  stages: (LayoutStage & { unitName: string })[]
  exFactory: string
  calendar: { from: string; to: string; units: CalendarUnit[] }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const at = (m: Pick<Marker, 'pct'>): CSSProperties => ({ ['--x' as string]: `${m.pct}%` })

/**
 * The order's stages along one date axis: planned finish above each bar, projected finish below,
 * the unit's closed days hatched behind it, ex-factory as a labelled line. Wide screens draw the chart
 * (it scrolls inside its own box when the period is long); a phone gets the plain vertical list instead,
 * so the page itself never scrolls sideways. The status is the badge's icon and word; nothing here is
 * coloured to say it, so the chart reads the same in greyscale.
 */
export function StageTimeline({ stages, exFactory, calendar }: Props) {
  const t = buildTimeline({ stages, exFactory, from: calendar.from, to: calendar.to, units: calendar.units })
  if (!t.rows.length) return <p className="sub">This order has no stages.</p>

  const closedSummary = (
    <>
      <p className="sub tlc__closed-head">Closed days in this period</p>
      <ul className="plain tlc__closed">
        {t.closedSummary.map((c) => <li key={c.unitName} className="sub"><b>{c.unitName || 'Unit'}:</b> {c.text}</li>)}
      </ul>
    </>
  )

  return (
    <>
      <div className="tlc">
        <div className="tlc__scroll" role="region" aria-label="Stage timeline, scrolls sideways when the period is long" tabIndex={0}>
          <div className="tlc__grid" style={{ ['--days' as string]: t.days }}>
            <div className="tlc__row tlc__row--axis" aria-hidden="true">
              <div className="tlc__label" />
              <div className="tlc__track">
                {t.ticks.map((k) => <span key={k.date} className={`tlc__tick tlc__mark--${k.anchor}`} style={at(k)}>{k.label}</span>)}
                <span className={`tlc__exlabel tlc__mark--${t.exFactory.anchor}`} style={at(t.exFactory)}>{t.exFactory.label}</span>
                <span className="tlc__exline" style={at(t.exFactory)} />
              </div>
            </div>
            <ol className="plain tlc__rows" aria-label="Stages in order, each with its planned and projected finish">
              {t.rows.map((r) => (
                <li key={r.stage} className="tlc__row">
                  <div className="tlc__label">
                    <b>{cap(r.stage)}</b>
                    <StatusBadge status={r.status} />
                    <span className="sub">{r.unitName}</span>
                  </div>
                  <div className="tlc__track" aria-hidden="true">
                    {r.closed.map((c) => (
                      <span key={c.from + c.reason} className={`tlc__closed-day${c.named ? ' tlc__closed-day--named' : ''}`} title={`${closedLabel(c.reason)}, ${shortDate(c.from)}${c.to !== c.from ? ` to ${shortDate(c.to)}` : ''}`}
                        style={{ left: `${c.leftPct}%`, width: `${c.widthPct}%` }} />
                    ))}
                    {t.ticks.map((k) => <span key={k.date} className="tlc__week" style={at(k)} />)}
                    <span className="tlc__exline" style={at(t.exFactory)} />
                    <span className={`tlc__bar${r.done ? ' tlc__bar--done' : ''}`} style={{ left: `${r.bar.leftPct}%`, width: `${r.bar.widthPct}%` }} />
                    <span className="tlc__pin tlc__pin--plan" style={at(r.planned)} />
                    <span className={`tlc__text tlc__text--up tlc__mark--${r.planned.anchor} mono`} style={at(r.planned)}>{r.planned.label}</span>
                    {r.slip && <span className="tlc__slip" style={{ left: `${r.slip.leftPct}%`, width: `${r.slip.widthPct}%` }} />}
                    {r.lower.hasMark && <span className="tlc__pin tlc__pin--proj" style={at(r.lower)} />}
                    <span className={`tlc__text tlc__text--down tlc__mark--${r.lower.anchor} mono${r.pastExFactory ? ' tlc__text--over' : ''}`} style={at(r.lower)}>{r.lower.label}</span>
                  </div>
                  <span className="visually-hidden">{r.spoken}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <ul className="plain tlc__legend">
          {t.legend.map((l) => (
            <li key={l.reason}><span className={`tlc__swatch tlc__swatch--closed${l.named ? ' tlc__swatch--named' : ''}`} aria-hidden="true" />{l.label}</li>
          ))}
          {!t.legend.length && <li><span className="tlc__swatch tlc__swatch--closed" aria-hidden="true" />No closed days in this period</li>}
          <li><span className="tlc__swatch tlc__swatch--bar" aria-hidden="true" />A stage's planned working days</li>
          <li><span className="tlc__swatch tlc__swatch--plan" aria-hidden="true" />Planned finish, above</li>
          <li><span className="tlc__swatch tlc__swatch--proj" aria-hidden="true" />Projected finish, below</li>
          <li><span className="tlc__swatch tlc__swatch--ex" aria-hidden="true" />Ex-factory</li>
        </ul>
      </div>

      {/* A phone gets the list: the same dates, one stage to a card, no sideways scrolling. */}
      <ol className="timeline plain" aria-label="Stage timeline">
        {timelineRows(stages).map((r) => (
          <li key={r.stage} className={`timeline__item timeline__item--${r.status}`}>
            <div className="stagecard__top"><b>{cap(r.stage)}</b><StatusBadge status={r.status} /></div>
            <dl className="dates">
              <div><dt>Plan</dt><dd className="mono">{shortDate(r.planned)}</dd></div>
              <div><dt>Projected</dt><dd className="mono">{r.done ? 'Done' : r.projected ? shortDate(r.projected) : '-'}</dd></div>
              {!r.done && <div><dt>Against plan</dt><dd>{r.text}</dd></div>}
            </dl>
          </li>
        ))}
      </ol>
      {closedSummary}
    </>
  )
}
