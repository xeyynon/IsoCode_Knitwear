import type { ComponentProps } from 'react'
import { cx } from './cx'

/**
 * ErrorText: the sentence under a form or a field that says what went wrong (`<p class="error" role="alert">`, announced when it appears). Drawn in
 * ink with a mark (see `.error` in styles.css), never red. States: nothing (the page renders none), showing. The page decides when to show it and
 * what it says; this only fixes how it looks and that it is announced.
 */
export function ErrorText({ className, ...rest }: ComponentProps<'p'>) {
  return <p className={cx('error', className)} role="alert" {...rest} />
}
