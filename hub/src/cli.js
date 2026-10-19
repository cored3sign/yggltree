#!/usr/bin/env node
// `npm run hub` / `node hub/src/cli.js` -- starts the home hub in the
// foreground. `npm start` (scripts/start.cjs) installs and builds first,
// then calls main() from here.
//
//   --port <n>          listen port for this computer (default 8787)
//   --data <dir>        data directory (else YGGLTREE_DATA, else the per-OS default)
//   --dist <dir>        built frontend (default <repo>/frontend/dist)
//   --no-open           don't open a browser (also YGGLTREE_NO_OPEN=1)
//
// The hub listens on this computer only. Phones sync through the family
// relay (see relay/README.md), not through this computer.
//
// startHub() acquires hub.lock and close() releases it, so the lock is
// held for exactly the hub's lifetime, including the EADDRINUSE path.

import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { defaultDataDir, legacyDataDir, migrateLegacyDataDir } from './dataDir.js'

const DEFAULT_PORT = 8787

const USAGE = `Usage: node hub/src/cli.js [--port 8787] [--data <dir>] [--dist <dir>] [--no-open]`

function truthyEnv(value) {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

export function parseCliArgs(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string' },
      data: { type: 'string' },
      dist: { type: 'string' },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  })
  let port = DEFAULT_PORT
  if (values.port !== undefined) {
    port = Number(values.port)
    if (!/^\d+$/.test(values.port) || port > 65535) throw new Error(`Invalid --port: ${values.port}`)
  }
  return {
    help: values.help,
    port,
    dataDir: values.data ?? (env.YGGLTREE_DATA || env.FAMILY_HUB_DATA || undefined),
    distDir: values.dist,
    open: !values['no-open'] && !truthyEnv(env.YGGLTREE_NO_OPEN) && !truthyEnv(env.FAMILY_HUB_NO_OPEN),
  }
}

export function browserCommand(platform, url) {
  if (platform === 'darwin') return { cmd: 'open', args: [url] }
  // `start`'s first quoted argument is a window title, hence the empty "".
  if (platform === 'win32') return { cmd: 'cmd', args: ['/c', 'start', '""', url], options: { windowsVerbatimArguments: true } }
  return { cmd: 'xdg-open', args: [url] }
}

function openBrowser(url, platform) {
  const { cmd, args, options = {} } = browserCommand(platform, url)
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...options })
    child.on('error', () => {}) // no opener installed: the banner still has the URL
    child.unref()
  } catch {
    // same: never fatal
  }
}

// True when a Yggltree answers /api/health on this port. 127.0.0.1 is
// used rather than localhost so the probe never depends on resolver order.
export async function isHubAnswering(port, timeoutMs = 1500) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return false
    const body = await res.json()
    return body?.app === 'family-hub'
  } catch {
    return false
  }
}

// The busy-port hint; suggests 8788, or 8789 when 8788 is the busy one.
export function portInUseMessage(port) {
  const suggestion = Number(port) === 8788 ? 8789 : 8788
  return (
    `Port ${port} is being used by another program. Close it, or start Yggltree on another port, for example: ` +
    `npm start -- --port ${suggestion}`
  )
}

function banner({ url, dataDir }) {
  return [
    '',
    'Yggltree is running.',
    `  On this computer:  ${url}`,
    '  Phones sync through the family relay: see Settings → Sync.',
    `  Data folder:       ${dataDir}`,
    '  Keep this window open. Press Ctrl+C or close it to stop Yggltree.',
    '',
  ].join('\n')
}

