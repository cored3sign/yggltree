// Admin routes against a real in-process hub: the admin guard on every
// admin route, hub info, the setup claim, and request-body handling. The
// hub serves only this computer, so nothing here is reachable from another
// device.
import { describe, it, expect, afterEach } from 'vitest'
import { createFixtures, waitFor, onceSynced, httpCall, adminCall, ADMIN_HEADERS } from './helpers.js'

const fx = createFixtures()
afterEach(() => fx.cleanup())

const hubWith = (opts = {}) => fx.hub(opts)

function hasCorsHeaders(res) {
  return Object.keys(res.headers).some((k) => k.startsWith('access-control-'))
}

describe('admin guard', () => {
  const ROUTES = [
    ['GET', '/api/hub/info', undefined],
    ['POST', '/api/hub/claim', { claimId: 'c1' }],
    ['POST', '/api/hub/restore', { format: 'x' }],
  ]

  it('every admin route returns 403 (no CORS headers) for a LAN Host or a proxied request', async () => {
    const hub = await hubWith()
    const tokenBefore = hub.state.room.token
    for (const [method, path, body] of ROUTES) {
      for (const extra of [{ host: `192.0.2.20:${hub.port}` }, { 'x-forwarded-for': '192.0.2.50' }, { host: `desktop.example.com` }, { 'tailscale-user-login': 'someone@example.com' }]) {
        const res = await httpCall(hub.port, { method, path, headers: { ...ADMIN_HEADERS, ...extra }, body })
        expect(res.status, `${method} ${path} ${JSON.stringify(extra)}`).toBe(403)
        expect(res.json).toEqual({ error: 'forbidden' })
        expect(hasCorsHeaders(res)).toBe(false)
        expect(res.text).not.toContain(tokenBefore)
      }
    }
    expect(hub.state.room.token).toBe(tokenBefore)
    expect(hub.state.room.claim).toBe(null)
  })

  it('mutations need X-Family-Hub-Admin, a JSON content type, and a loopback Origin if any', async () => {
    const hub = await hubWith()
    const tokenBefore = hub.state.room.token
    for (const [method, path, body] of ROUTES.filter(([m]) => m !== 'GET')) {
      const variants = [
        { 'content-type': 'application/json' },
        { 'x-family-hub-admin': '1', 'content-type': 'text/plain' },
        { 'x-family-hub-admin': '1' },
        { ...ADMIN_HEADERS, origin: 'http://evil.example' },
        { ...ADMIN_HEADERS, origin: 'http://192.0.2.20:8787' },
      ]
      for (const headers of variants) {
        const res = await httpCall(hub.port, { method, path, headers, body })
        expect(res.status, `${method} ${path} ${JSON.stringify(headers)}`).toBe(403)
        expect(hasCorsHeaders(res)).toBe(false)
      }
    }
    expect(hub.state.room.token).toBe(tokenBefore)
    expect(hub.state.room.claim).toBe(null)
  })

  it('a CORS preflight to an admin route is never approved', async () => {
    const hub = await hubWith()
    const res = await httpCall(hub.port, {
      method: 'OPTIONS',
      path: '/api/hub/restore',
      headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(hasCorsHeaders(res)).toBe(false)
  })

  it('a loopback Origin and [::1] / 127.0.0.1 Hosts are allowed', async () => {
    const hub = await hubWith()
    const res = await adminCall(hub, 'POST', '/api/hub/claim', { claimId: 'c1' }, { origin: `http://localhost:${hub.port}`, host: `127.0.0.1:${hub.port}` })
    expect(res.status).toBe(200)
    const info = await httpCall(hub.port, { path: '/api/hub/info', headers: { host: `[::1]:${hub.port}` } })
    expect(info.status).toBe(200)
  })
})

describe('hub info', () => {
  it('returns the info shape for this computer', async () => {
    const hub = await hubWith()
    const a = fx.provider(hub, { docName: 'main' })
    const aAssets = fx.provider(hub, { docName: 'assets' })
    await Promise.all([a, aAssets].map(onceSynced))

    const res = await httpCall(hub.port, { path: '/api/hub/info' })
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.json).toEqual({
      roomId: hub.state.room.id,
      token: hub.state.room.token,
      familyExists: false,
      port: hub.port,
      dataDir: expect.any(String),
      appVersion: expect.any(String),
      devices: 1,
    })
  })

  it('wrong method on an admin route is 405', async () => {
    const hub = await hubWith()
    expect((await adminCall(hub, 'POST', '/api/hub/info', {})).status).toBe(405)
    expect((await httpCall(hub.port, { path: '/api/hub/claim' })).status).toBe(405)
  })

  it('the pairing, token-rotation and public-URL routes are gone', async () => {
    const hub = await hubWith()
    const tokenBefore = hub.state.room.token
    for (const [method, path, body] of [
      ['POST', '/api/pair', { code: 'A'.repeat(22) }],
      ['POST', '/api/hub/pairing-code', {}],
      ['POST', '/api/hub/rotate-token', {}],
      ['PUT', '/api/hub/public-url', { url: null }],
    ]) {
      const res = await adminCall(hub, method, path, body)
      expect(res.status, `${method} ${path}`).toBe(404)
      expect(res.json).toEqual({ error: 'not-found' })
    }
    expect(hub.state.room.token).toBe(tokenBefore)
  })
})

describe('setup claim', () => {
  it('two parallel claims: exactly one 200 and one 409; the winner may repeat its claim', async () => {
    const hub = await hubWith()
    const [r1, r2] = await Promise.all([
      adminCall(hub, 'POST', '/api/hub/claim', { claimId: 'chrome' }),
      adminCall(hub, 'POST', '/api/hub/claim', { claimId: 'safari' }),
    ])
    expect([r1.status, r2.status].sort()).toEqual([200, 409])
    const winner = r1.status === 200 ? 'chrome' : 'safari'
    expect(hub.state.room.claim.id).toBe(winner)
    expect((r1.status === 409 ? r1 : r2).json).toEqual({ error: 'conflict' })
    const again = await adminCall(hub, 'POST', '/api/hub/claim', { claimId: winner })
    expect(again.status).toBe(200)
    expect(again.json).toEqual({ ok: true })
  })

  it('a claim after a client pushed a family returns 409', async () => {
    const hub = await hubWith()
    const p = fx.provider(hub)
    await onceSynced(p)
    p.doc.getMap('meta').set('schema_version', 1)
    await waitFor(() => hub.familyExists())
    const res = await adminCall(hub, 'POST', '/api/hub/claim', { claimId: 'late' })
    expect(res.status).toBe(409)
    expect(hub.state.room.claim).toBe(null)
  })

  it('a stale claim (older than 5 minutes) on an empty room can be taken over', async () => {
    let t = 1_700_000_000_000
    const hub = await hubWith({ now: () => t })
    expect((await adminCall(hub, 'POST', '/api/hub/claim', { claimId: 'first' })).status).toBe(200)
    t += 60_000
    expect((await adminCall(hub, 'POST', '/api/hub/claim', { claimId: 'second' })).status).toBe(409)
    t += 5 * 60_000
    expect((await adminCall(hub, 'POST', '/api/hub/claim', { claimId: 'second' })).status).toBe(200)
  })

  it('rejects a missing or invalid claimId with 400', async () => {
    const hub = await hubWith()
    expect((await adminCall(hub, 'POST', '/api/hub/claim', {})).status).toBe(400)
    expect((await adminCall(hub, 'POST', '/api/hub/claim', { claimId: '' })).status).toBe(400)
    expect((await adminCall(hub, 'POST', '/api/hub/claim', { claimId: 'x'.repeat(201) })).status).toBe(400)
    expect(hub.state.room.claim).toBe(null)
  })
})

describe('request bodies', () => {
  it('invalid JSON is 400 on admin routes', async () => {
    const hub = await hubWith()
    expect((await adminCall(hub, 'POST', '/api/hub/claim', '{"claimId":')).status).toBe(400)
  })

  // Windows resets the connection when the server answers an oversized body before the client has finished
  // sending it, so the 413 never reaches the client there. The body is still refused; only the reply is lost.
  it.skipIf(process.platform === 'win32')('a body over 64 KiB is 413 on admin routes', async () => {
    const hub = await hubWith()
    const big = JSON.stringify({ claimId: 'c', pad: 'x'.repeat(70 * 1024) })
    const res = await adminCall(hub, 'POST', '/api/hub/claim', big)
    expect(res.status).toBe(413)
    expect(res.json).toEqual({ error: 'too-large' })
    expect(hub.state.room.claim).toBe(null)
  })

  it('unknown /api paths are still 404 JSON', async () => {
    const hub = await hubWith()
    const res = await adminCall(hub, 'POST', '/api/hub/nope', {})
    expect(res.status).toBe(404)
    expect(res.json).toEqual({ error: 'not-found' })
  })
})
