import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The packaged app only contains the files listed under `files:` in electron-builder.yml. A file that the app
// imports or loads but isn't listed works from source and crashes the installed app at startup, so every
// desktop file the app needs is checked here.
const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
// Windows checks files out with CRLF line endings; the match below expects LF.
const config = readFileSync(join(desktop, 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n')
const block = config.match(/^files:\n((?:  - .*\n?)+)/m)
const packaged = new Set(block ? block[1].split('\n').filter((line) => line.startsWith('  - ')).map((line) => line.slice(4).trim()) : [])

test('every desktop file the app imports is packaged', () => {
  const queue = ['main.js']
  const seen = new Set()
  while (queue.length > 0) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    assert.ok(packaged.has(file), `${file} is imported by the app but not listed under files: in electron-builder.yml`)
    const source = readFileSync(join(desktop, file), 'utf8')
    for (const match of source.matchAll(/from '\.\/([^']+)'/g)) queue.push(match[1])
  }
  assert.ok(seen.size > 1, 'the import walk should reach the app\'s own modules')
})

test('the window and tray files the app loads by name are packaged', () => {
  for (const file of ['preload.cjs', 'loading.html', 'assets/**/*']) {
    assert.ok(packaged.has(file), `${file} is loaded by the app but not listed under files: in electron-builder.yml`)
  }
})
