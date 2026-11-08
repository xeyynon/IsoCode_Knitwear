import type { ComponentProps } from 'react'
import { cx } from '../atoms/cx'

/**
 * AuthShell: the frame of the sign-in screen (UI/UX plan, phase 6): no app bar (nobody is signed in, so there is no menu and no tabs) and a
 * centred column for one card (`main.login`). The language pair lives in the card, not here. It draws exactly what the page wrote by hand.
 */
export function AuthShell({ className, children, ...main }: ComponentProps<'main'>) {
  return <main className={cx('login', className)} {...main}>{children}</main>
}
