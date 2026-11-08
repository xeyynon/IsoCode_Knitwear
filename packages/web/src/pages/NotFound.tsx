import { useSyncExternalStore } from 'react'
import { getClaims, snapshot, subscribe } from '../api/session'
import { useLang } from '../i18n'
import { ButtonLink } from '../ui/atoms/Button'
import { MerchandiserShell } from '../ui/templates/MerchandiserShell'
import { PublicShell } from '../ui/templates/PublicShell'
import { SupervisorShell } from '../ui/templates/SupervisorShell'

/**
 * An address that does not exist (AUDIT-03, finding 16): a mistyped or old link used to be sent silently to the home screen, which gave no hint
 * that the address was wrong. Now it says so in one plain sentence and gives one way back, in the language and the frame of whoever is looking:
 * a supervisor (Tamil or English, back to Today), a merchandiser (English, back to the board), or someone not signed in (English, to the sign-in,
 * with no app bar so no internal screen is offered). States: one.
 */
export default function NotFound() {
  useSyncExternalStore(subscribe, snapshot)
  const role = getClaims()?.role
  const { t, lang } = useLang()
  if (role === 'supervisor') {
    return (
      <SupervisorShell title={t('err.notFoundTitle')}>
        <p>{t('err.notFound')}</p>
        <p><ButtonLink to="/today" block>{t('err.notFoundBack')}</ButtonLink></p>
      </SupervisorShell>
    )
  }
  if (role === 'merchandiser') {
    return (
      <MerchandiserShell title="Page not found" form>
        <p>That page does not exist.</p>
        <p><ButtonLink to="/board">Back to the board</ButtonLink></p>
      </MerchandiserShell>
    )
  }
  return (
    <PublicShell narrow title={t('err.notFoundTitle')}>
      {/* Someone who is not signed in may have chosen Tamil on the sign-in screen: the same words as a signed-in supervisor sees (FE-S-08).
          The language is English unless a choice was made, so a merchandiser or a buyer still reads English. */}
      <h1>{t('err.notFoundTitle')}</h1>
      <p>{t('err.notFound')}</p>
      <p><ButtonLink to="/login">{lang === 'ta' ? t('login.title') : 'Go to sign in'}</ButtonLink></p>
    </PublicShell>
  )
}
