// Errors that are safe to show a caller. Anything else becomes a plain 500 with no
// detail (no stack, file path or SQL), logged on the server only.
export class AppError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503, readonly code: string, message: string) {
    super(message)
  }
}
export const badRequest = (message: string) => new AppError(400, 'bad_request', message)
export const forbidden = (message = 'Not allowed') => new AppError(403, 'forbidden', message)
export const notFound = (message = 'Not found') => new AppError(404, 'not_found', message)
