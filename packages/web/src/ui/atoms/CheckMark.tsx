/**
 * A small check in a ring, drawn in the text colour around it (the action colour where the text is): "something was added today". It says
 * nothing by itself (always hidden from a screen reader; the words beside it carry the meaning), and it is never a status.
 */
export function CheckMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="7.5" /><path d="m5.6 9.2 2.4 2.4 4.4-4.8" />
    </svg>
  )
}
