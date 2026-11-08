import type { ComponentProps } from 'react'
import { AppBar } from '../AppBar'
import { cx } from '../atoms/cx'

/**
 * SupervisorShell: the frame of a supervisor's screen (UI/UX plan, phase 6): the app bar, then one narrow column (`main.page.page--narrow`, 560 px at most).
 * The bottom region is not drawn here: a screen that has a pinned action gives it to its own ActionBar, which is one `ui/bottomSlot`, never two.
 * It draws exactly what the pages wrote by hand, so nothing on screen or in the accessibility tree changes. Other `main` props (a ref, tabIndex) pass through.
 * States: none of its own; the page puts loading, empty and failed states inside.
 */
export function SupervisorShell({ title, plainTitle, className, children, ...main }: { title: string; plainTitle?: boolean } & ComponentProps<'main'>) {
  return (
    <>
      <AppBar title={title} plainTitle={plainTitle} />
      <main className={cx('page', 'page--narrow', className)} {...main}>{children}</main>
    </>
  )
}
