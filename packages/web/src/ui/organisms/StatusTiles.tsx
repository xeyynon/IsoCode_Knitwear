import type { Status } from '../../board/boardLogic'
import { StatusIcon } from '../StatusBadge'
import './StatusTiles.css'

export interface Tile {
  key: 'all' | Status
  /** The status word (or "All"), already in the reader's language. */
  label: string
  count: number
  /** A real figure to go with the count, such as "700 pcs short". Absent = no line is drawn: nothing is invented. */
  note?: string
  pressed: boolean
  onPress: () => void
}

/**
 * The board's status filter as a row of large tiles (UI/UX 2.0 phase 8B), for wide screens; a phone keeps the compact chips.
 * Each tile is a button that is on or off (aria-pressed), carries the status icon, the word and the colour together (the All tile has
 * none), and shows the count, so a tile says the same as the chip it replaces and clicking it shows exactly that many orders.
 * States: pressed (a heavy ink ring, not only colour), not pressed, hover, keyboard focus (the browser ring).
 */
export function StatusTiles({ tiles, label }: { tiles: Tile[]; label: string }) {
  return (
    <div className="statustiles" role="group" aria-label={label}>
      {tiles.map((t) => (
        <button key={t.key} type="button" className={`statustile statustile--${t.key}`} aria-pressed={t.pressed} onClick={t.onPress}>
          <span className="statustile__head">
            {t.key !== 'all' && <StatusIcon status={t.key} />}
            <span>{t.label}</span>
          </span>
          <span className="statustile__count">{t.count}</span>
          {t.note && <span className="statustile__note">{t.note}</span>}
        </button>
      ))}
    </div>
  )
}
