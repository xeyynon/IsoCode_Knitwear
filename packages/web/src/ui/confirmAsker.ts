/**
 * The "ask, then await the answer" part of the confirmation dialog, with no React in it so a
 * test can run it. One question is open at a time. A second question while one is open settles
 * the first as "no", so a caller never waits for ever.
 */
export interface ConfirmRequest {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  /** A step that cannot be undone or that locks someone out: the cancel button starts focused and the confirm button is plain, never red (red means order status). */
  destructive?: boolean
}

export interface Asker<R> {
  ask(request: R): Promise<boolean>
  answer(ok: boolean): void
  /** Settle any open question as "no" (the screen went away). */
  cancel(): void
}

export function createAsker<R>(onChange: (open: R | null) => void): Asker<R> {
  let open: { resolve: (ok: boolean) => void } | null = null
  const settle = (ok: boolean) => { const o = open; open = null; o?.resolve(ok) }
  return {
    ask(request) {
      settle(false)
      return new Promise<boolean>((resolve) => { open = { resolve }; onChange(request) })
    },
    answer(ok) {
      if (!open) return
      onChange(null)
      settle(ok)
    },
    cancel() {
      if (!open) return
      onChange(null)
      settle(false)
    },
  }
}
