import { describe, it, expect } from 'vitest'
import { mkdtemp, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  RelayError,
  deleteRelay,
  deployRelay,
  forgetConnection,
  isRelayName,
  loginWithWrangler,
  nameFromAddress,
  readConnection,
  saveConnection,
  verifyToken,
  wranglerAccount,
} from '../src/relayManager.js'

const TOKEN = 'cf_token_1234567890_abcdefghij'
const ACCOUNT = { accountId: 'acc123', accountName: 'Example family' }

function fakeFetch(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })
}

// A fake runner: records each command, and answers with the codes and output given.
function fakeRunner(answers) {
  const calls = []
  const run = async (command, args, opts) => {
    calls.push({ command, args, env: opts.env, cwd: opts.cwd, timeoutMs: opts.timeoutMs })
    return answers.shift() ?? { code: 0, output: '' }
  }
  return { run, calls }
}

const whoami = (accounts = [{ id: 'acc123', name: 'Example family' }]) =>
  ({ code: 0, output: JSON.stringify({ loggedIn: true, authType: 'OAuth Token', accounts }, null, 2) })

describe('relay names and addresses', () => {
  it('accepts names a family would choose, and rejects the rest', () => {
    expect(isRelayName('example-family-relay')).toBe(true)
    expect(isRelayName('ab')).toBe(false)
    expect(isRelayName('Example')).toBe(false)
    expect(isRelayName('-example')).toBe(false)
    expect(isRelayName('example_relay')).toBe(false)
    expect(isRelayName('a'.repeat(64))).toBe(false)
  })

  it('takes the name from an address, and gives nothing for other addresses', () => {
    expect(nameFromAddress('https://example-family-relay.example.workers.dev/')).toBe('example-family-relay')
    expect(nameFromAddress('https://example.com')).toBe(null)
    expect(nameFromAddress('http://localhost:8787')).toBe(null)
  })

  it('never takes a name that starts with a hyphen from an address', () => {
    expect(nameFromAddress('https://--force.example.workers.dev')).toBe(null)
    expect(nameFromAddress('https://-x.example.workers.dev')).toBe(null)
    expect(nameFromAddress('https://example-.example.workers.dev')).toBe(null)
  })
})

describe('Cloudflare access', () => {
  it('Wrangler’s login is read as the account on this computer', async () => {
    const { run, calls } = fakeRunner([whoami()])
    expect(await wranglerAccount({ relayDir: '/relay', run })).toEqual(ACCOUNT)
    expect(calls[0].args).toEqual(['--no-install', 'wrangler', 'whoami', '--json'])
  })

  it('reports no account when Wrangler is not logged in', async () => {
    const { run } = fakeRunner([{ code: 0, output: JSON.stringify({ loggedIn: false, accounts: [] }) }])
    expect(await wranglerAccount({ relayDir: '/relay', run })).toBe(null)
  })

  it('login opens Cloudflare’s page, waits for it, then reads the account', async () => {
    const { run, calls } = fakeRunner([{ code: 0, output: 'logged in' }, whoami()])
    expect(await loginWithWrangler({ relayDir: '/relay', run })).toEqual(ACCOUNT)
    expect(calls[0].args).toEqual(['--no-install', 'wrangler', 'login'])
    expect(calls[0].timeoutMs).toBeGreaterThan(60000)
  })

  it('login says what to do when the page wasn’t allowed', async () => {
    const { run } = fakeRunner([{ code: 1, output: 'canceled' }])
    await expect(loginWithWrangler({ relayDir: '/relay', run })).rejects.toBeInstanceOf(RelayError)
  })

  it('a pasted token is checked with Cloudflare, which says which account it can deploy to', async () => {
    const account = await verifyToken(TOKEN, fakeFetch(200, { result: [{ id: 'acc123', name: 'Example family' }] }))
    expect(account).toEqual(ACCOUNT)
  })

  it('gives a clear message when Cloudflare refuses a pasted token', async () => {
    await expect(verifyToken(TOKEN, fakeFetch(403, {}))).rejects.toThrow(/didn't accept that token/)
    await expect(verifyToken(TOKEN, fakeFetch(200, { result: [] }))).rejects.toBeInstanceOf(RelayError)
  })
})

describe('the saved connection', () => {
  it('is saved readable only by this computer’s user, and can be forgotten', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'yggltree-cf-'))
    await saveConnection(dir, { token: TOKEN, ...ACCOUNT })
    expect(await readConnection(dir)).toMatchObject({ token: TOKEN, accountId: 'acc123' })
    if (process.platform !== 'win32') expect((await stat(join(dir, 'cloudflare.json'))).mode & 0o777).toBe(0o600)
    await forgetConnection(dir)
    expect(await readConnection(dir)).toBe(null)
  })
})

