/** Joins class names, skipping anything that is not a string (a false from `cond && 'x'`, undefined, ''). The atoms use it so a page never builds a class list by hand. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ')
}
