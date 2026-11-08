import type { ComponentProps } from 'react'
import { Link } from 'react-router-dom'
import { cx } from './cx'

/**
 * TextLink (a router link drawn as underlined text) and LinkButton (a button that must look like that text, for an action that stays on the page).
 * Same markup the pages wrote by hand (`class="link"`); the rule is `.link` in styles.css. States: default (action colour, underlined), hover,
 * focus-visible (3 px ring). A link that goes elsewhere is a TextLink; one that does something here is a LinkButton, so the keyboard and a screen
 * reader get the right role.
 */
export function TextLink({ className, ...rest }: ComponentProps<typeof Link>) {
  return <Link className={cx('link', className)} {...rest} />
}

export function LinkButton({ className, ...rest }: ComponentProps<'button'>) {
  return <button className={cx('link', className)} {...rest} />
}