// lib0 (pulled in by y-protocols) probes globalThis.localStorage at import
// time, which on Node >= 25 prints an ExperimentalWarning that would
// clutter the banner. Drop exactly that warning; pass everything else on
// to Node's default printer.
function silenceLocalStorageWarning() {
  const previous = process.listeners('warning')
  process.removeAllListeners('warning')
  process.on('warning', (warning) => {
    if (warning?.name === 'ExperimentalWarning' && /localStorage/.test(warning.message)) return
    for (const listener of previous) listener(warning)
  })
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  log = console,
  platform = process.platform,
  openBrowser: openUrl = (url) => openBrowser(url, platform),
} = {}) {
  let args
  try {
    args = parseCliArgs(argv, env)
  } catch (err) {
    log.error(`${err.message}\n${USAGE}`)
    return 2
  }
  if (args.help) {
    log.log(USAGE)
    return 0
  }

  silenceLocalStorageWarning()
  const { startHub } = await import('./server.js')

  let dataDir = resolve(args.dataDir ?? defaultDataDir({ platform, env, homedir: homedir() }))
  if (args.dataDir === undefined) {
    const migration = await migrateLegacyDataDir({
      dataDir,
      legacyDir: legacyDataDir({ platform, env, homedir: homedir() }),
    })
    dataDir = resolve(migration.dir)
    if (migration.action === 'moved') log.log(`Moved your data folder to ${dataDir}. Your data came with it.`)
    if (migration.action === 'in-use') log.log(`Using your existing data folder at ${dataDir}, which another copy is still using.`)
    if (migration.action === 'failed') log.log(`Couldn't move your data folder (${migration.error?.message ?? migration.error}). Using it at ${dataDir} for now.`)
  }
  // undefined -> startHub's default, <repo>/frontend/dist resolved from server.js
  const distDir = args.distDir === undefined ? undefined : resolve(args.distDir)

  let hub
  try {
    hub = await startHub({ port: args.port, dataDir, distDir, log })
  } catch (err) {
    // A second start is not an error for the person who double-clicked
    // the launcher again: point them at the running hub and exit 0 (the
    // Windows .bat relies on the exit code).
    // The port can also be held by some unrelated program, so only say
    // "already running" when a Yggltree actually answers there.
    if (err?.code === 'EADDRINUSE') {
      if (await isHubAnswering(args.port)) {
        const url = `http://localhost:${args.port}`
        log.log(`Yggltree is already running at ${url}`)
        if (args.open) openUrl(url)
        return 0
      }
      log.error(portInUseMessage(args.port))
      return 1
    }
    // hub.lock is held by a live pid. That pid may be a hub -- or, after a
    // crash and pid reuse, some unrelated program -- so only say "already
    // running" when a hub actually answers on the port the lock recorded.
    if (err?.code === 'HUB_LOCKED') {
      const port = Number.isInteger(err.port) && err.port > 0 ? err.port : args.port
      if (await isHubAnswering(port)) {
        const url = `http://localhost:${port}`
        log.log(`Yggltree is already running at ${url}`)
        if (args.open) openUrl(url)
        return 0
      }
      log.error(
        `Another program appears to be using Yggltree's data folder (process ${err.pid}), but Yggltree isn't answering.\n` +
          `If Yggltree isn't running, delete ${err.lockPath ?? join(dataDir, 'hub.lock')} and start it again.`
      )
      return 1
    }
    log.error(`Yggltree could not start: ${err?.message ?? err}`)
    return 1
  }

  log.log(banner({ url: hub.url, dataDir }))

  if (args.open) openUrl(hub.url)

  return new Promise((resolveExit) => {
    let stopping = false
    const stop = (signal) => {
      if (stopping) {
        resolveExit(1) // second Ctrl+C: give up waiting
        return
      }
      stopping = true
      log.log(`\nStopping Yggltree (${signal})...`)
      hub.close().then(
        () => resolveExit(0),
        (err) => {
          log.error(`Yggltree stopped with an error: ${err?.message ?? err}`)
          resolveExit(1)
        }
      )
    }
    process.on('SIGINT', () => stop('SIGINT'))
    process.on('SIGTERM', () => stop('SIGTERM'))
    // The desktop app asks for a stop this way on Windows, where a signal ends the process without running this.
    if (process.send) {
      process.on('message', (message) => {
        if (message === 'stop') stop('stop request')
      })
    }
  })
}

function invokedDirectly() {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err)
      process.exit(1)
    }
  )
}
