import type { ComponentProps } from 'react'
import { useLang } from '../../i18n'
import { cx } from '../atoms/cx'
import { useDocumentTitle } from '../useDocumentTitle'
import { SkipLink } from '../atoms/SkipLink'

/**
 * AuthShell: the frame of the sign-in screen (UI/UX plan, phase 6): no app bar (nobody is signed in, so there is no menu and no tabs) and a
 * centred column for one card (`main.login`), with the skip link before it (the target is `main#main`). The language pair lives in the card, not here.
 */
export function AuthShell({ title, className, children, ...main }: { title?: string } & ComponentProps<'main'>) {
  const { t } = useLang()
  useDocumentTitle(title, t('app.title'))
  return (
    <>
      <SkipLink>{t('common.skip')}</SkipLink>
      <main id="main" tabIndex={-1} className={cx('login', className)} {...main}>{children}</main>
    </>
  )
}
