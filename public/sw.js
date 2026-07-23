/* Minimal offline shell — network-first for API, cache-first for static assets */
const CACHE = 'wtf-shell-v1'
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname.startsWith('/api/')) return
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone()
        void caches.open(CACHE).then((c) => c.put(event.request, copy))
        return res
      })
      .catch(() => caches.match(event.request)),
  )
})
