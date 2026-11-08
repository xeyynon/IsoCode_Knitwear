import { Component, type ReactNode } from 'react'
import { useLang } from '../i18n'
import { Button } from './atoms/Button'
import { Card } from './atoms/Card'
import { isChunkError, shouldReload } from './chunkReload'

const KEY = 'orders.chunkReloadAt'

/**
 * Wraps lazy screens. After a deploy an open tab can ask for files that no longer exist.
 * A chunk error reloads the page once (never in a loop); anything else, or a second
 * failure, shows a plain card with a Reload button instead of a blank screen.
 */
export class ChunkErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  override componentDidCatch(error: unknown) {
    if (!isChunkError(error)) return
    try {
      const last = Number(window.sessionStorage.getItem(KEY)) || null
      if (shouldReload(last, Date.now())) {
        window.sessionStorage.setItem(KEY, String(Date.now()))
        window.location.reload()
      }
    } catch { /* no sessionStorage: never reload automatically, just show the card */ }
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return <FailedCard />
  }
}

/** A function component so the card can follow the language switch (a class cannot use the hook). */
function FailedCard() {
  const { t } = useLang()
  return (
    <Card as="div" role="alert">
      <h1>{t('chunk.title')}</h1>
      <p>{t('chunk.body')}</p>
      <Button variant="primary" onClick={() => window.location.reload()}>{t('chunk.reload')}</Button>
    </Card>
  )
}
