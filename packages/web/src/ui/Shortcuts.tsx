import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getClaims, snapshot, subscribe } from '../api/session'
import { useLang } from '../i18n'
import { Button } from './atoms/Button'
import { keepFocusInside } from './ConfirmDialog'
import { IDLE, isTypingTarget, routeFor, shortcutsOn, stepShortcut, type SequenceState } from './shortcutKeys'

/** The shortcuts a merchandiser can use, in the order the help lists them. Key labels are the keys themselves, so they are not translated. */
const LIST = [
  { keys: ['/'], label: 'shortcuts.search' },
  { keys: ['g', 'b'], label: 'shortcuts.board' },
  { keys: ['g', 'r'], label: 'shortcuts.review' },
  { keys: ['g', 's'], label: 'shortcuts.setup' },
  { keys: ['?'], label: 'shortcuts.help' },
] as const

/**
 * Listens for the merchandiser's keyboard shortcuts and shows their help. Mount it once inside the
 * router. It renders nothing for a supervisor, a buyer or anyone signed out, and nothing at all
 * until "?" is pressed. The rules are in shortcutKeys.ts.
 */
export default function Shortcuts() {
  useSyncExternalStore(subscribe, snapshot)
  const role = getClaims()?.role
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [help, setHelp] = useState(false)
  const seq = useRef<SequenceState>(IDLE)
  const opener = useRef<Element | null>(null)
  const on = shortcutsOn(role, pathname)

  useEffect(() => {
    if (!on) { seq.current = IDLE; return }
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.isComposing) return
      if (isTypingTarget(e.target as HTMLElement | null) || isTypingTarget(document.activeElement)) return
      if (document.querySelector('dialog[open]')) { seq.current = IDLE; return }   // a question or the help is open: the page behind is not being used
      const step = stepShortcut(seq.current, e, Date.now())
      seq.current = step.state
      if (step.handled) e.preventDefault()
      switch (step.action) {
        case 'search': {
          const box = document.querySelector<HTMLInputElement>('[role="search"] input[type="search"]')
          box?.focus()
          box?.select()
          break
        }
        case 'help':
          opener.current = document.activeElement
          setHelp(true)
          break
        case 'board': case 'review': case 'setup': {
          const to = routeFor(step.action)
          if (to && to !== window.location.pathname) navigate(to)
          break
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [on, navigate])

  // Signing out or moving to a public page while the help is open closes it.
  useEffect(() => { if (!on) setHelp(false) }, [on])

  if (!on || !help) return null
  return <ShortcutsDialog onClose={() => {
    setHelp(false)
    const back = opener.current
    if (back instanceof HTMLElement && back.isConnected) back.focus()
  }} />
}

/** The help, on the same native dialog as ConfirmDialog and WhatsNewDialog. */
function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    closeButton.current?.focus()
  }, [])

  return (
    <dialog
      ref={ref}
      className="confirm shortcuts"
      aria-labelledby="shortcuts-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close() }}
      onKeyDown={keepFocusInside}
    >
      <div className="confirm__box">
        <h2 id="shortcuts-title" className="confirm__title">{t('shortcuts.title')}</h2>
        <ul className="plain shortcuts__list">
          {LIST.map((s) => (
            <li key={s.label} className="shortcuts__row">
              <span className="shortcuts__keys">
                {s.keys.map((k, i) => (
                  <span key={i}>
                    {i > 0 && <span className="sub shortcuts__then"> {t('shortcuts.then')} </span>}
                    <kbd className="kbd">{k}</kbd>
                  </span>
                ))}
              </span>
              <span className="shortcuts__label">{t(s.label)}</span>
            </li>
          ))}
        </ul>
        <p className="sub shortcuts__note">{t('shortcuts.note')}</p>
        <div className="confirm__actions">
          <Button type="button" ref={closeButton} variant="primary" onClick={() => ref.current?.close()}>{t('shortcuts.close')}</Button>
        </div>
      </div>
    </dialog>
  )
}
