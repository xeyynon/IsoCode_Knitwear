import { useEffect, useRef } from 'react'
import { useLang } from '../i18n'
import { keepFocusInside } from './ConfirmDialog'

/**
 * One photo at full size on the native dialog element: showModal() makes the page behind inert,
 * Escape and the Close button close it, and focus goes back to what opened it. The picture is
 * not capped in width and sits in a scrolling box with `touch-action: pinch-zoom`, so a finger
 * can scroll it and pinch it. Mount it only while open; the caller owns the picture's address.
 */
export function PhotoViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useLang()
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    opener.current = document.activeElement
    if (!dialog.open) dialog.showModal()
    closeRef.current?.focus()
    // No cleanup: removing an open modal dialog from the page takes it out of the top layer by itself.
  }, [])

  function closed() {
    const back = opener.current
    if (back instanceof HTMLElement && back.isConnected) back.focus()   // older browsers do not always do this themselves
    onClose()
  }

  return (
    <dialog
      ref={ref}
      className="viewer"
      aria-label={alt}
      onClose={closed}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close() }}
      onKeyDown={keepFocusInside}
    >
      <div className="viewer__bar">
        <span className="sub viewer__hint">{t('viewer.hint')}</span>
        <button type="button" ref={closeRef} className="btn" onClick={() => ref.current?.close()}>{t('viewer.close')}</button>
      </div>
      <div className="viewer__scroll" tabIndex={0}>
        <img className="viewer__img" src={src} alt={alt} />
      </div>
    </dialog>
  )
}
