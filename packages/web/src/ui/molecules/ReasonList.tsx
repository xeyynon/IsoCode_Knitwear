import { reasonById, type Reason } from '../../notes/reasons'
import './ReasonList.css'

/**
 * The reasons a supervisor tapped for a note, in the order they tapped them (the form review). The first is the main reason and says so in WORDS, so the order
 * and the main one never rely on colour. Plain, neutral chips that are not buttons: the control that changes the main reason is the field beside it.
 *
 * States: none = nothing is drawn; one = one chip marked as the main reason; several = a chip each, the first marked.
 */
export function ReasonList({ ids, reasons }: { ids: string[]; reasons: Reason[] }) {
  if (ids.length === 0) return null
  return (
    <ul className="reasonlist" aria-label="Reasons for this note">
      {ids.map((id, i) => (
        <li key={id} className="reasonlist__item">
          {i === 0 && <span className="reasonlist__main">Main reason</span>}
          <span className="reasonlist__name">{reasonById(reasons, id)?.en ?? id}</span>
        </li>
      ))}
    </ul>
  )
}
