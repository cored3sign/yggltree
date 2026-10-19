// Runs the family's Yggltree hub as a child process of the desktop app: starts it, waits until it
// answers, restarts it when asked, and stops it when the app quits. The hub's output goes to the
// log file. If a copy of Yggltree is already answering on the port, the app uses that copy and
// doesn't start a second one.

import { spawn as nodeSpawn } from 'node:child_process'
import { get as httpGet } from 'node:http'

export const HUB_PORT = Number(process.env.YGGLTREE_DESKTOP_PORT) || 8787
const STOP_GRACE_MS = 5000
const STARTUP_TIMEOUT_MS = 20000
const POLL_MS = 250

// True when a Yggltree answers /api/health on the port (127.0.0.1 only).
export function defaultHealth(port) {
  return new Promise((resolve) => {
    const req = httpGet({ host: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class HubProcess {
  constructor({
    command,
    args,
    env = {},
    cwd,
    port = HUB_PORT,
    spawnImpl = nodeSpawn,
    healthCheck = defaultHealth,
    log = { write() {} },
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    stopGraceMs = STOP_GRACE_MS,
    pollMs = POLL_MS,
    platform = process.platform,
  }) {
    Object.assign(this, { command, args, env, cwd, port, spawnImpl, healthCheck, log, startupTimeoutMs, stopGraceMs, pollMs, platform })
    this.child = null
    this.status = 'stopped'
    this.external = false
    this.error = null
    this.tail = []
  }

  get url() {
    return `http://localhost:${this.port}`
  }

  // Starts the hub unless it's already answering. Resolves with the status: 'running' or 'failed'.
  async start() {
    if (this.status === 'running' || this.status === 'starting') return this.status
    this.status = 'starting'
    this.error = null
    if (await this.healthCheck(this.port)) {
      this.external = true
      this.status = 'running'
      return this.status
    }
    this.external = false
    const child = this.spawnImpl(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      // The 'ipc' channel lets the app ask the hub to stop on Windows (see stop()).
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    this.child = child
    const onOutput = (chunk) => {
      const text = String(chunk)
      this.log.write(text)
      this.tail = [...this.tail, ...text.split('\n').filter(Boolean)].slice(-8)
    }
    child.stdout?.on('data', onOutput)
    child.stderr?.on('data', onOutput)
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = null
      if (this.status === 'stopping') {
        this.status = 'stopped'
        return
      }
      this.status = 'failed'
      this.error = `Yggltree stopped unexpectedly${code === null ? '' : ` (code ${code})`}.`
    })

    const deadline = Date.now() + this.startupTimeoutMs
    while (Date.now() < deadline) {
      if (this.child !== child) break
      if (await this.healthCheck(this.port)) {
        this.status = 'running'
        return this.status
      }
      await sleep(this.pollMs)
    }
    if (this.child === child) await this.stop()
    this.status = 'failed'
    if (!this.error) {
      this.error = `Yggltree didn't start. Another program may be using port ${this.port}.`
    }
    return this.status
  }

  // Stops the hub this app started. A copy the app didn't start is left alone.
  async stop() {
    const child = this.child
    if (!child) {
      this.status = 'stopped'
      return this.status
    }
    this.status = 'stopping'
    const exited = new Promise((resolve) => child.once('exit', resolve))
    // On Windows a signal ends the hub without its shutdown, so the hub is asked to stop over the message channel.
    if (this.platform === 'win32' && child.connected) child.send('stop')
    else child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), this.stopGraceMs)
    await exited
    clearTimeout(timer)
    this.child = null
    this.status = 'stopped'
    return this.status
  }

  // Stops this app's hub, then starts it again. Refuses when the answering hub is someone else's copy.
  async restart() {
    if (this.external && !this.child) {
      this.error = 'Yggltree is already running from another copy. Quit that copy first.'
      this.status = 'failed'
      return this.status
    }
    await this.stop()
    return this.start()
  }
}
