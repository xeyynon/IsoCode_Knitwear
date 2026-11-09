import type { ComponentProps } from 'react'
import { AppBar } from '../AppBar'
import { cx } from '../atoms/cx'
import { useDocumentTitle } from '../useDocumentTitle'
import { SkipLink } from '../atoms/SkipLink'

/**
 * PublicShell: the frame of the screens anyone can open without signing in (the buyer's link page and the status page): the skip link, the top
 * bar's brand capsule ALONE (the same look as every other page, but no views, no menu and no control, because a visitor must not be offered an
 * internal screen), then `main#main`. `title` is the page's heading, for the browser tab (the page draws its own h1). `narrow` is the 560 px column of the
 * status page; without it the reading width of the form screens. These pages are English.
 */
export function PublicShell({ title, narrow, className, children, ...main }: { title?: string; narrow?: boolean } & ComponentProps<'main'>) {
  useDocumentTitle(title, 'Order tracking') // the tab says what the page's heading says
  return (
    <>
      <SkipLink>Skip to main content</SkipLink>
      <AppBar title={title ?? ''} variant="public" />
      <main id="main" tabIndex={-1} className={cx('page', narrow ? 'page--narrow' : 'page--form', className)} {...main}>{children}</main>
    </>
  )
}
