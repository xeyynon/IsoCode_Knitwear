import type { ComponentProps } from 'react'
import { cx } from '../atoms/cx'
import { useDocumentTitle } from '../useDocumentTitle'
import { SkipLink } from '../atoms/SkipLink'

/**
 * PublicShell: the frame of the screens anyone can open without signing in (the buyer's link page and the status page): no app bar and no
 * navigation, because a visitor must not be offered an internal screen (UI/UX plan, phase 6), but still the skip link before `main#main`.
 * `title` is the page's heading, for the browser tab. `narrow` is the 560 px column of the status page; without it the reading width of the form screens. These pages are English.
 */
export function PublicShell({ title, narrow, className, children, ...main }: { title?: string; narrow?: boolean } & ComponentProps<'main'>) {
  useDocumentTitle(title, 'Order tracking')   // the tab says what the page's heading says
  return (
    <>
      <SkipLink>Skip to main content</SkipLink>
      <main id="main" tabIndex={-1} className={cx('page', narrow ? 'page--narrow' : 'page--form', className)} {...main}>{children}</main>
    </>
  )
}
