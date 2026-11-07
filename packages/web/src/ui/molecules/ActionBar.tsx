import type { ReactNode } from 'react'
import { setBottomSlot } from '../bottomSlot'
import './ActionBar.css'

/**
 * A form's one primary action, pinned to the bottom of the screen so it is always in reach while the form above it
 * scrolls (UI/UX plan, slice 1.1: on the supervisor's Update screen Send used to sit below seven reason buttons, a note
 * box and the photo button, out of sight once the number was typed).
 *
 * Put the things that belong to the action inside it, in reading order: a failure line, the "saved on the phone" line, a
 * question about the number, then the button. It also hosts the "new version is ready" bar (ui/bottomSlot.ts) so the two
 * never cover each other.
 *
 * Rules (ui/README.md): no transform or animation here or on an ancestor (an applied transform makes an element the
 * containing block of fixed and sticky children), and no overflow on an ancestor (it stops position: sticky working).
 */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="actionbar">
      <div className="actionbar__slot" ref={setBottomSlot} />
      {children}
    </div>
  )
}
