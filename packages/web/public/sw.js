/* Keeps the app itself available with no signal. It never touches the API: updates are kept
 * by the app's own queue, not by this file.
 *
 * - install: store the page and every script and stylesheet listed in precache.json
 * - pages (navigations): network first, so a new release is picked up; the stored page when offline
 * - /assets/*: cache first (the file names carry a hash, so a stored file is never stale)
 * - /icons/*, the manifest and /theme-init.js (it applies the saved theme before the first paint): from the stored copy when there is one (the cache is this build's own, so it is never stale either)
 * - the API and other sites: not handled here
 *
 * A new version waits (no automatic skipWaiting): swapping files under a screen that is still
 * open would break its lazy chunks. It takes over when every tab is closed, or when the person
 * presses Reload on the app's "new version is ready" banner, which posts {type: 'SKIP_WAITING'}
 * (src/ui/swUpdateStore.ts); the page then reloads once.
 *
 * The build (vite.config.ts) rewrites CACHE with a hash of the build's files, so every release
 * ships different bytes: the browser installs it, precaches the new screens, and activate
 * deletes the previous release's cache.
 */
const CACHE = 'app-shell-v2'

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    const urls = ['/']
    try {
      const list = await (await fetch('/precache.json', { cache: 'no-store' })).json()
      for (const f of list) urls.push('/' + f)
    } catch { /* offline install: the page itself is still cached below */ }
    // One failed file must not stop the others being kept.
    await Promise.allSettled(urls.map((u) => cache.add(u)))
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

// Only the banner's Reload button sends this; nothing else ever skips the wait.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req)
        if (fresh.ok) (await caches.open(CACHE)).put('/', fresh.clone())
        return fresh
      } catch {
        return (await caches.match('/', { ignoreVary: true })) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest' || url.pathname === '/theme-init.js') {
    event.respondWith((async () => {
      // ignoreVary: the server sends `Vary: Origin` and module scripts carry an Origin header that our
      // own precache request did not, so a strict match would miss. Safe here: the name has a content hash.
      const hit = await caches.match(req, { ignoreVary: true })
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
      return res
    })())
  }
})
