import type { ComponentProps } from 'react'
import { cx } from './cx'

/**
 * Banner: a sentence that must be seen now, in a bordered strip (`<p class="banner" role="alert">`, `.banner` in styles.css): "your phone is nearly
 * full", "more than is left, send anyway?". Neutral: it carries words, never a status colour. States: not drawn (the page decides), showing and
 * announced. Pass `role="status"` for something that is news and not a problem.
 */
export function Banner({ className, ...rest }: ComponentProps<'p'>) {
  return <p className={cx('banner', className)} role="alert" {...rest} />
}
