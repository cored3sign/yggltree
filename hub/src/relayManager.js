// Creates, replaces, updates and erases the family's relay on the family's own Cloudflare
// account, from Settings. Cloudflare access comes from one of two places:
//   - Wrangler's own login on this computer (`wrangler login`, which opens a Cloudflare
//     page where the family clicks Allow). No token is stored by Yggltree.
//   - A Cloudflare API token the family pastes in. It's kept in the hub's data folder,
//     readable only by this computer's user, and passed to wrangler only through its
//     environment. It is never sent to the browser or the relay, and it's removed from
//     any text shown to the user.
//
// Where Wrangler runs. From source, it's `npx wrangler` in the relay folder. The desktop
// app sets three variables instead: where its own Node is, where Wrangler is bundled, and
// where the prebuilt relay source is. The app's files are read-only, so Wrangler then works
// in a copy under the data folder.

import { spawn } from 'node:child_process'
import { chmod, cp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const CONNECTION_FILE = 'cloudflare.json'
export const RELAY_DIR = fileURLToPath(new URL('../../relay/', import.meta.url))
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'
const NAME = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/
const ADDRESS = /^https:\/\/([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev$/
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
const isWindows = process.platform === 'win32'

export class RelayError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RelayError'
  }
}

export function isRelayName(name) {
  return typeof name === 'string' && NAME.test(name)
}

export function isTokenShape(token) {
  return typeof token === 'string' && TOKEN_SHAPE.test(token)
}

// A relay's name is the first part of its address: <name>.<account>.workers.dev. Only a
// valid relay name counts, so nothing that starts with a hyphen can reach a command.
export function nameFromAddress(address) {
  const m = typeof address === 'string' ? ADDRESS.exec(address.trim().replace(/\/$/, '')) : null
  return m && isRelayName(m[1]) ? m[1] : null
}

export async function readConnection(dataDir) {
  try {
    return JSON.parse(await readFile(join(dataDir, CONNECTION_FILE), 'utf8'))
  } catch {
    return null
  }
}

// `record` holds the account id and name, and the token only when one was pasted.
export async function saveConnection(dataDir, record) {
  await mkdir(dataDir, { recursive: true })
  const path = join(dataDir, CONNECTION_FILE)
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(record), { mode: 0o600 })
  await rename(tmp, path)
  await chmod(path, 0o600)
}

export async function forgetConnection(dataDir) {
  await rm(join(dataDir, CONNECTION_FILE), { force: true })
}

// Asks Cloudflare which account a pasted token can deploy to.
export async function verifyToken(token, fetchImpl = globalThis.fetch) {
  let res
  try {
    res = await fetchImpl(`${CLOUDFLARE_API}/accounts`, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    throw new RelayError("Couldn't reach Cloudflare. Check the internet connection, then try again.")
  }
  if (res.status === 401 || res.status === 403) {
    throw new RelayError("Cloudflare didn't accept that token. Check that you copied all of it, with the permissions the setup guide lists.")
  }
  const body = await res.json().catch(() => null)
  const account = Array.isArray(body?.result) ? body.result[0] : null
  if (!res.ok || !account?.id) throw new RelayError("Cloudflare didn't give an account for that token.")
  return { accountId: account.id, accountName: account.name ?? account.id }
}

// Runs a command and collects what it prints. Never throws for a non-zero exit.
export function runCommand(command, args, { cwd, env, timeoutMs, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(isWindows ? `${command}.cmd` : command, args, { cwd, env, shell: isWindows, windowsHide: true })
    let output = ''
    let timer = null
    if (timeoutMs) {
      timer = setTimeout(() => {
        child.kill()
        resolve({ code: -1, output: `${output}\nThe command took too long and was stopped.` })
      }, timeoutMs)
    }
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', () => {
      clearTimeout(timer)
      reject(new RelayError("Couldn't start the tools for the relay. Check that Node.js is installed."))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
  })
}

// Wrangler treats a process as a bundled Electron app unless process.defaultApp is set. In that case it
// reads its arguments from the wrong place and every command fails, including the sign-in check. The
// preload sets the flag, so Wrangler runs as the plain Node program it is.
const WRANGLER_PRELOAD = fileURLToPath(new URL('./wranglerPreload.cjs', import.meta.url))

