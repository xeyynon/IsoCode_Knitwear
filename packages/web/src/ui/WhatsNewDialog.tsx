import { useEffect, useRef } from 'react'
import { useLang } from '../i18n'
import { Button } from './atoms/Button'
import { keepFocusInside } from './ConfirmDialog'
import { RECENT_BUILDS } from '../release/buildInfo'
import { buildWhen } from '../release/releaseInfo'

/**
 * The last few builds, in the release wording, on the same native dialog as ConfirmDialog (modal, Escape
 * and a tap outside close it, Tab stays inside). Mount it only while it is open; onClose runs once
 * when it closes by any route, and the caller puts focus back.
 */
export function WhatsNewDialog({ onClose }: { onClose: () => void }) {
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
      className="confirm whatsnew"
      aria-labelledby="whatsnew-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close() }}
      onKeyDown={keepFocusInside}
    >
      <div className="confirm__box">
        <h2 id="whatsnew-title" className="confirm__title">{t('release.whatsNew')}</h2>
        {RECENT_BUILDS.length === 0 && <p className="confirm__body">{t('release.none')}</p>}
        {RECENT_BUILDS.length > 0 && <ol className="whatsnew__list" tabIndex={0} aria-labelledby="whatsnew-title">
          {RECENT_BUILDS.map((b) => (
            <li key={b.n} className="whatsnew__item">
              <h3 className="whatsnew__name">{b.title}</h3>
              <p className="sub whatsnew__when">{buildWhen(b.n, b.date)}</p>
              <p className="whatsnew__text">{b.summary}</p>
            </li>
          ))}
        </ol>}
        <div className="confirm__actions">
          <Button type="button" ref={closeButton} variant="primary" onClick={() => ref.current?.close()}>{t('release.close')}</Button>
        </div>
      </div>
    </dialog>
  )
}
