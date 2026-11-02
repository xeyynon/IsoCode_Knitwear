import type { Status } from '../board/boardLogic'
import { useLang } from '../i18n'

/**
 * One component for status, everywhere. The mark, the word and the colour always travel
 * together: red, amber and green are almost the same lightness, so in greyscale or for a
 * colour-blind reader only the shape and the word tell them apart.
 */
function Icon({ status }: { status: Status }) {
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false } as const
  switch (status) {
    case 'red': // filled triangle with !
      return (
        <svg {...common}>
          <path d="M8 1.5 15 14H1z" fill="currentColor" />
          <path d="M8 6v4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="12" r=".9" fill="#fff" />
        </svg>
      )
    case 'amber': // outlined clock
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.2" />
          <path d="M8 4.6V8l2.3 1.5" />
        </svg>
      )
    case 'green': // hollow check
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6.2" />
          <path d="m5.2 8.2 2 2 3.6-4" />
        </svg>
      )
    default: // grey: dashed circle
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.4 2">
          <circle cx="8" cy="8" r="6.2" />
        </svg>
      )
  }
}

export function StatusBadge({ status }: { status: Status }) {
  const { t } = useLang()
  return (
    <span className={`badge badge--${status}`}>
      <Icon status={status} />
      <span>{t(`status.${status}`)}</span>
    </span>
  )
}