// How to run Wrangler with `args`. The desktop app bundles it and runs it with the app's own
// Node (ELECTRON_RUN_AS_NODE). From source it's npx, as before.
export function wranglerInvocation(args, env = process.env) {
  if (env.YGGLTREE_WRANGLER_BIN) {
    return {
      command: env.YGGLTREE_NODE_BIN || process.execPath,
      args: ['--require', WRANGLER_PRELOAD, env.YGGLTREE_WRANGLER_BIN, ...args],
      extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  return { command: 'npx', args: ['--no-install', 'wrangler', ...args], extraEnv: {} }
}

// Every Wrangler command runs here. Wrangler's anonymous usage reports go to Cloudflare, and the app
// promises no outside services beyond the family's own relay, so they're always off.
function runWrangler(run, args, { cwd, env, timeoutMs }) {
  const inv = wranglerInvocation(args)
  return run(inv.command, inv.args, { cwd, env: { ...env, ...inv.extraEnv, WRANGLER_SEND_METRICS: 'false' }, timeoutMs })
}

// Where the relay's source is: the bundled copy in the desktop app, or the repo's relay folder.
export function relaySourceDir(env = process.env) {
  return env.YGGLTREE_RELAY_DIR || RELAY_DIR
}

// The folder Wrangler runs in. In the desktop app the bundled relay is read-only, so it's copied
// under the data folder, with node_modules linked to the bundled copy.
export async function relayWorkDir({ sourceDir, dataDir, env = process.env }) {
  if (!env.YGGLTREE_RELAY_DIR || !dataDir) return sourceDir
  const work = join(dataDir, 'relay-tools')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  for (const entry of ['wrangler.jsonc', 'package.json', 'src', 'public']) {
    await cp(join(sourceDir, entry), join(work, entry), { recursive: true })
  }
  await symlink(join(sourceDir, 'node_modules'), join(work, 'node_modules'))
  return work
}

// The account Wrangler is logged in to on this computer, or null if it isn't logged in.
export async function wranglerAccount({ relayDir = relaySourceDir(), run = runCommand } = {}) {
  const res = await runWrangler(run, ['whoami', '--json'], { cwd: relayDir, env: process.env })
  if (res.code !== 0) return null
  let data
  try {
    data = JSON.parse(res.output.slice(res.output.indexOf('{')))
  } catch {
    return null
  }
  const account = Array.isArray(data?.accounts) ? data.accounts[0] : null
  if (!data?.loggedIn || !account?.id) return null
  return { accountId: account.id, accountName: account.name ?? account.id }
}

// Opens Cloudflare's login page in the browser, and waits for the family to click Allow.
export async function loginWithWrangler({ relayDir = relaySourceDir(), run = runCommand } = {}) {
  const res = await runWrangler(run, ['login'], { cwd: relayDir, env: process.env, timeoutMs: LOGIN_TIMEOUT_MS })
  if (res.code !== 0) {
    throw new RelayError("Cloudflare login didn't finish. Click Connect Cloudflare again, then click Allow on the Cloudflare page.")
  }
  const account = await wranglerAccount({ relayDir, run })
  if (!account) throw new RelayError("Cloudflare login didn't connect an account. Try again.")
  return account
}

// Tells the tools which Cloudflare access to use. A pasted token goes only into the environment.
function cloudflareEnv({ token, accountId }) {
  const env = { ...process.env }
  if (token) env.CLOUDFLARE_API_TOKEN = token
  if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId
  return env
}

// Keeps the token out of anything shown to the user, and keeps the message short.
function tail(output, token) {
  let text = String(output).trim()
  if (token) text = text.split(token).join('[token]')
  return text.split('\n').slice(-6).join('\n').slice(-500)
}

// Builds the app into the relay (not needed when the app ships it prebuilt), then deploys the
// relay under the name the family chose.
export async function deployRelay({ name, token = null, accountId = null, relayDir = relaySourceDir(), dataDir = null, run = runCommand, env = process.env }) {
  if (!isRelayName(name)) {
    throw new RelayError('Use 3 to 63 lowercase letters, digits or hyphens for the relay name.')
  }
  const cfEnv = cloudflareEnv({ token, accountId })
  const prebuilt = env.YGGLTREE_RELAY_PREBUILT === '1'
  if (!prebuilt) {
    const build = await run('npm', ['run', 'build:app'], { cwd: relayDir, env: cfEnv })
    if (build.code !== 0) throw new RelayError(`Building the relay failed. ${tail(build.output, token)}`)
  }
  const workDir = await relayWorkDir({ sourceDir: relayDir, dataDir, env })
  const deploy = await runWrangler(run, ['deploy', `--name=${name}`], { cwd: workDir, env: cfEnv })
  if (deploy.code !== 0) throw new RelayError(`Cloudflare didn't create the relay. ${tail(deploy.output, token)}`)
  for (const m of String(deploy.output).matchAll(/https:\/\/([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev/g)) {
    if (m[1] === name) return `https://${m[1]}.${m[2]}.workers.dev`
  }
  throw new RelayError("The relay was created, but its address wasn't found. Check the Cloudflare dashboard for the address.")
}

// Sends the current relay source to an existing relay, under the same name. Nothing is deleted.
// The relay's stored data and the family's pairing stay as they are.
export async function updateRelay({ name, token = null, accountId = null, relayDir = relaySourceDir(), dataDir = null, run = runCommand, env = process.env }) {
  const address = await deployRelay({ name, token, accountId, relayDir, dataDir, run, env })
  return { name, address }
}

// Deletes the relay's worker, and with it everything the relay stored. A relay that is
// already gone counts as deleted.
export async function deleteRelay({ address, token = null, accountId = null, relayDir = relaySourceDir(), run = runCommand }) {
  const name = nameFromAddress(address)
  if (!name || !isRelayName(name)) throw new RelayError("That isn't a relay address this app set up.")
  const result = await runWrangler(run, ['delete', `--name=${name}`, '--force'], {
    cwd: relayDir,
    env: cloudflareEnv({ token, accountId }),
  })
  const gone = /not found|does not exist|10007/i.test(result.output)
  if (result.code !== 0 && !gone) throw new RelayError(`Cloudflare didn't delete the relay. ${tail(result.output, token)}`)
  return { name }
}
