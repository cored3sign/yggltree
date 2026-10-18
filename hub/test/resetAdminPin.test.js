// The npm run reset-admin-pin command, with a fake fetch in place of a hub.
import { describe, it, expect, afterEach } from 'vitest'
import { runResetAdminPin } from '../src/resetAdminPin.js'
import { createResetToken, RESET_HEADER } from '../src/adminPin.js'
import { createFixtures } from './helpers.js'

const fx = createFixtures()
afterEach(() => fx.cleanup())

function harness({ answer = 'y', response, throwOnFetch = false } = {}) {
  const lines = []
  const errors = []
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    if (throwOnFetch) throw new TypeError('fetch failed')
    return response
  }
  return {
    lines,
    errors,
    calls,
    run: (argv, dataDir) =>
      runResetAdminPin({
        argv: [...argv, '--data', dataDir],
        env: {},
        fetchImpl,
        ask: async () => answer,
        out: (l) => lines.push(l),
        fail: (l) => errors.push(l),
      }),
  }
}

const ok = (admins) => ({ status: 200, json: async () => ({ ok: true, admins }) })

describe('npm run reset-admin-pin', () => {
  it('says to start Yggltree first when there is no reset token', async () => {
    const h = harness({ response: ok([]) })
    const code = await h.run(['--yes'], await fx.tmpDir())
    expect(code).toBe(1)
    expect(h.errors.join('\n')).toMatch(/hasn't started/)
    expect(h.calls).toHaveLength(0)
  })

  it('clears the PINs with the token, when asked and confirmed', async () => {
    const dir = await fx.tmpDir()
    const token = await createResetToken(dir)
    const h = harness({ answer: 'yes', response: ok(['Alex', 'Pat']) })
    const code = await h.run([], dir)
    expect(code).toBe(0)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].url).toBe('http://127.0.0.1:8787/api/admin/reset-pin')
    expect(h.calls[0].init.headers[RESET_HEADER]).toBe(token)
    expect(h.calls[0].init.headers['x-family-hub-admin']).toBe('1')
    expect(h.lines.join('\n')).toContain('Cleared the admin PIN for: Alex, Pat.')
  })

  it('changes nothing when the answer is no', async () => {
    const dir = await fx.tmpDir()
    await createResetToken(dir)
    const h = harness({ answer: 'n', response: ok(['Alex']) })
    expect(await h.run([], dir)).toBe(0)
    expect(h.calls).toHaveLength(0)
    expect(h.lines).toContain('Nothing changed.')
  })

  it('skips the question with --yes', async () => {
    const dir = await fx.tmpDir()
    await createResetToken(dir)
    const h = harness({ answer: 'n', response: ok(['Alex']) })
    expect(await h.run(['--yes'], dir)).toBe(0)
    expect(h.calls).toHaveLength(1)
  })

  it('says Yggltree is not running when nothing answers', async () => {
    const dir = await fx.tmpDir()
    await createResetToken(dir)
    const h = harness({ throwOnFetch: true })
    expect(await h.run(['--yes'], dir)).toBe(1)
    expect(h.errors.join('\n')).toMatch(/isn't running/)
  })

  it('reports a refused token', async () => {
    const dir = await fx.tmpDir()
    await createResetToken(dir)
    const h = harness({ response: { status: 403, json: async () => ({ error: 'forbidden' }) } })
    expect(await h.run(['--yes'], dir)).toBe(1)
    expect(h.errors.join('\n')).toMatch(/refused/)
  })

  it('rejects a bad port', async () => {
    const dir = await fx.tmpDir()
    await createResetToken(dir)
    const h = harness({ response: ok([]) })
    expect(await h.run(['--yes', '--port', 'abc'], dir)).toBe(2)
    expect(h.calls).toHaveLength(0)
  })
})
