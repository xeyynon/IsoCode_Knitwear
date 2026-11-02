/**
 * Hand-pasted environment values are the commonest deployment failure: a stray ">", a
 * missing scheme, a trailing slash, quotes, or an invisible newline (Node throws when a
 * header value contains one, and then every route returns 500). Clean before use.
 */
export function cleanOrigin(raw: string): string | null {
  const s = raw.replace(/[\s"'<>`]/g, '').replace(/\/+$/, '')
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s)) return null
  return s.toLowerCase()
}

/** A comma-separated list; invalid entries are dropped (and reported so the caller can log them). */
export function parseOrigins(raw: string | undefined): { origins: string[]; dropped: string[] } {
  const origins: string[] = []
  const dropped: string[] = []
  for (const part of (raw ?? '').split(',')) {
    if (!part.trim()) continue
    const o = cleanOrigin(part)
    if (o) origins.push(o); else dropped.push(part.trim())
  }
  return { origins, dropped }
}
