import { useState } from 'react'
import { activityTime, visibleEntries, type AuditEntry } from '../../setup/activityLogic'
import { Button } from '../atoms/Button'
import { LoadFailed } from '../LoadFailed'
import './AccountActivity.css'

/**
 * Who stopped, allowed, reset or added an account, and when (UI/UX plan, slice 5.3). States: loading (entries null); could not load
 * (the one shared failure card, with Retry); nothing yet; a list, the latest ten with the rest behind a button. The sentence is the
 * server's own plain English. Receives its data as props.
 */
export function AccountActivity({ entries, failed, unreachable = false, onRetry }: { entries: AuditEntry[] | null; failed: boolean; unreachable?: boolean; onRetry: () => void }) {
  const [all, setAll] = useState(false)
  if (failed) return <LoadFailed unreachable={unreachable} message="Could not load the activity." onRetry={onRetry} />
  if (entries === null) return <p className="sub">Loading…</p>
  if (entries.length === 0) return <p className="sub">Nothing has been changed yet. Adding, stopping or resetting an account will be listed here.</p>
  const shown = visibleEntries(entries, all)
  return (
    <>
      <ol className="plain activity">
        {shown.map((e) => (
          <li key={e.id} className="activity__item">
            <span className="activity__sentence">{e.sentence}</span>
            <time className="activity__time mono" dateTime={e.at}>{activityTime(e.at)}</time>
          </li>
        ))}
      </ol>
      {entries.length > shown.length && <Button type="button" size="small" onClick={() => setAll(true)}>Show all {entries.length}</Button>}
    </>
  )
}
