// Errors that are safe to show a caller. Anything else becomes a plain 500 with no
// detail (no stack, file path or SQL), logged on the server only.
export class AppError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503, readonly code: string, message: string) {
    super(message)
  }
}
export const badRequest = (message: string) => new AppError(400, 'bad_request', message)
export const forbidden = (message = 'Not allowed') => new AppError(403, 'forbidden', message)
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message)

// A value the database refuses to store (text with a zero character, a number that does not fit, a malformed id, a date out of range)
// is the caller's mistake, not a server fault. Services check what they know; this is the net under them, so that something they
// did not think of is still a plain 400 and never a 500 that leaks nothing but also tells the person nothing.
const DATA_ERRORS = new Set(['22P02', '22003', '22007', '22008', '22001', '22021', '22P05', '22023', '22009', '22P03'])
export function clientFault(e: unknown): AppError | null {
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' && DATA_ERRORS.has(code)
    ? new AppError(400, 'bad_request', 'Part of what you sent is not valid. Check it and try again.')
    : null
}

// Two requests that create the same thing at the same moment can both pass a "does it exist?" check; the second then meets the
// database's unique rule (SQLSTATE 23505). That is the same plain 409 the check gives, never a 500. The services map their own
// inserts with orDuplicate() so the message is exactly the check's; duplicateFault() is the net under any other insert and
// speaks only of the thing, never of the constraint, table or SQL (the constraint name is the only thing used, to pick words).
export const isUniqueViolation = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === '23505'

const DUPLICATE_WORDS: Record<string, string> = {
  account_phone_key: 'That phone number already has an account',
  account_email_key: 'That email already has an account',
  account_email_lower_key: 'That email already has an account',
  orders_buyer_id_po_style_colour_key: 'That order already exists for this buyer',
  unit_name_lower_key: 'A unit with that name already exists',
  tna_template_name_lower_key: 'A template with that name already exists',
}
export function duplicateFault(e: unknown): AppError | null {
  if (!isUniqueViolation(e)) return null
  const constraint = (e as { constraint?: unknown }).constraint
  const words = typeof constraint === 'string' ? DUPLICATE_WORDS[constraint] : undefined
  return new AppError(409, 'duplicate', words ?? 'That already exists. Refresh the page and check.')
}

/** Run an insert or update; if the database's unique rule refuses it, throw `duplicate` (the check's own 409) instead. */
export async function orDuplicate<T>(work: () => Promise<T>, duplicate: AppError): Promise<T> {
  try { return await work() } catch (e) { throw isUniqueViolation(e) ? duplicate : e }
}
