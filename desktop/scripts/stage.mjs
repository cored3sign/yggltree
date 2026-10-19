#!/usr/bin/env node
// Assembles the hub, the frontend build and the relay (with its own Wrangler) into build/app-hub,
// ready for electron-builder to put inside the app. One architecture at a time, because each
// architecture needs its own copy of Wrangler's workerd binary (about 135 MB unpacked).
//
//   node scripts/stage.mjs --arch arm64     (or --arch x64)     Mac, the default
//   node scripts/stage.mjs --arch x64 --platform win            Windows, run on Windows
//
// Run after `npm run build` at the repository root, which builds frontend/dist.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = join(here, '..')
const repo = join(desktop, '..')
const { values } = parseArgs({ options: { arch: { type: 'string' }, platform: { type: 'string', default: 'mac' } } })
const arch = values.arch
const platform = values.platform
if ((arch !== 'arm64' && arch !== 'x64') || (platform !== 'mac' && platform !== 'win')) {
  console.error('Usage: node scripts/stage.mjs --arch arm64|x64 [--platform mac|win]')
  process.exit(2)
}
// The Windows build is x64 only.
if (platform === 'win' && arch !== 'x64') {
  console.error('The Windows build is x64 only.')
  process.exit(2)
}
const npmArch = arch === 'x64' ? 'x64' : 'arm64'
const npmOs = platform === 'win' ? 'win32' : 'darwin'
// npm is a .cmd file on Windows, which only runs through a shell.
const shell = process.platform === 'win32'

const out = join(desktop, 'build', 'app-hub')
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

// The version the hub reports comes from the root package.
const rootPackage = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
await writeFile(join(out, 'package.json'), JSON.stringify({ name: 'yggltree', version: rootPackage.version, private: true }, null, 2))

// The hub: its source, and its runtime dependencies installed for this architecture.
await cp(join(repo, 'hub', 'src'), join(out, 'hub', 'src'), { recursive: true })
await cp(join(repo, 'hub', 'package.json'), join(out, 'hub', 'package.json'))
// The hub imports a few frontend modules (backup format, sync protocol), so the frontend source comes too.
await cp(join(repo, 'frontend', 'src'), join(out, 'frontend', 'src'), { recursive: true })
await cp(join(repo, 'frontend', 'dist'), join(out, 'frontend', 'dist'), { recursive: true })
// Installed from the repository's lockfile, with install scripts off: nothing a dependency downloads or runs
// at install time gets into the app, and the release can't pick up versions newer than the reviewed ones.
// npm ci needs the lockfile in the folder it installs into, so the root one is copied in and removed after.
await cp(join(repo, 'package-lock.json'), join(out, 'hub', 'package-lock.json'))
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--cpu=${npmArch}`, `--os=${npmOs}`], {
  cwd: join(out, 'hub'),
  stdio: 'inherit',
  shell,
})
await rm(join(out, 'hub', 'package-lock.json'))
// The frontend files the hub imports (backupFormat.js, protocol.js) import yjs, and so does the hub. Two copies of
// yjs would be two library instances, which Yjs warns breaks its type checks. So the frontend's yjs is a shim that
// re-exports the hub's copy, which is the one file both use.
const yjsShim = join(out, 'frontend', 'node_modules', 'yjs')
await mkdir(yjsShim, { recursive: true })
await writeFile(join(yjsShim, 'package.json'), JSON.stringify({ name: 'yjs', private: true, type: 'module', exports: { '.': './index.mjs' } }, null, 2))
await writeFile(join(yjsShim, 'index.mjs'), "// One copy of yjs for the hub and the frontend files it uses; see desktop/scripts/stage.mjs.\nexport * from '../../../hub/node_modules/yjs/dist/yjs.mjs'\n")

// The relay: its source, the app it serves to phones, and Wrangler with the workerd binary for this architecture.
// Its dependencies come from its own lockfile, installed the same way.
await mkdir(join(out, 'relay'), { recursive: true })
for (const entry of ['src', 'wrangler.jsonc', 'package.json', 'package-lock.json']) {
  await cp(join(repo, 'relay', entry), join(out, 'relay', entry), { recursive: true })
}
// The phones' app is the build the hub serves, copied the way relay/package.json's build:app does. It comes
// from frontend/dist, not from relay/public, which is a leftover from an earlier build and can be stale.
await cp(join(repo, 'frontend', 'dist'), join(out, 'relay', 'public'), { recursive: true })
execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', `--cpu=${npmArch}`, `--os=${npmOs}`], {
  cwd: join(out, 'relay'),
  stdio: 'inherit',
  shell,
})

// Trim what the deploy never uses: the image libraries Wrangler doesn't load, and the debug symbols
// in workerd (about 135 MB to 85 MB, and it still runs).
const modules = join(out, 'relay', 'node_modules')
await rm(join(modules, 'sharp'), { recursive: true, force: true })
await rm(join(modules, '@img'), { recursive: true, force: true })
const workerdPackage = join(modules, '@cloudflare', platform === 'win' ? 'workerd-windows-64' : `workerd-darwin-${npmArch === 'x64' ? '64' : 'arm64'}`)
const workerdBinary = join(workerdPackage, 'bin', platform === 'win' ? 'workerd.exe' : 'workerd')
if (platform === 'mac') execFileSync('strip', ['-x', workerdBinary])

// workerd's binary lives in its platform package, which npm installs for this architecture. Its install
// script, which would copy a binary into workerd/bin for the Node that runs it, doesn't run, so the bin link
// npm made points at nothing and is removed. Wrangler loads the binary from the platform package.
await rm(join(modules, '.bin', 'workerd'), { force: true })
await rm(join(modules, '.bin', 'workerd.cmd'), { force: true })
if (platform === 'win') {
  // A Windows program starts with "MZ", and its PE header holds the machine type (0x8664 is x64).
  const exe = await readFile(workerdBinary)
  const peOffset = exe.readUInt32LE(0x3c)
  const isPe = exe.toString('latin1', 0, 2) === 'MZ' && exe.toString('latin1', peOffset, peOffset + 4) === 'PE\0\0'
  if (!isPe || exe.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw new Error(`workerd for ${arch} is not an x64 Windows program`)
  }
} else {
  const binaryType = execFileSync('file', ['-b', workerdBinary], { encoding: 'utf8' })
  if (!binaryType.includes(npmArch === 'x64' ? 'x86_64' : 'arm64')) {
    throw new Error(`workerd for ${arch} is the wrong architecture: ${binaryType}`)
  }
}

for (const module of ['frontend/src/data/backupFormat.js', 'frontend/src/data/sync/protocol.js']) {
  await import(pathToFileURL(join(out, module)).href)
}
console.log(`Staged the app's hub and relay for ${arch} in ${out}`)
