import type { ComponentProps } from 'react'
import { cx } from './cx'

/**
 * Chip: a pressable pill that switches something on or off (`aria-pressed`), like the board's status filter on a phone. `.chip`, styles.css.
 * States: off, on (`aria-pressed`, drawn in the action colour with white text), hover, focus-visible, disabled. `tone` adds the status hook
 * (`chip--red` ...) the board uses for its counts; the colour is never the only sign (the word and the number are in the chip).
 */
export function Chip({ tone, className, ...rest }: { tone?: string } & ComponentProps<'button'>) {
  return <button className={cx('chip', tone && `chip--${tone}`, className)} {...rest} />
}
