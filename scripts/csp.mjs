// The Content-Security-Policy of the app, written once. The hosted build sends it as a response header (scripts/vercel_build.mjs),
// and `vite preview` sends the same one (packages/web/vite.config.ts), so every local browser check (npm run e2e, the screen walks)
// runs with the policy ENFORCED, exactly as the live app does.
//
// What it allows, and why each line is not wider:
//   script-src 'self'     only the app's own bundle: no inline script, no eval, no third-party script
//   style-src 'unsafe-inline'  React writes style="width: 38%" on progress bars, and index.html holds the first-paint ring's small style
//   img-src blob: data:   a photo is shown from a blob made in the browser; icons and the favicon are files of the app
//   connect-src 'self'    the API is on the same address as the app (VITE_API_BASE=same-origin on the hosted build)
//   frame-ancestors none  nobody may put the app inside their page (the older X-Frame-Options header says the same)
//   object-src none, base-uri self, form-action self   close the remaining injection routes
// Not set: report-uri (nothing collects reports).

/**
 * @param {{ localApi?: boolean }} [options]  localApi: also allow the API on localhost, for `vite preview` and the browser tests,
 *   where the app (port 4173) and the demo API (another port) are different addresses. Never used for the hosted build.
 * @returns {string}
 */
export function csp(options = {}) {
  const connect = ["'self'", ...(options.localApi ? ['http://127.0.0.1:*', 'http://localhost:*'] : [])]
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}
