import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { setLang, useLang } from '../i18n'
import { getClaims, signOut } from '../api/session'
import { BUILD_LABEL } from '../release/buildInfo'
import './AppBar.css'
import { WhatsNewDialog } from './WhatsNewDialog'
import { NavTabs } from './molecules/NavTabs'
import { PopoverMenu } from './molecules/PopoverMenu'
import { ThemeMenuItem } from './ThemeMenuItem'
import { useDocumentTitle } from './useDocumentTitle'
import { useReviewCount } from './useReviewCount'
import { useConfirm } from './ConfirmDialog'
import { useQueue } from '../queue/instance'
import { cx } from './atoms/cx'

/**
 * The top bar, the same on every page (the ORCA top bar guide, adapted): three shapes on the page, not one strip.
 *   left   a capsule flush with the left edge: the app mark and name, a link home;
 *   centre a tab hanging from the top edge, centred on the screen whatever the sides hold: a merchandiser's views (Board, Review, Setup), a
 *          supervisor's page title (a supervisor has one flow and nothing to switch between);
 *   right  a capsule flush with the right edge: the one menu (language for a supervisor, theme, what's new, sign out).
 * A public page (the status page, a buyer's link) gets the left capsule only: a visitor is offered no internal screen and no control.
 * There is no search: this app has no global search, and a dead control is worse than none.
 *
 * One h1 per page: a supervisor's centre tab is the h1 (a paragraph when the page shows its own, `plainTitle`); a merchandiser's tabs already
 * say where they are, so the h1 is visually hidden (and absent when the page shows its own). The entrance slides in once per visit, not on
 * every page change (a replay on each navigation would look like a wiggle): the first bar plays it and leaves a mark on <html>.
 */
export function AppBar({ title, plainTitle = false, variant }: { title: string; plainTitle?: boolean; variant?: 'public' }) {
  const { lang, t } = useLang()
  const isPublic = variant === 'public'
  useDocumentTitle(isPublic ? undefined : title, t('app.title'))
  const [news, setNews] = useState(false)
  // Release notes are public English wording, so they are for merchandisers; every menu shows the build label.
  const role = getClaims()?.role
  const merchandiser = !isPublic && role === 'merchandiser'
  // The language switch is for supervisors: a merchandiser's screens are English only, so offering Tamil would only turn a few fragments of them.
  const canSwitch = role !== 'merchandiser'
  // A supervisor with updates still on the phone is asked before signing out (FE-S-07): they stay saved and send after the next sign-in.
  const { state: queueState } = useQueue()
  const waiting = queueState?.pending ?? 0
  const { confirm, dialog: confirmDialog } = useConfirm()
  // A merchandiser's Board, Review and Setup are tabs in this bar; the Review tab shows how many wait (slice 3.3).
  const reviewCount = useReviewCount(merchandiser)
  const bar = useRef<HTMLElement>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const [enter] = useState(() => typeof document !== 'undefined' && document.documentElement.dataset.appbarIn !== '1')
  useEffect(() => { document.documentElement.dataset.appbarIn = '1' }, [])

  // The bar's real height, for things that stick under it (the review summary bar, a jump's scroll margin). It is taller when the views take
  // a band of their own on a phone, so a fixed 56 px was wrong.
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--appbar-h', `${el.offsetHeight}px`)
    set()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  const home = merchandiser ? '/board' : isPublic ? '/' : '/today'
  const brandName = isPublic ? 'Order tracking' : t('app.title')

  return (
    <header ref={bar} className={cx('appbar', merchandiser && 'appbar--views', enter && 'appbar--enter')}>
      <div className="appbar__cell appbar__cell--left">
        <Link className="appbar__left" to={home}>
          <img className="appbar__mark" src="/icons/icon-192.png" alt="" width="24" height="24" />
          <span className="appbar__brand">{brandName}</span>
        </Link>
      </div>
      {merchandiser && <NavTabs reviewCount={reviewCount} />}
      {merchandiser && !plainTitle && <h1 className="visually-hidden">{title}</h1>}
      {!merchandiser && !isPublic && (
        <div className="appbar__center">
          {plainTitle ? <p className="appbar__title">{title}</p> : <h1 className="appbar__title">{title}</h1>}
        </div>
      )}
      <div className="appbar__cell appbar__cell--right">
        {!isPublic && (
          <div className="appbar__right">
            <PopoverMenu
              label={t('nav.menu')}
              icon={<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>}
              buttonRef={button}
            >
              {(close) => (
                <>
                  {canSwitch && (
                    <button role="menuitem" className="menu__item" onClick={() => { setLang(lang === 'en' ? 'ta' : 'en'); close(true) }}>
                      {t(lang === 'en' ? 'nav.toTamil' : 'nav.toEnglish')}
                    </button>
                  )}
                  <ThemeMenuItem onChosen={() => close(true)} />
                  {merchandiser && (
                    <button role="menuitem" className="menu__item" onClick={() => { close(false); setNews(true) }}>{t('release.whatsNew')}</button>
                  )}
                  <div role="separator" className="menu__sep" />
                  <button role="menuitem" className="menu__item" onClick={async () => {
                    close(false) // the menu closes before the question opens, so it is not left hanging behind the dialog
                    if (!merchandiser && waiting > 0 && !(await confirm({ title: t('nav.signOutWaitingTitle'), body: t('nav.signOutWaiting', { n: waiting }), confirmLabel: t('nav.signOut'), cancelLabel: t('nav.signOutStay'), destructive: true }))) { button.current?.focus(); return }
                    signOut()
                  }}>{t('nav.signOut')}</button>
                  {BUILD_LABEL && <div role="none" className="menu__build">{BUILD_LABEL}</div>}
                </>
              )}
            </PopoverMenu>
          </div>
        )}
      </div>
      {confirmDialog}
      {news && <WhatsNewDialog onClose={() => { setNews(false); button.current?.focus() }} />}
    </header>
  )
}
