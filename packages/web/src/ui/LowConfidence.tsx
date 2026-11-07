/**
 * "Entered by a merchandiser, low confidence": a person mark plus the words. One component for the
 * board and the order page so the two always say it the same way, and never by colour alone.
 */
export function LowConfidence({ text }: { text: string }) {
  return (
    <span className="lowconf">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="5" r="2.6" />
        <path d="M2.8 14c.4-3 2.5-4.4 5.2-4.4s4.8 1.4 5.2 4.4" />
      </svg>
      <span>{text}</span>
    </span>
  )
}
