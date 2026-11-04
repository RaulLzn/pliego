import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

function publicFiles(dir, root = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? publicFiles(path, root) : [relative(root, path).replaceAll('\\', '/')]
  })
}

// Service worker de la PWA: precarga todo el build para funcionar sin conexión.
function serviceWorker() {
  return {
    name: 'pliego-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', ...Object.keys(bundle), ...publicFiles('public')].sort()
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12)
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const CACHE = 'pliego-${version}'
const FILES = ${JSON.stringify(files)}
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./', { ignoreSearch: true })))
    return
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)))
})
`,
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    target: 'es2019',
    outDir: mode === 'web' ? 'dist-web' : 'dist',
  },
  plugins: mode === 'web' ? [serviceWorker()] : [],
}))
