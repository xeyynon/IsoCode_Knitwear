import type { ReactNode } from 'react'
import { cx } from '../atoms/cx'

/**
 * Field: a label, its control and (optionally) the sentence under it, inside one `<label class="field">`, as the pages wrote it (slice 2.1).
 * The label text is the first child, so the control is named by it. States are the control's own (empty, typing, invalid, disabled); `below` is
 * where a field's hint or error goes (an ErrorText), so it is read with the field.
 */
export function Field({ label, children, below, className }: { label: ReactNode; children: ReactNode; below?: ReactNode; className?: string }) {
  return (
    <label className={cx('field', className)}>
      <span>{label}</span>
      {children}
      {below}
    </label>
  )
}
