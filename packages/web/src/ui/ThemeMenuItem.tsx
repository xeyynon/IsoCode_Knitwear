import { useLang } from '../i18n'
import { setTheme, useTheme } from './theme'

/**
 * The theme choice in the app menu (one item, like the language item): it names the theme it will switch TO ("Dark theme" while the
 * page is light), switches on a click, and the choice is kept on this device. A supervisor's label is Tamil (a draft, unreviewed).
 */
export function ThemeMenuItem({ onChosen }: { onChosen: () => void }) {
  const { t } = useLang()
  const theme = useTheme()
  return (
    <button role="menuitem" className="menu__item" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); onChosen() }}>
      {t(theme === 'dark' ? 'nav.lightTheme' : 'nav.darkTheme')}
    </button>
  )
}
