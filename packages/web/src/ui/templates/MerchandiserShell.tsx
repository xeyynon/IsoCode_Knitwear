import type { ComponentProps } from 'react'
import { AppBar } from '../AppBar'
import { cx } from '../atoms/cx'
import { SkipLink } from '../atoms/SkipLink'

/**
 * MerchandiserShell: the frame of a merchandiser's screen (UI/UX plan, phase 6): a skip link, the app bar (with the Board, Review and Setup tabs) and a wide
 * column (`main.page`, 1200 px at most). `form` is the narrower reading width of the form screens (`page--form`, 880 px) and `bento` is the order
 * page's two-column grid (`page--bento`). `main` is the skip link's target (`id="main"`, `tabIndex={-1}`). Merchandiser screens are English only.
 * States: none of its own.
 */
export function MerchandiserShell({ title, plainTitle, form, bento, className, children, ...main }: { title: string; plainTitle?: boolean; form?: boolean; bento?: boolean } & ComponentProps<'main'>) {
  return (
    <>
      <SkipLink>Skip to main content</SkipLink>
      <AppBar title={title} plainTitle={plainTitle} />
      <main id="main" tabIndex={-1} className={cx('page', form && 'page--form', bento && 'page--bento', className)} {...main}>{children}</main>
    </>
  )
}
