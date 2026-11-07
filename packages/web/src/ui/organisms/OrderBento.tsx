import type { ReactNode } from 'react'
import './OrderBento.css'

type Parts = {
  /** The order at a glance: the card with the PO, the status and the key-fact tiles. */
  head: ReactNode
  /** The timeline of the stages. */
  timeline: ReactNode
  /** The stage cards. */
  stages: ReactNode
  /** The things a merchandiser can do: add an update, change the date. */
  actions: ReactNode
  /** What happened: the history of date changes and the notes from the floor. */
  log: ReactNode
}

/**
 * The order page as a bento (UI/UX 2.0 phase 8B): rounded cells of different sizes in one grid. On a wide screen the timeline and the stage
 * cards sit side by side under the order card, then the two actions, then the history and the notes; on a phone it is one column in the
 * same order, exactly the page it was. The DOM order is the reading order in both, so a screen reader and the Tab key meet the cells in the
 * order the eye does. An area with nothing in it (null) is left out. It lays out; it fetches and decides nothing.
 */
export function OrderBento({ head, timeline, stages, actions, log }: Parts) {
  const areas: [keyof Parts, ReactNode][] = [['head', head], ['timeline', timeline], ['stages', stages], ['actions', actions], ['log', log]]
  return (
    <div className="bento">
      {areas.map(([area, node]) => (node ? <div key={area} data-area={area} className={`bento__${area}`}>{node}</div> : null))}
    </div>
  )
}

/** One rounded cell. A plain block on a phone; a card on a wide screen. */
export function BentoCell({ children }: { children: ReactNode }) {
  return <section className="bento__cell">{children}</section>
}
