import { barFraction } from '../../stages/pieceProgress'
import './PieceBar.css'

/**
 * Pieces done against pieces planned, as a bar (UI/UX plan, phase 8A). Neutral ink on grey: it says how far, never how well (status
 * is the badge's job). Over the plan it stops at full; the numbers the caller writes beside it keep the real count. It is hidden from a
 * screen reader because those numbers carry the same information in words.
 */
export function PieceBar({ done, qty }: { done: number; qty: number }) {
  return <div className="piecebar" aria-hidden="true"><span style={{ width: `${Math.round(barFraction(done, qty) * 100)}%` }} /></div>
}
