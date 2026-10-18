// Where Wrangler runs: from source (npx) or inside the desktop app (bundled Wrangler, read-only
// relay source copied under the data folder). Updating a relay only deploys; it never deletes.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, readFile, writeFile, lstat, readlink } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  wranglerInvocation,
  relayWorkDir,
  deployRelay,
  updateRelay,
  RelayError,
} from '../src/relayManager.js'
import { createFixtures } from './helpers.js'

const fx = createFixtures()
afterEach(() => fx.cleanup())

const ADDRESS_OUTPUT = 'Deployed the-relay triggers\n  https://the-relay.acct-sub.workers.dev\n'

function fakeRun(output = ADDRESS_OUTPUT, code = 0) {
  const calls = []
  const run = async (command, args, opts = {}) => {
    calls.push({ command, args, cwd: opts.cwd, env: opts.env })
    return { code, output }
  }
  return { calls, run }
}

async function fakeRelaySource() {
  const src = await fx.tmpDir('relay-src-')
  await mkdir(join(src, 'src'), { recursive: true })
  await mkdir(join(src, 'public'), { recursive: true })
  await mkdir(join(src, 'node_modules'), { recursive: true })
  await writeFile(join(src, 'wrangler.jsonc'), '{}')
  await writeFile(join(src, 'package.json'), '{"name":"relay"}')
  await writeFile(join(src, 'src', 'index.js'), 'export default {}')
  await writeFile(join(src, 'public', 'index.html'), '<!doctype html>')
  return src
}

describe('wranglerInvocation', () => {
  it('runs npx from source', () => {
    expect(wranglerInvocation(['whoami'], {})).toEqual({
      command: 'npx',
      args: ['--no-install', 'wrangler', 'whoami'],
      extraEnv: {},
    })
  })

  it('runs the bundled Wrangler with the app\'s own Node, as Node', () => {
    const inv = wranglerInvocation(['deploy'], { YGGLTREE_WRANGLER_BIN: '/App/relay/node_modules/wrangler/bin/wrangler.js', YGGLTREE_NODE_BIN: '/App/Yggltree' })
    expect(inv).toEqual({
      command: '/App/Yggltree',
      args: ['--require', expect.stringMatching(/wranglerPreload\.cjs$/), '/App/relay/node_modules/wrangler/bin/wrangler.js', 'deploy'],
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('preloads the flag that makes Wrangler read its arguments correctly inside the app', () => {
    const preload = readFileSync(new URL('../src/wranglerPreload.cjs', import.meta.url), 'utf8')
    expect(preload).toContain('process.defaultApp = true')
  })
})

describe('relayWorkDir', () => {
  it('uses the source folder from source', async () => {
    const src = await fakeRelaySource()
    expect(await relayWorkDir({ sourceDir: src, dataDir: '/unused', env: {} })).toBe(src)
  })

  it('copies the relay under the data folder when the app bundles it', async () => {
    const src = await fakeRelaySource()
    const data = await fx.tmpDir('hub-data-')
    const work = await relayWorkDir({ sourceDir: src, dataDir: data, env: { YGGLTREE_RELAY_DIR: src } })
    expect(work).toBe(join(data, 'relay-tools'))
    expect(await readFile(join(work, 'wrangler.jsonc'), 'utf8')).toBe('{}')
    expect(await readFile(join(work, 'public', 'index.html'), 'utf8')).toBe('<!doctype html>')
    expect((await lstat(join(work, 'node_modules'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(work, 'node_modules'))).toBe(join(src, 'node_modules'))
  })
})

describe('deployRelay in the desktop app', () => {
  it('skips the build when the app ships the relay prebuilt, and deploys from the copy', async () => {
    const src = await fakeRelaySource()
    const data = await fx.tmpDir('hub-data-')
    const { calls, run } = fakeRun()
    const env = { YGGLTREE_RELAY_DIR: src, YGGLTREE_RELAY_PREBUILT: '1' }
    const address = await deployRelay({ name: 'the-relay', relayDir: src, dataDir: data, run, env })
    expect(address).toBe('https://the-relay.acct-sub.workers.dev')
    expect(calls.map((c) => c.args.join(' '))).toEqual(['--no-install wrangler deploy --name=the-relay'])
    expect(calls[0].cwd).toBe(join(data, 'relay-tools'))
  })

  it('refuses a name that could be read as an option', async () => {
    const { run } = fakeRun()
    await expect(deployRelay({ name: '--help', run, env: {} })).rejects.toBeInstanceOf(RelayError)
  })
})

describe('updateRelay', () => {
  it('redeploys under the same name and never deletes', async () => {
    const src = await fakeRelaySource()
    const data = await fx.tmpDir('hub-data-')
    const { calls, run } = fakeRun()
    const result = await updateRelay({ name: 'the-relay', relayDir: src, dataDir: data, run, env: { YGGLTREE_RELAY_DIR: src, YGGLTREE_RELAY_PREBUILT: '1' } })
    expect(result).toEqual({ name: 'the-relay', address: 'https://the-relay.acct-sub.workers.dev' })
    expect(calls.some((c) => c.args.includes('delete'))).toBe(false)
  })

  it('says what went wrong when the deploy fails, without the token', async () => {
    const token = 'abcdefghijklmnopqrstuvwxyz123'
    const { run } = fakeRun(`auth failed for token ${token}`, 1)
    const err = await updateRelay({ name: 'the-relay', token, relayDir: '/x', env: { YGGLTREE_RELAY_PREBUILT: '1' }, run }).catch((e) => e)
    expect(err).toBeInstanceOf(RelayError)
    expect(err.message).toMatch(/Cloudflare didn't create the relay/)
    expect(err.message).not.toContain(token)
  })
})
