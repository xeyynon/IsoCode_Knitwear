import { Link } from 'react-router-dom'
import type { LoadFailure } from '../../api/sessionRules'
import type { Checklist, ChecklistItem, ItemState, SetupTab } from '../../setup/setupChecklist'
import { LoadFailed } from '../LoadFailed'
import { useNarrow } from '../useNarrow'
import './SetupChecklist.css'

const WORD: Record<ItemState, string> = { done: 'Done', todo: 'To do', unknown: 'Not checked' }

/** A mark and a word, never colour alone: a filled check, an empty ring, a dashed ring. Neutral and theme colours only (not order status). */
function Mark({ state }: { state: ItemState }) {
  const common = { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const
  if (state === 'done') return <svg {...common}><circle cx="10" cy="10" r="8" fill="currentColor" stroke="none" /><path d="m6.2 10.3 2.6 2.6 5-5.4" style={{ stroke: 'var(--on-accent)' }} /></svg>
  if (state === 'unknown') return <svg {...common} strokeDasharray="3 2.6"><circle cx="10" cy="10" r="8" /></svg>
  return <svg {...common}><circle cx="10" cy="10" r="8" /></svg>
}

const href = (tab: SetupTab) => `/setup?tab=${tab}`

function Row({ item, onGo }: { item: ChecklistItem; onGo: (tab: SetupTab, anchor?: string) => void }) {
  return (
    <li className={`setupcheck__item setupcheck__item--${item.state}`}>
      <span className="setupcheck__mark"><Mark state={item.state} /></span>
      <div className="setupcheck__text">
        <p className="setupcheck__label"><b>{item.label}</b> <span className="setupcheck__state">{WORD[item.state]}</span></p>
        <p className="setupcheck__detail">{item.detail}</p>
      </div>
      <Link className="btn btn--small setupcheck__go" to={href(item.tab)} aria-label={item.state === 'todo' ? undefined : `Open ${item.label}`}
        onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; onGo(item.tab, item.state === 'todo' ? item.anchor : undefined) }}>{item.state === 'todo' ? item.action : 'Open'}</Link>
    </li>
  )
}

/**
 * The pilot setup checklist (UI/UX plan, slice 5.1). States: loading; failed to load (the one shared card, with Retry); nothing set up;
 * partly (the list is open, with what is left in a line); all done (one line, the list folded away). It only shows what the data says:
 * an item that could not be read says "Not checked", it is never guessed. Receives its data as props.
 */
export function SetupChecklist({ result, failure, onRetry, onGo }: { result: Checklist | null; failure: LoadFailure | null; onRetry: () => void; onGo: (tab: SetupTab, anchor?: string) => void }) {
  const narrow = useNarrow()
  if (result === null) return <section className="setupcheck" aria-label="Pilot setup"><p className="sub">Checking what is set up…</p></section>
  if (result.overall === 'failed') return <section className="setupcheck" aria-label="Pilot setup"><LoadFailed unreachable={failure?.unreachable ?? false} message={failure?.message ?? result.line} onRetry={onRetry} /></section>
  const done = result.overall === 'done'
  return (
    <section className={`setupcheck setupcheck--${result.overall}`} aria-labelledby="setupcheck-title">
      <h2 id="setupcheck-title" className="setupcheck__title">Pilot setup</h2>
      <p className="setupcheck__line" role="status">{result.line}</p>
      <details className="setupcheck__details" open={!done && !narrow}>
        <summary>{done ? 'See what is set up' : narrow ? 'Show the steps' : 'The steps'}</summary>
        <ul className="plain setupcheck__list">{result.items.map((i) => <Row key={i.id} item={i} onGo={onGo} />)}</ul>
      </details>
    </section>
  )
}
