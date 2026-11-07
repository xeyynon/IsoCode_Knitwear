/**
 * Where the "new version is ready" bar goes while a screen has a bottom ActionBar.
 *
 * Both are pinned to the bottom of the screen. The new-version bar appears exactly when a send has cleared the form, which
 * is also when the ActionBar shows "Saved on the phone": drawn separately they would sit on top of each other and hide the
 * saved line (UI/UX plan, slice 1.1). So an ActionBar publishes a slot, a small element inside itself, and the banner draws
 * itself into that slot instead of at the foot of the page. With no ActionBar there is no slot and nothing changes.
 *
 * Kept as a tiny external store, not React context, because the banner is mounted once at the top of the app, outside the
 * screens, and the slot appears and disappears as screens come and go.
 */
let slot: HTMLElement | null = null
const listeners = new Set<() => void>()

export function setBottomSlot(el: HTMLElement | null): void {
  if (slot === el) return
  slot = el
  for (const l of listeners) l()
}
export const getBottomSlot = (): HTMLElement | null => slot
export function subscribeBottomSlot(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
