import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCliArgs, browserCommand, main, portInUseMessage } from '../src/cli.js'
import { createFixtures } from './helpers.js'

const fx = createFixtures()
const children = []
afterEach(async () => {
  while (children.length) {
    const c = children.pop()
    if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL')
  }
  await fx.cleanup()
})

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))

function runCli(args, env = {}) {
  const child = spawn(process.execPath, [CLI, ...args], {
    env: { ...process.env, YGGLTREE_NO_OPEN: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)))
  const waitForOutput = (re, timeout = 5000) =>
    new Promise((resolve, reject) => {
      const start = Date.now()
      const tick = () => {
        const m = re.exec(out)
        if (m) return resolve(m)
        if (Date.now() - start > timeout) return reject(new Error(`timed out waiting for ${re}; output:\n${out}`))
        setTimeout(tick, 20)
      }
      tick()
    })
  return { child, exited, waitForOutput, output: () => out }
}

describe('cli argument parsing', () => {
  it('reads flags and env', () => {
    expect(parseCliArgs(['--port', '9000', '--data', '/d', '--no-open'], {})).toMatchObject({
      port: 9000,
      dataDir: '/d',
      open: false,
    })
    expect(parseCliArgs([], { YGGLTREE_DATA: '/env', YGGLTREE_NO_OPEN: '1' })).toMatchObject({
      port: 8787,
      dataDir: '/env',
      open: false,
    })
    expect(parseCliArgs([], {}).open).toBe(true)
    expect(() => parseCliArgs(['--port', 'abc'], {})).toThrow(/port/)
    expect(() => parseCliArgs(['--bogus'], {})).toThrow()
  })

  it('does not accept the LAN options (--local-only, --https-port, --public-url)', () => {
    for (const flag of ['--local-only', '--https-port', '--public-url']) {
      expect(() => parseCliArgs([flag, '1'], {}), flag).toThrow()
    }
  })

  it('picks the per-platform browser opener', () => {
    expect(browserCommand('darwin', 'http://localhost:8787')).toEqual({ cmd: 'open', args: ['http://localhost:8787'] })
    expect(browserCommand('linux', 'http://localhost:8787')).toEqual({ cmd: 'xdg-open', args: ['http://localhost:8787'] })
    expect(browserCommand('win32', 'http://localhost:8787')).toMatchObject({ cmd: 'cmd', args: ['/c', 'start', '""', 'http://localhost:8787'] })
  })
})

