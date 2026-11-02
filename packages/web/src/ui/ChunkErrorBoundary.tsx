import { Component, type ReactNode } from 'react'
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
    return (
      <div className="card" role="alert">
        <h1>This screen did not load</h1>
        <p>The app may have been updated. Reload to get the latest version.</p>
        <button className="btn btn--primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
