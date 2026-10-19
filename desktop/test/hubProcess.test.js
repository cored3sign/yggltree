import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { HubProcess } from '../hubProcess.js'

// A child process stand-in: kill() ends it on the next tick, the way a real process does.
function fakeChild({ exitOnKill = true } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = []
  child.kill = (signal) => {
    child.killed.push(signal)
    if (exitOnKill) setImmediate(() => child.emit('exit', null))
  }
  return child
}

function harness({ healthy = [false, true], exitOnKill, startupTimeoutMs = 2000, platform } = {}) {
  const spawned = []
  const answers = [...healthy]
  const hub = new HubProcess({
    command: '/App/Yggltree',
    args: ['hub/src/cli.js', '--no-open'],
    cwd: '/App',
    port: 8787,
    pollMs: 1,
    stopGraceMs: 50,
    startupTimeoutMs,
    spawnImpl: (command, args, options) => {
      const child = fakeChild({ exitOnKill })
      spawned.push({ command, args, options, child })
      return child
    },
    healthCheck: async () => (answers.length > 1 ? answers.shift() : answers[0]),
    platform,
  })
  return { hub, spawned }
}

test('a Yggltree already answering is used, not started again', async () => {
  const { hub, spawned } = harness({ healthy: [true] })
  assert.equal(await hub.start(), 'running')
  assert.equal(hub.external, true)
  assert.equal(spawned.length, 0)
})

test('the hub starts, and is running once it answers', async () => {
  const { hub, spawned } = harness({ healthy: [false, false, true] })
  assert.equal(await hub.start(), 'running')
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].command, '/App/Yggltree')
  assert.equal(hub.url, 'http://localhost:8787')
})

test('a hub that exits before it answers is reported as failed, with a reason', async () => {
  const { hub, spawned } = harness({ healthy: [false], exitOnKill: true, startupTimeoutMs: 30 })
  const status = await hub.start()
  assert.equal(status, 'failed')
  assert.match(hub.error, /didn't start|port 8787/)
  assert.equal(spawned[0].child.killed.length >= 1, true)
})

test('stopping sends SIGTERM and returns to stopped', async () => {
  const { hub, spawned } = harness({ healthy: [false, true] })
  await hub.start()
  assert.equal(await hub.stop(), 'stopped')
  assert.deepEqual(spawned[0].child.killed, ['SIGTERM'])
  assert.equal(hub.child, null)
})

test('on Windows, stopping sends the hub a stop message, not a signal', async () => {
  const { hub, spawned } = harness({ healthy: [false, true], platform: 'win32' })
  await hub.start()
  const child = spawned[0].child
  const sent = []
  child.connected = true
  child.send = (message) => {
    sent.push(message)
    setImmediate(() => child.emit('exit', 0))
  }
  assert.equal(await hub.stop(), 'stopped')
  assert.deepEqual(sent, ['stop'])
  assert.deepEqual(child.killed, [])
})

test('restart stops and starts this app\'s hub again', async () => {
  const { hub, spawned } = harness({ healthy: [false, true, false, true] })
  await hub.start()
  assert.equal(await hub.restart(), 'running')
  assert.equal(spawned.length, 2)
  assert.deepEqual(spawned[0].child.killed, ['SIGTERM'])
})

test('restart refuses to touch another copy of Yggltree', async () => {
  const { hub, spawned } = harness({ healthy: [true] })
  await hub.start()
  assert.equal(await hub.restart(), 'failed')
  assert.match(hub.error, /another copy/)
  assert.equal(spawned.length, 0)
})

test('the hub\'s output goes to the log, and its last lines are kept', async () => {
  const written = []
  const { hub, spawned } = harness({ healthy: [false, true] })
  hub.log = { write: (text) => written.push(text) }
  await hub.start()
  spawned[0].child.stdout.emit('data', 'Yggltree is running.\n')
  assert.deepEqual(written, ['Yggltree is running.\n'])
  assert.deepEqual(hub.tail, ['Yggltree is running.'])
})