describe('deploying a relay', () => {
  it('every Wrangler command runs with its usage reports off, even when the environment turns them on', async () => {
    const { run, calls } = fakeRunner([
      { code: 0, output: '' },
      { code: 0, output: 'https://example-family-relay.example.workers.dev' },
    ])
    await deployRelay({ name: 'example-family-relay', accountId: 'acc123', relayDir: '/relay', run, env: { WRANGLER_SEND_METRICS: 'true' } })
    expect(calls[1].env.WRANGLER_SEND_METRICS).toBe('false')
    const login = fakeRunner([whoami()])
    await wranglerAccount({ relayDir: '/relay', run: login.run })
    expect(login.calls[0].env.WRANGLER_SEND_METRICS).toBe('false')
  })

  it('builds the app, deploys under the chosen name, and returns the address', async () => {
    const { run, calls } = fakeRunner([
      { code: 0, output: 'built' },
      { code: 0, output: 'Deployed example-family-relay\n  https://example-family-relay.example.workers.dev\n' },
    ])
    const url = await deployRelay({ name: 'example-family-relay', token: TOKEN, accountId: 'acc123', relayDir: '/relay', run })
    expect(url).toBe('https://example-family-relay.example.workers.dev')
    expect(calls[0].args).toEqual(['run', 'build:app'])
    expect(calls[1].args).toEqual(['--no-install', 'wrangler', 'deploy', '--name=example-family-relay'])
    expect(calls[1].env.CLOUDFLARE_API_TOKEN).toBe(TOKEN)
    expect(calls[1].args.join(' ')).not.toContain(TOKEN)
  })

  it('with Wrangler’s login, passes the account and no token', async () => {
    const { run, calls } = fakeRunner([
      { code: 0, output: '' },
      { code: 0, output: 'https://example-family-relay.example.workers.dev' },
    ])
    await deployRelay({ name: 'example-family-relay', accountId: 'acc123', relayDir: '/relay', run })
    expect(calls[1].env.CLOUDFLARE_ACCOUNT_ID).toBe('acc123')
    expect(calls[1].args.join(' ')).not.toContain(TOKEN)
  })

  it('never shows the token in an error', async () => {
    const { run } = fakeRunner([{ code: 0, output: '' }, { code: 1, output: `failed with ${TOKEN}` }])
    const err = await deployRelay({ name: 'example-family-relay', token: TOKEN, accountId: 'acc123', relayDir: '/relay', run }).catch((e) => e)
    expect(err).toBeInstanceOf(RelayError)
    expect(err.message).not.toContain(TOKEN)
  })

  it('refuses a bad name before running anything', async () => {
    const { run, calls } = fakeRunner([])
    await expect(deployRelay({ name: 'Bad Name', accountId: 'acc123', relayDir: '/relay', run })).rejects.toBeInstanceOf(RelayError)
    expect(calls).toHaveLength(0)
  })
})

describe('deleting a relay', () => {
  it('deletes the worker named in the address, and everything it stored', async () => {
    const { run, calls } = fakeRunner([{ code: 0, output: 'deleted' }])
    await deleteRelay({ address: 'https://old-relay.example.workers.dev', token: TOKEN, accountId: 'acc123', relayDir: '/relay', run })
    expect(calls[0].args).toEqual(['--no-install', 'wrangler', 'delete', '--name=old-relay', '--force'])
  })

  it('counts a relay that is already gone as deleted', async () => {
    const { run } = fakeRunner([{ code: 1, output: 'Worker not found (10007)' }])
    await expect(deleteRelay({ address: 'https://old-relay.example.workers.dev', accountId: 'acc123', relayDir: '/relay', run })).resolves.toEqual({ name: 'old-relay' })
  })

  it('refuses an address this app did not set up', async () => {
    const { run, calls } = fakeRunner([])
    await expect(deleteRelay({ address: 'https://example.com', accountId: 'acc123', relayDir: '/relay', run })).rejects.toBeInstanceOf(RelayError)
    expect(calls).toHaveLength(0)
  })

  it('passes the name as one value, so it can never be read as an option', async () => {
    const { run, calls } = fakeRunner([{ code: 0, output: 'deleted' }])
    await deleteRelay({ address: 'https://old-relay.example.workers.dev', accountId: 'acc123', relayDir: '/relay', run })
    expect(calls[0].args).toContain('--name=old-relay')
    expect(calls[0].args).not.toContain('--name')
  })

  it('refuses an address whose name looks like an option, before running anything', async () => {
    const { run, calls } = fakeRunner([])
    await expect(deleteRelay({ address: 'https://--force.example.workers.dev', accountId: 'acc123', relayDir: '/relay', run })).rejects.toBeInstanceOf(RelayError)
    expect(calls).toHaveLength(0)
  })
})
