import type { ReactNode } from 'react'
import './ProgressRing.css'

/**
 * A ring that fills to a fraction, with something short in the middle (UI/UX plan, phase 8A). States: empty (0), partly filled,
 * full (1); a wrong number (NaN, over 1) is clamped, never drawn broken. It carries no words and no status colour: it is hidden from a
 * screen reader because the sentence beside it says the same thing. The fill grows once on arrival, and not at all under reduced motion.
 */
export function ProgressRing({ fraction, size = 88, stroke = 10, children }: { fraction: number; size?: number; stroke?: number; children?: ReactNode }) {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="ring" aria-hidden="true" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} focusable="false">
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle className="ring__fill" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - f)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring__center">{children}</div>
    </div>
  )
}
