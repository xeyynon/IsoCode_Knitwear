import { createElement, type ComponentProps } from 'react'
import { cx } from './cx'

/**
 * Card: a bordered white surface that groups one thing (`.card`, styles.css): a border and no shadow, neutral, never tinted by status. `as` picks
 * the element (a section by default; a form for the sign-in card; a div where a section would be one landmark too many).
 */
type As = 'section' | 'div' | 'form' | 'article' | 'li'
export function Card({ as = 'section', className, ...rest }: { as?: As } & ComponentProps<'section'> & ComponentProps<'form'>) {
  return createElement(as, { className: cx('card', className), ...rest })
}
