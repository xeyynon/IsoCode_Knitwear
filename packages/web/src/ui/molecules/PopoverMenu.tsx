import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { Button } from '../atoms/Button'
import { nextMenuIndex } from '../menuRules'

/**
 * One menu, one behaviour, for the whole app (the top bar guide, section 7). The button opens a popover of `role="menuitem"` rows:
 * focus enters on the first row, ArrowUp and ArrowDown move and wrap, Home and End jump, Esc closes it and gives the focus back to the button
 * and goes no further (one press, one step), Tab closes it, a click outside closes it. The rows are given a `close` function: close(true)
 * also puts the focus back on the button, close(false) leaves it (a row that opens a dialog, which takes the focus itself).
 * States: closed, open.
 */
export function PopoverMenu({ label, menuLabel, icon, buttonRef, children }: {
  label: string
  menuLabel?: string
  icon: ReactNode
  buttonRef?: MutableRefObject<HTMLButtonElement | null>
  children: (close: (restoreFocus?: boolean) => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const own = useRef<HTMLButtonElement | null>(null)

  const items = () => [...(pop.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) own.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    items()[0]?.focus()
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return }
    if (e.key === 'Tab') { setOpen(false); return }
    const list = items()
    const next = nextMenuIndex(list.indexOf(document.activeElement as HTMLElement), list.length, e.key)
    if (next !== null) { e.preventDefault(); list[next]?.focus() }
  }

  return (
    <div className="menu" ref={root} onKeyDown={onKeyDown}>
      <Button
        ref={(el) => { own.current = el; if (buttonRef) buttonRef.current = el }}
        size="icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </Button>
      {open && <div ref={pop} className="menu__popover" role="menu" aria-label={menuLabel}>{children(close)}</div>}
    </div>
  )
}
