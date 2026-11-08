import type { ComponentProps } from 'react'
import { AppBar } from '../AppBar'
import { cx } from '../atoms/cx'

/**
 * MerchandiserShell: the frame of a merchandiser's screen (UI/UX plan, phase 6): the app bar (with the Board, Review and Setup tabs) and a wide
 * column (`main.page`, 1200 px at most). `form` is the narrower reading width of the form screens (`page--form`, 880 px) and `bento` is the order
 * page's two-column grid (`page--bento`). It draws exactly what the pages wrote by hand. States: none of its own.
 */
export function MerchandiserShell({ title, plainTitle, form, bento, className, children, ...main }: { title: string; plainTitle?: boolean; form?: boolean; bento?: boolean } & ComponentProps<'main'>) {
  return (
    <>
      <AppBar title={title} plainTitle={plainTitle} />
      <main className={cx('page', form && 'page--form', bento && 'page--bento', className)} {...main}>{children}</main>
    </>
  )
}
