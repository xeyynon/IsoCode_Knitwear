/**
 * Where focus goes after a key in a menu, wrapping at both ends (the top bar guide, section 7). Pure, so it is a table in a test.
 * `current` is the index of the focused item (-1 when none is), `count` how many items there are. null means "not a menu key": the caller
 * leaves the key alone.
 */
export function nextMenuIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowDown': return current < 0 ? 0 : (current + 1) % count
    case 'ArrowUp': return current < 0 ? count - 1 : (current - 1 + count) % count
    case 'Home': return 0
    case 'End': return count - 1
    default: return null
  }
}
