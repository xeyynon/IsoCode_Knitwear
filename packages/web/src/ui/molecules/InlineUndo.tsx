import { useId } from 'react'
import { Button } from '../atoms/Button'
import { ErrorText } from '../atoms/ErrorText'
import './InlineUndo.css'

/**
 * InlineUndo: a line in the page, where the card was, that says what was hidden and offers to bring it back (UI/UX plan, slice 4.1).
 * It is not a toast: it has no timer and no animation, it stays while the page stays, and it is a real list item you can reach with the
 * keyboard. Merchandiser screens are English only.
 *
 * States: idle (the words and "Undo"); working (the button is disabled and says "Undoing…", so a second click cannot send a second request);
 * failed (the words of the failure under the line, announced, and the button stays so it can be tried again); failed for good (`final`: the
 * words stay and the button goes, because trying again cannot help). A success is not drawn here: the page removes the line.
 * The page decides when a line exists at all (only for a warning that was waiting for review) and what an error says.
 */
export function InlineUndo({ label, name, onUndo, busy = false, error, final = false }: {
  label: string
  /** What the button undoes, for a screen reader when there are several lines. Defaults to the label. */
  name?: string
  onUndo: () => void
  busy?: boolean
  error?: string | null
  final?: boolean
}) {
  const errId = useId()
  return (
    <li className="inlineundo">
      <div className="inlineundo__row">
        <span className="inlineundo__text">{label}</span>
        {!final && (
          <Button size="small" disabled={busy} onClick={onUndo} aria-label={`Undo: ${name ?? label}`} aria-describedby={error ? errId : undefined}>
            {busy ? 'Undoing…' : 'Undo'}
          </Button>
        )}
      </div>
      {error && <ErrorText id={errId} className="inlineundo__error">{error}</ErrorText>}
    </li>
  )
}
