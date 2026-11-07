import { dateInWords } from '../../dateWords'
import './DateWords.css'

/**
 * The date in a field, read back in words under it. States: empty or not a real day = nothing is drawn; a real day = the words.
 * Hidden from a screen reader on purpose: the date field already announces its own value, and this would add itself to the label.
 */
export function DateWords({ iso }: { iso: string }) {
  const words = dateInWords(iso)
  if (!words) return null
  return <small className="datewords" aria-hidden="true">{words}</small>
}
