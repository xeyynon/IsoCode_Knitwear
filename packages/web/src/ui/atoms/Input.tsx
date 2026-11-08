import type { ComponentProps } from 'react'
import { cx } from './cx'

/**
 * Input, Select and Textarea: the form controls with the app's one look (`.input`, styles.css) and its variants, written in one place (slice 2.1).
 * They draw the same markup the pages wrote by hand. States: empty, typing, focus (3 px ring), invalid (`aria-invalid` from the page, drawn by the
 * rule as a heavy ink border, never red: red is order status), disabled, read-only. Variants: `tall` (supervisor sign-in, 56 px), `big` (the pieces
 * figure on Update, 56 px and 36 px type), `mono` (numbers), `asking` (the "more than is left" question).
 */
interface Look { tall?: boolean; big?: boolean; mono?: boolean; asking?: boolean }

export function Input({ tall, big, mono, asking, className, ...rest }: Look & ComponentProps<'input'>) {
  return <input className={cx('input', mono && 'mono', tall && 'input--tall', big && 'input--big', asking && 'input--asking', className)} {...rest} />
}

export function Select({ className, ...rest }: ComponentProps<'select'>) {
  return <select className={cx('input', className)} {...rest} />
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx('input', 'textarea', className)} {...rest} />
}
