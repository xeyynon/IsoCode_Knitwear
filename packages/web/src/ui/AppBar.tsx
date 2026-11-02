import { useEffect, useRef, useState } from 'react'
import { setLang, useLang } from '../i18n'
import { signOut } from '../api/session'

/**
 * One bar, one menu. Language and Sign out live in a single menu rather than a row of
 * buttons. Menu pattern: Esc closes it and stops there (one press, one step), focus
 * returns to the button, arrows move, outside click closes.
 */
export function AppBar({ title }: { title: string }) {
  const { lang, t } = useLang()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

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
    <header className="appbar">
      <span className="appbar__brand">{t('app.title')}</span>
      <h1 className="appbar__title">{title}</h1>
      <div className="menu" onKeyDown={onKey}>
        <button ref={button} className="btn btn--icon" aria-haspopup="menu" aria-expanded={open} aria-label={t('nav.menu')} onClick={() => setOpen((o) => !o)}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4.5h14M2 9h14M2 13.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
        {open && (
          <div ref={menu} className="menu__popover" role="menu">
            <button role="menuitem" className="menu__item" onClick={() => { setLang(lang === 'en' ? 'ta' : 'en'); close() }}>
              {lang === 'en' ? 'தமிழ்' : 'English'}
            </button>
            <div role="separator" className="menu__sep" />
            <button role="menuitem" className="menu__item" onClick={() => signOut()}>{t('nav.signOut')}</button>
          </div>
        )}
      </div>
    </header>
  )
}
