// The relay link must never reach the router: it reads the URL into
// history.state and its own location when createWebHistory() runs, and
// writes that back on the first accepted navigation.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const KEY = 'A'.repeat(43)

function installBrowserShim(href, initialState = null) {
  const url = new URL(href)
  let state = initialState
  const location = {
    get pathname() { return url.pathname },
    get search() { return url.search },
    get hash() { return url.hash },
    get host() { return url.host },
    get protocol() { return url.protocol },
    get href() { return url.href },
    replace() {},
  }
  const history = {
    get state() { return state },
    replaceState(s, _t, u) {
      state = s
      const n = new URL(u, url)
      url.hash = n.hash
      url.pathname = n.pathname
      url.search = n.search
    },
    pushState(s, t, u) { this.replaceState(s, t, u) },
  }
  vi.stubGlobal('location', location)
  vi.stubGlobal('history', history)
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('addEventListener', () => {})
  vi.stubGlobal('removeEventListener', () => {})
  vi.stubGlobal('document', { querySelector: () => null, createElement: () => ({}) })
  return { url, history }
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('pairingBoot', () => {
  it('strips the relay link before the router is created: no relay= in the address bar, history.state or the router', async () => {
    // A router state from an earlier load that still holds the link.
    const shim = installBrowserShim(`http://192.0.2.20:8787/#relay=1.${KEY}`, { current: `/#relay=1.${KEY}`, back: null })
    await import('./pairingBoot.js')
    const { createWebHistory } = await import('vue-router')
    const routerHistory = createWebHistory()
    expect(JSON.stringify(shim.history.state)).not.toContain('relay=')
    expect(JSON.stringify(routerHistory.state)).not.toContain('relay=')
    routerHistory.replace(routerHistory.location) // what an accepted first navigation does
    expect(shim.url.href).not.toContain('relay=')
    expect(routerHistory.location).not.toContain('relay=')
    expect(JSON.stringify(shim.history.state)).not.toContain('relay=')
  })

  it('control: a router created BEFORE the strip keeps and rewrites the link', async () => {
    const shim = installBrowserShim(`http://192.0.2.20:8787/#relay=1.${KEY}`)
    const { createWebHistory } = await import('vue-router')
    const routerHistory = createWebHistory()
    await import('./pairingBoot.js')
    routerHistory.replace(routerHistory.location)
    expect(shim.url.href).toContain('relay=')
  })

  it('main.js imports ./pairingBoot before anything else', () => {
    // Windows checks files out with CRLF line endings, so split on either.
    const src = readFileSync(fileURLToPath(new URL('./main.js', import.meta.url)), 'utf8')
    const firstImport = src.split(/\r?\n/).find((line) => line.startsWith('import '))
    expect(firstImport).toBe("import './pairingBoot'")
  })
})
