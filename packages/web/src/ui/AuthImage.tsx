import { useEffect, useState } from 'react'
import { apiBlob } from '../api/session'
import { useLang } from '../i18n'
import { PhotoViewer } from './PhotoViewer'

/**
 * A picture that needs the sign-in header (or a buyer link) to load. It fetches the bytes, shows them,
 * and lets go of the memory when it goes away. Never leaves a broken-image icon: it says so in words.
 * With `zoomable` the picture is a button that opens it at full size (the same bytes, not fetched twice).
 */
export function AuthImage({ path, token, alt, className, zoomable }: { path: string; token?: string; alt: string; className?: string; zoomable?: boolean }) {
  const { t } = useLang()
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    let made: string | null = null
    setUrl(null); setFailed(false); setOpen(false)
    apiBlob(path, token).then((b) => { if (!live) return; made = URL.createObjectURL(b); setUrl(made) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [path, token])
  if (failed) return <span className="photo__missing">Picture not available</span>
  if (!url) return <span className="photo__missing" role="status">Loading picture…</span>
  if (!zoomable) return <img className={className ?? 'photo'} src={url} alt={alt} />
  return (
    <>
      <button type="button" className="photo__open" aria-haspopup="dialog" aria-label={`${t('viewer.open')}: ${alt}`} onClick={() => setOpen(true)}>
        <img className={className ?? 'photo'} src={url} alt="" />
      </button>
      {open && <PhotoViewer src={url} alt={alt} onClose={() => setOpen(false)} />}
    </>
  )
}
