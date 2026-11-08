import type { ComponentProps } from 'react'
import { useLang } from '../../i18n'
import { AppBar } from '../AppBar'
import { cx } from '../atoms/cx'
import { SkipLink } from '../atoms/SkipLink'

/**
 * SupervisorShell: the frame of a supervisor's screen (UI/UX plan, phase 6): a skip link, the app bar, then one narrow column (`main.page.page--narrow`, 560 px at most).
 * The bottom region is not drawn here: a screen that has a pinned action gives it to its own ActionBar, which is one `ui/bottomSlot`, never two.
 * `main` is the skip link's target (`id="main"`, `tabIndex={-1}`); a page may pass its own id or tabIndex, and a ref, as Today does for its focus effect.
 * States: none of its own; the page puts loading, empty and failed states inside.
 */
export function SupervisorShell({ title, plainTitle, className, children, ...main }: { title: string; plainTitle?: boolean } & ComponentProps<'main'>) {
  const { t } = useLang()
  return (
    <>
      <SkipLink>{t('common.skip')}</SkipLink>
      <AppBar title={title} plainTitle={plainTitle} />
      <main id="main" tabIndex={-1} className={cx('page', 'page--narrow', className)} {...main}>{children}</main>
    </>
  )
}
