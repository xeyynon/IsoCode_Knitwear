// Which forms on screen hold input that has not been saved yet. The new-version banner stays
// away while any does. Each form reports under its own name and clears it when it unmounts.
const dirty = new Set<string>()
const listeners = new Set<() => void>()

const emit = () => listeners.forEach((l) => l())

export function setUnsentInput(form: string, hasInput: boolean): void {
  if (dirty.has(form) === hasInput) return
  if (hasInput) dirty.add(form); else dirty.delete(form)
  emit()
}

export function clearUnsentInput(): void {
  if (dirty.size === 0) return
  dirty.clear()
  emit()
}

export const hasUnsentInput = (): boolean => dirty.size > 0

export function subscribeUnsentInput(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
