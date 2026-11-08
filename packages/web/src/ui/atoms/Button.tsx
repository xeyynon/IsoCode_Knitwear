import type { ComponentProps } from 'react'
import { Link } from 'react-router-dom'
import { cx } from './cx'

/**
 * Button and ButtonLink: the one place a button's classes are written (UI/UX plan, slice 2.1). They draw exactly the markup the pages used to write by
 * hand (`<button class="btn btn--primary btn--block">`), so nothing on screen or in the accessibility tree changes; the rules themselves are the
 * older `.btn` ones in styles.css (the two-class `.btn.btn--block` there is what keeps Send at 56 px on a phone: do not turn it into one class).
 *
 * States, all from the platform: default, hover, focus-visible (a 3 px accent ring), disabled (a neutral grey, never a washed-out accent), busy
 * (the page passes `disabled` and its own "Sending..." words). Variants: `primary` (the one filled button of a screen), the default outlined
 * button, and `strong` (a heavier ink border). Sizes: default, `small`, `big`. `block` is full width. No `type` is added: a button inside a form
 * still submits it, as before.
 */
interface Look { variant?: 'primary' | 'default'; size?: 'default' | 'small' | 'big' | 'icon'; block?: boolean; strong?: boolean }

const look = ({ variant, size, block, strong }: Look) => [
  'btn',
  variant === 'primary' && 'btn--primary',
  size === 'small' && 'btn--small',
  size === 'big' && 'btn--big',
  size === 'icon' && 'btn--icon',
  block && 'btn--block',
  strong && 'btn--strong',
]

export function Button({ variant, size, block, strong, className, ...rest }: Look & ComponentProps<'button'>) {
  return <button className={cx(...look({ variant, size, block, strong }), className)} {...rest} />
}

/** A link that looks like a button (a way to another screen that wants the weight of a button). */
export function ButtonLink({ variant, size, block, strong, className, ...rest }: Look & ComponentProps<typeof Link>) {
  return <Link className={cx(...look({ variant, size, block, strong }), className)} {...rest} />
}
