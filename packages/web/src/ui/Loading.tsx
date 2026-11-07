import { useLang } from '../i18n'

/** One loading state for every wait on the network. It fades in after a short delay so a quick load never flashes it. */
export function Loading({ label }: { label?: string }) {
  const { t } = useLang()
  const text = label ?? t('common.loading')
  return (
    <div className="loading" role="status" aria-label={text}>
      <span className="loading__ring" aria-hidden="true" />
      <span className="loading__label">{text}…</span>
    </div>
  )
}
