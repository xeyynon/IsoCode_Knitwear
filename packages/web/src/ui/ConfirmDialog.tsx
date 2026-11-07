import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createAsker, type ConfirmRequest } from './confirmAsker'

export type { ConfirmRequest }

interface Props extends ConfirmRequest {
  /** Called once, with true only when the confirm button was used. Escape, Cancel and a tap outside all answer false. */
  onAnswer: (ok: boolean) => void
}

/** Tab from the last button goes to the first and Shift+Tab the other way, so focus never leaves for the browser's own toolbar. */
export function keepFocusInside(e: React.KeyboardEvent<HTMLDialogElement>) {
  if (e.key !== 'Tab') return
  const buttons = e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')
  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  if (!first || !last) return
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

/**
 * A confirmation on the native dialog element: showModal() makes the page behind inert and keeps
 * Tab inside, Escape cancels, and focus goes back to the button that opened it. Mount it only while
 * a question is open (useConfirm does that). The destructive variant starts on Cancel and its
 * confirm button is plain: red, amber and green belong to order status alone.
 */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, destructive, onAnswer }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    opener.current = document.activeElement
    if (!dialog.open) dialog.showModal()
    ;(destructive ? cancelRef : confirmRef).current?.focus()
    // No cleanup: removing an open modal dialog from the page takes it out of the top layer by itself.
  }, [destructive])

  function closed() {
    const back = opener.current
    if (back instanceof HTMLElement && back.isConnected) back.focus()   // older browsers do not always do this themselves
    onAnswer(ref.current?.returnValue === 'confirm')
  }

  return (
    <dialog
      ref={ref}
      className="confirm"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      onClose={closed}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close('cancel') }}
      onKeyDown={keepFocusInside}
    >
      <div className="confirm__box">
        <h2 id="confirm-title" className="confirm__title">{title}</h2>
        <p id="confirm-body" className="confirm__body">{body}</p>
        <div className="confirm__actions">
          <button type="button" ref={cancelRef} className="btn" onClick={() => ref.current?.close('cancel')}>{cancelLabel}</button>
          <button type="button" ref={confirmRef} className={destructive ? 'btn btn--strong' : 'btn btn--primary'} onClick={() => ref.current?.close('confirm')}>{confirmLabel}</button>
        </div>
      </div>
    </dialog>
  )
}

/**
 * `const { confirm, dialog } = useConfirm()`; render `{dialog}` once in the component, then
 * `if (!(await confirm({ ... }))) return` where the browser's confirm box used to be.
 */
export function useConfirm(): { confirm: (request: ConfirmRequest) => Promise<boolean>; dialog: ReactNode } {
  const [open, setOpen] = useState<{ id: number; request: ConfirmRequest } | null>(null)
  const seq = useRef(0)
  const asker = useMemo(() => createAsker<ConfirmRequest>((request) => setOpen(request ? { id: ++seq.current, request } : null)), [])
  useEffect(() => () => asker.cancel(), [asker])   // leaving the screen settles an open question as "no"
  return {
    confirm: asker.ask,
    dialog: open ? <ConfirmDialog key={open.id} {...open.request} onAnswer={asker.answer} /> : null,
  }
}
