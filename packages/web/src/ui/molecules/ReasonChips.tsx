import { reasonLabel, type Reason } from '../../notes/reasons'
import './ReasonChips.css'

/**
 * "Why is it slow?": the reasons as chips, one or several (the form review, 10 Nov 2026: a slow day often has more than one cause). Each chip is a real
 * checkbox, so the keyboard, the screen reader ("checked", "not checked") and the browser's own grouping all work; a tap switches that one reason and
 * nothing else. The selected look is the action colour plus a check mark (colour is never the only sign); each chip is 48 px high.
 *
 * States: nothing selected (no count shown), some selected (a quiet "2 selected" that a screen reader hears), narrow screen (the pills wrap).
 * The words come in as props; the class names are the ones the narrow-screen rules in the Update stylesheet already use.
 */
export function ReasonChips({ legend, reasons, lang, selected, onToggle, countText }: {
  legend: string; reasons: Reason[]; lang: 'en' | 'ta'; selected: readonly string[]; onToggle: (id: string) => void; countText: (n: number) => string
}) {
  return (
    <fieldset className="reasons">
      <legend>{legend}</legend>
      <div className="reasons__list">
        {reasons.map((r) => (
          <label key={r.id} className="reason">
            <input type="checkbox" className="visually-hidden" value={r.id} checked={selected.includes(r.id)} onChange={() => onToggle(r.id)} />
            <span className="reason__pill">{reasonLabel(r, lang)}</span>
          </label>
        ))}
      </div>
      <p className="reasons__count sub" aria-live="polite">{selected.length > 0 ? countText(selected.length) : ''}</p>
    </fieldset>
  )
}
