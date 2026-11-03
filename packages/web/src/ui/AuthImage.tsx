import { useEffect, useState } from 'react'
import { apiBlob } from '../api/session'

/**
 * A picture that needs the sign-in header (or a buyer link) to load. It fetches the bytes, shows them,
 * and lets go of the memory when it goes away. Never leaves a broken-image icon: it says so in words.
 */
export function AuthImage({ path, token, alt, className }: { path: string; token?: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    let made: string | null = null
    setUrl(null); setFailed(false)
    apiBlob(path, token).then((b) => { if (!live) return; made = URL.createObjectURL(b); setUrl(made) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [path, token])
  if (failed) return <span className="photo__missing">Picture not available</span>
  if (!url) return <span className="photo__missing" role="status">Loading picture…</span>
  return <img className={className ?? 'photo'} src={url} alt={alt} />
}