describe('cli process', () => {
  // Windows ends a process on SIGTERM without running its handlers, so a clean shutdown can't be checked there. On
  // Windows the desktop app stops the hub with a message instead, which the desktop tests cover.
  it.skipIf(process.platform === 'win32')('prints the banner, serves, and on SIGTERM closes and releases the lock', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    const distDir = await fx.distFixture()
    const run = runCli(['--port', '0', '--data', dataDir, '--dist', distDir])
    const [, port] = await run.waitForOutput(/http:\/\/localhost:(\d+)/)
    await run.waitForOutput(/Keep this window open/)
    expect(run.output()).toContain(dataDir)
    expect(run.output()).toContain('Yggltree is running.')
    expect(run.output()).toContain('  Phones sync through the family relay: see Settings → Sync.')
    expect(run.output()).toContain('  Keep this window open. Press Ctrl+C or close it to stop Yggltree.')
    expect(run.output()).not.toMatch(/ExperimentalWarning/)
    const res = await fetch(`http://127.0.0.1:${port}/api/nope`)
    expect(res.status).toBe(404)
    await access(join(dataDir, 'hub.lock'))
    run.child.kill('SIGTERM')
    expect(await run.exited).toBe(0)
    await expect(access(join(dataDir, 'hub.lock'))).rejects.toThrow()
  })

  it('exits 0 with "already running" when the port is taken', async () => {
    const hub = await fx.hub()
    const dataDir = await fx.tmpDir('hub-data-')
    const run = runCli(['--port', String(hub.port), '--data', dataDir])
    expect(await run.exited).toBe(0)
    expect(run.output()).toContain(`Yggltree is already running at http://localhost:${hub.port}`)
    // It gave its lock back on the way out.
    await expect(access(join(dataDir, 'hub.lock'))).rejects.toThrow()
  })

  it('a port held by some other program exits 1 with a "use another port" hint, without opening a browser', async () => {
    // A plain HTTP server that is not Yggltree: /api/health answers, but not as a hub.
    const other = createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, app: 'something-else' }))
    })
    await new Promise((r) => other.listen(0, '127.0.0.1', r))
    const port = other.address().port
    try {
      const dataDir = await fx.tmpDir('hub-data-')
      const lines = []
      const log = { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)), warn() {}, info() {} }
      const opened = []
      const code = await main({ argv: ['--port', String(port), '--data', dataDir], env: {}, log, openBrowser: (u) => opened.push(u) })
      expect(code).toBe(1)
      expect(opened).toEqual([])
      const text = lines.join('\n')
      expect(text).not.toMatch(/already running/)
      expect(text).toContain(
        `Port ${port} is being used by another program. Close it, or start Yggltree on another port, for example: npm start -- --port 8788`
      )
      // It gave its lock back on the way out.
      await expect(access(join(dataDir, 'hub.lock'))).rejects.toThrow()
    } finally {
      await new Promise((r) => other.close(r))
    }
  })

  it('a port held by a raw TCP listener that never answers HTTP also exits 1 (the probe times out)', async () => {
    const sockets = []
    const raw = createServer((s) => sockets.push(s)) // accepts, never replies
    await new Promise((r) => raw.listen(0, '127.0.0.1', r))
    const port = raw.address().port
    try {
      const dataDir = await fx.tmpDir('hub-data-')
      const run = runCli(['--port', String(port), '--data', dataDir])
      expect(await run.exited).toBe(1)
      expect(run.output()).toContain(`Port ${port} is being used by another program.`)
      expect(run.output()).not.toMatch(/already running/)
    } finally {
      sockets.forEach((s) => s.destroy())
      await new Promise((r) => raw.close(r))
    }
  })

  it('the lock records the port the hub actually listens on', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    const hub = await fx.hub({ dataDir })
    const lock = JSON.parse(await readFile(join(dataDir, 'hub.lock'), 'utf8'))
    expect(lock).toMatchObject({ pid: process.pid, port: hub.port })
    expect(typeof lock.startedAt).toBe('number')
  })

  it('a second start on the same data folder says "already running" at the running hub\'s port and exits 0', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    const hub = await fx.hub({ dataDir })
    // A different requested port: the URL must come from the lock, not --port.
    const run = runCli(['--port', '0', '--data', dataDir])
    expect(await run.exited).toBe(0)
    expect(run.output()).toContain(`Yggltree is already running at http://localhost:${hub.port}`)
    // The running hub's lock is untouched.
    await access(join(dataDir, 'hub.lock'))
  })

  it('"already running" (lock or port) opens the browser unless --no-open', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    const hub = await fx.hub({ dataDir })
    const lines = []
    const log = { log: (m) => lines.push(m), error: (m) => lines.push(m), warn() {}, info() {} }
    const opened = []
    const openBrowser = (url) => opened.push(url)
    const argv = ['--port', String(hub.port), '--data', dataDir]
    expect(await main({ argv, env: {}, log, openBrowser })).toBe(0)
    expect(opened).toEqual([`http://localhost:${hub.port}`])
    expect(await main({ argv: [...argv, '--no-open'], env: {}, log, openBrowser })).toBe(0)
    expect(opened).toHaveLength(1)
    // Port taken by a hub on a different data folder: same treatment.
    const other = await fx.tmpDir('hub-data-')
    expect(await main({ argv: ['--port', String(hub.port), '--data', other], env: {}, log, openBrowser })).toBe(0)
    expect(opened).toHaveLength(2)
  })

  it('a stale lock held by a live non-hub pid exits 1 naming the pid and lock path, without opening a browser', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    // A port with nothing listening on it.
    const probe = createServer()
    await new Promise((r) => probe.listen(0, '127.0.0.1', r))
    const deadPort = probe.address().port
    await new Promise((r) => probe.close(r))
    // process.pid is alive (this test runner) but is not a hub.
    await writeFile(join(dataDir, 'hub.lock'), JSON.stringify({ pid: process.pid, startedAt: 0, port: deadPort }))
    const lines = []
    const log = { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)), warn() {}, info() {} }
    const opened = []
    const code = await main({ argv: ['--port', '0', '--data', dataDir], env: {}, log, openBrowser: (u) => opened.push(u) })
    expect(code).toBe(1)
    expect(opened).toEqual([])
    const text = lines.join('\n')
    expect(text).not.toMatch(/already running at/)
    expect(text).toContain(String(process.pid))
    expect(text).toContain(join(dataDir, 'hub.lock'))
    // The lock is left alone (it isn't ours to delete).
    expect(JSON.parse(await readFile(join(dataDir, 'hub.lock'), 'utf8')).pid).toBe(process.pid)
  })

  it('a stale lock without a port falls back to --port for the probe', async () => {
    const dataDir = await fx.tmpDir('hub-data-')
    await writeFile(join(dataDir, 'hub.lock'), JSON.stringify({ pid: process.pid }))
    const hub = await fx.hub() // a real hub (other data folder) on the --port we pass
    const log = { log() {}, error() {}, warn() {}, info() {} }
    const opened = []
    expect(await main({ argv: ['--port', String(hub.port), '--data', dataDir], env: {}, log, openBrowser: (u) => opened.push(u) })).toBe(0)
    expect(opened).toEqual([`http://localhost:${hub.port}`])
  })
})

describe('portInUseMessage', () => {
  it('suggests 8788, or 8789 when 8788 itself is the busy port', () => {
    expect(portInUseMessage(8787)).toBe(
      "Port 8787 is being used by another program. Close it, or start Yggltree on another port, for example: npm start -- --port 8788"
    )
    expect(portInUseMessage(8788)).toContain('for example: npm start -- --port 8789')
  })
})
