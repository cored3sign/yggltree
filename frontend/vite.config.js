import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// The app's version number, from the root package.json. It's baked into each build next to the build
// stamp, so the Help page can show both on every device.
const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

// Force-update prompt on a stale PWA build: a build-time version
// stamp, generated once per `vite build` and baked into the bundle as
// __APP_BUILD_VERSION__ (read by UpdatePrompt.vue), while the exact same value is
// also emitted as dist/version.json -- a plain static file the running app
// re-fetches (cache: 'no-store', so a cached copy never hides a new build)
// to learn what's *actually* deployed right now.
// Comparing "baked into the JS I already loaded" against "freshly fetched
// from the server" is the whole mechanism -- no service-worker lifecycle
// involved.
// A timestamp is enough here (not a content hash): the only thing that
// matters is "did a build happen since I loaded", not what changed.
function buildVersionPlugin() {
  const version = String(Date.now())
  return {
    name: 'build-version',
    config() {
      return { define: { __APP_BUILD_VERSION__: JSON.stringify(version), __APP_VERSION__: JSON.stringify(APP_VERSION) } }
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version }),
      })
    },
    // Dev server never runs generateBundle (that's a build-only hook), but
    // the app still fetches /version.json on every interaction -- serve the
    // same shape here so dev doesn't 404 or show a spurious update prompt.
    // The dev version is fixed for the life of the dev server process
    // (matches the define() above), which is exactly "no update available"
    // -- the real check is only meaningful across separate `vite build`s.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/version.json') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ version }))
          return
        }
        next()
      })
    },
  }
}

// Dev proxy -> local hub. A request from another machine (`vite --host`)
// still reaches the hub from 127.0.0.1, so it is tagged with
// X-Forwarded-For: the hub's admin guard then refuses it.
// The desktop's own browser (loopback) is left untagged and stays admin.
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function markRemoteClients(proxy) {
  const tag = (proxyReq, req) => {
    const address = req.socket?.remoteAddress
    if (!LOOPBACK.has(address)) proxyReq.setHeader('x-forwarded-for', address || 'unknown')
  }
  proxy.on('proxyReq', tag)
  proxy.on('proxyReqWs', tag)
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), buildVersionPlugin()],
  // Dev only: the app on Vite's port talks to a local hub (npm run dev:hub)
  // on 8787. The hub's admin guard treats a request as the hub machine's
  // own browser only with a loopback Host and no proxy headers, so the
  // proxy keeps the browser's Host
  // (changeOrigin: false -- otherwise every proxied request would arrive
  // as Host: localhost:8787) and adds no blanket X-Forwarded-* (xfwd:
  // false); markRemoteClients tags only requests from other machines.
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: false, xfwd: false, configure: markRemoteClients },
      '/sync': { target: 'ws://localhost:8787', ws: true, changeOrigin: false, xfwd: false, configure: markRemoteClients },
    },
  },
  // Unit tests cover src/data/ only -- pure JS over Yjs docs, no DOM needed.
  test: { environment: 'node', include: ['src/**/*.test.js'], setupFiles: ['test-setup/quietLocalStorageWarning.js'] },
})
