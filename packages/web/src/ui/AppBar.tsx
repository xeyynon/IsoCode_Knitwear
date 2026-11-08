import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { setLang, useLang } from '../i18n'
import { getClaims, signOut } from '../api/session'
import { BUILD_LABEL } from '../release/buildInfo'
import { Button } from './atoms/Button'
import { WhatsNewDialog } from './WhatsNewDialog'
import { NavTabs } from './molecules/NavTabs'
import { useReviewCount } from './useReviewCount'

/**
 * One bar, one menu. Language and Sign out live in a single menu rather than a row of
 * buttons. Menu pattern: Esc closes it and stops there (one press, one step), focus
 * returns to the button, arrows move, outside click closes.
 */
export function AppBar({ title, plainTitle = false }: { title: string; plainTitle?: boolean }) {
  const { lang, t } = useLang()
  const [open, setOpen] = useState(false)
  const [news, setNews] = useState(false)
  // Release notes are public English wording, so they are for merchandisers; every menu shows the build label.
  const merchandiser = getClaims()?.role === 'merchandiser'
  // A merchandiser's Board, Review and Setup are tabs in this bar; the Review tab shows how many wait (slice 3.3).
  const reviewCount = useReviewCount(merchandiser)
  const bar = useRef<HTMLElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  // The bar's real height, for things that stick under it (the review summary bar). It is taller when the tabs take a row of their own
  // on a phone, and when a long Tamil title wraps, so a fixed 56 px was wrong.
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--appbar-h', `${el.offsetHeight}px`)
    set()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const away = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && e.target !== button.current) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const close = () => { setOpen(false); button.current?.focus() }
  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <header ref={bar} className={merchandiser ? 'appbar appbar--nav' : 'appbar'}>
      <span className="appbar__brand">{t('app.title')}</span>
      {/* One h1 per page: the bar's title is the h1 unless the page shows its own (then plainTitle, same look). */}
      {plainTitle ? <p className="appbar__title">{title}</p> : <h1 className="appbar__title">{title}</h1>}
      {merchandiser && <NavTabs reviewCount={reviewCount} />}
      <div className="menu" onKeyDown={onKey}>
        <Button ref={button} size="icon" aria-haspopup="menu" aria-expanded={open} aria-label={t('nav.menu')} onClick={() => setOpen((o) => !o)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </Button>
        {open && (
          <div ref={menu} className="menu__popover" role="menu">
            <button role="menuitem" className="menu__item" onClick={() => { setLang(lang === 'en' ? 'ta' : 'en'); close() }}>
              {t(lang === 'en' ? 'nav.toTamil' : 'nav.toEnglish')}
            </button>
            {merchandiser && (
              <button role="menuitem" className="menu__item" onClick={() => { setOpen(false); setNews(true) }}>{t('release.whatsNew')}</button>
            )}
            <div role="separator" className="menu__sep" />
            <button role="menuitem" className="menu__item" onClick={() => signOut()}>{t('nav.signOut')}</button>
            {BUILD_LABEL && <div role="none" className="menu__build">{BUILD_LABEL}</div>}
          </div>
        )}
      </div>
      {news && <WhatsNewDialog onClose={() => { setNews(false); button.current?.focus() }} />}
    </header>
  )
}
