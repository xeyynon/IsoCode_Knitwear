import type { ComponentProps } from 'react'
import { cx } from '../atoms/cx'

/**
 * PublicShell: the frame of the screens anyone can open without signing in (the buyer's link page and the status page): no app bar and no
 * navigation, because a visitor must not be offered an internal screen (UI/UX plan, phase 6). `narrow` is the 560 px column of the status page;
 * without it the reading width of the form screens. It draws exactly what the pages wrote by hand.
 */
export function PublicShell({ narrow, className, children, ...main }: { narrow?: boolean } & ComponentProps<'main'>) {
  return <main className={cx('page', narrow ? 'page--narrow' : 'page--form', className)} {...main}>{children}</main>
}
