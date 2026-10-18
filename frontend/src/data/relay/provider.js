// One relay room for one Yjs document (the main data, or the photos).
//
// - Our own edits (null origin in Yjs) are split into pieces of at most CHUNK_BYTES,
//   each encrypted, kept in the outbox until the relay confirms them, then sent.
// - Edits from the relay, and edits restored from local storage, are applied
//   without being sent again.
// - A connection sends the whole document once after it reconnects. The piece ids
//   come from the content, so a repeat is a no-op on the relay.
// - Nothing is sent until the relay has accepted the token ('caught-up'), since the
//   relay ignores entries that arrive before that.
// - A wrong key or damaged piece is counted and skipped, never applied.
//
// Works in the browser and in Node. The WebSocket and the outbox are injected.
import * as Y from 'yjs'
import { sha256 } from '@noble/hashes/sha2.js'
import { randomBytes, bytesToHex } from '@noble/hashes/utils.js'
import { encryptBytes, decryptBytes, deriveAuth, toBase64, fromBase64, toBase64Url } from './crypto.js'
import { PRESENCE_ORIGIN, RELAY_REMOTE_ORIGIN as REMOTE } from '../origins.js'
import { STORAGE_WAIT_MS, waitAtMost } from './stage.js'

export const CHUNK_BYTES = 192 * 1024
const ID_PATTERN = /^([0-9a-f]+)~(\d+)~(\d+)$/

function piecesOf(key, update, base) {
  const total = Math.max(1, Math.ceil(update.length / CHUNK_BYTES))
  const out = []
  for (let i = 0; i < total; i++) {
    const piece = update.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)
    out.push({ id: `${base}~${i}~${total}`, data: toBase64(encryptBytes(key, piece)) })
  }
  return out
}

export function createRelayRoom({
  doc,
  key,
  roomId,
  url,
  WebSocketImpl = globalThis.WebSocket,
  outbox,
  sinceStore,
  fullState = true,
  onFullStateSent = () => {},
  src = '',
  retryMs = 1000,
  now = () => Date.now(),
  onChange = () => {},
  onError = () => {},
}) {
  const auth = toBase64Url(deriveAuth(key))
  const pending = new Map() // our pieces not yet confirmed by the relay
  const seen = new Set() // relay piece ids already handled
  const groups = new Map() // base -> { total, parts, minSeq } for pieces still arriving
  const stats = { sent: 0, received: 0, applied: 0, rejected: 0 }
  let since = Number(sinceStore?.get(roomId)) || 0
  let ws = null
  let authed = false
  let synced = false
  let rejected = false
  let closed = false
  let retryTimer = null
  let attemptStartedAt = now()
  const state = { wsStatus: 'connecting' }
  // The steps a connection goes through, shown on the connecting screen: storage, socket, handshake, synced.
  let stage = 'storage'
  let storageTimedOut = false
  // The last connection attempt's close code (1006 means the connection failed before it opened) and how many
  // attempts have ended, so a stall shows what the browser reported.
  let lastErrorCode = null
  let attempts = 0

  const notify = () => onChange(snapshot())
  const setWs = (status) => {
    state.wsStatus = status
    notify()
  }
  const setSynced = (value) => {
    if (synced === value) return
    synced = value
    notify()
  }
  const setStage = (value) => {
    if (stage === value) return
    stage = value
    notify()
  }

  function persistSince() {
    if (!sinceStore) return
    let safe = since
    for (const group of groups.values()) safe = Math.min(safe, group.minSeq - 1)
    sinceStore.set(roomId, Math.max(0, safe))
  }

  function sendRaw(entry) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'entry', id: entry.id, data: entry.data, src, ...(entry.quiet ? { quiet: true } : {}) }))
      stats.sent++
    }
  }

  // The local outbox must open before connecting. If it doesn't open in time, connect anyway: the changes
  // in it are still kept, and the next load reads them again.
  const ready = (async () => {
    let rows = null
    try {
      rows = await waitAtMost(outbox.all(roomId), STORAGE_WAIT_MS)
    } catch {
      storageTimedOut = true
    }
    for (const row of rows ?? []) pending.set(row.id, row)
    setStage('socket')
  })()

  // Every change is uploaded except the ones this relay applied itself. That includes
  // changes that arrived through the home hub, so both paths reach the other devices.
  function onLocalUpdate(update, origin) {
    if (origin === REMOTE) return
    const base = bytesToHex(randomBytes(12))
    for (const piece of piecesOf(key, update, base)) {
      const row = { ...piece, room: roomId, quiet: origin === PRESENCE_ORIGIN }
      pending.set(row.id, row)
      outbox.put(row).catch((err) => onError(err))
      if (authed) sendRaw(row)
    }
  }

  function receive(msg) {
    // The relay isn't trusted with content: an entry that can't be read or decoded is skipped, never applied.
    if (typeof msg.id !== 'string' || typeof msg.data !== 'string') return
    const match = ID_PATTERN.exec(msg.id)
    if (!match) return
    if (msg.seq > since) since = msg.seq
    if (seen.has(msg.id)) return persistSince()
    let plain = null
    try {
      plain = decryptBytes(key, fromBase64(msg.data))
    } catch {
      plain = null
    }
    if (!plain) {
      stats.rejected++
      return persistSince()
    }
    stats.received++
    seen.add(msg.id)
    const base = match[1]
    const index = Number(match[2])
    const total = Number(match[3])
    const group = groups.get(base) ?? { total, parts: new Map(), minSeq: msg.seq ?? since }
    group.parts.set(index, plain)
    group.minSeq = Math.min(group.minSeq, msg.seq ?? since)
    groups.set(base, group)
    if (group.parts.size === group.total) {
      const pieces = [...group.parts.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])
      const size = pieces.reduce((n, p) => n + p.length, 0)
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const p of pieces) {
        bytes.set(p, offset)
        offset += p.length
      }
      groups.delete(base)
      Y.applyUpdate(doc, bytes, REMOTE)
      stats.applied++
    }
    persistSince()
  }

  function flushPending() {
    for (const row of pending.values()) sendRaw(row)
  }

  function sendWholeDocument() {
    if (!fullState) return
    const full = Y.encodeStateAsUpdate(doc)
    const base = bytesToHex(sha256(full)).slice(0, 24) // same content, same id: the relay keeps one copy
    // A catch-up, not news: every change inside it was also sent on its own (not quiet), so
    // reconnecting sends no "something changed" notification.
    for (const piece of piecesOf(key, full, base)) sendRaw({ ...piece, quiet: true })
    onFullStateSent()
  }

  function onMessage(event) {
    let msg
    try {
      msg = JSON.parse(event.data)
    } catch {
      return
    }
    if (msg.type === 'entry') return receive(msg)
    if (msg.type === 'ack') {
      pending.delete(msg.id)
      outbox.remove(msg.id).catch((err) => onError(err))
      return
    }
    if (msg.type === 'caught-up') {
      authed = true
      setSynced(true)
      setStage('synced')
      flushPending()
      sendWholeDocument()
      return
    }
    if (msg.type === 'error' && msg.reason === 'auth') {
      rejected = true
      onError(new Error('relay refused this family key'))
    }
  }

  function connect() {
    if (closed || rejected) return
    attemptStartedAt = now()
    authed = false
    setSynced(false)
    setWs('connecting')
    ws = new WebSocketImpl(`${url.replace(/\/$/, '')}/room/${roomId}`)
    ws.onopen = () => {
      setWs('connected')
      setStage('handshake')
      ws.send(JSON.stringify({ type: 'hello', since, auth }))
    }
    ws.onmessage = onMessage
    ws.onclose = (event) => {
      authed = false
      attempts++
      lastErrorCode = event?.code ?? null
      setSynced(false)
      setStage('socket')
      setWs('disconnected')
      if (!closed && !rejected) retryTimer = setTimeout(connect, retryMs)
    }
    ws.onerror = () => {}
  }

  function snapshot() {
    return { wsStatus: state.wsStatus, synced, attemptStartedAt, rejected, stage, storageTimedOut, errorCode: lastErrorCode, attempts }
  }

  doc.on('update', onLocalUpdate)
  ready.then(connect).catch((err) => onError(err))

  return {
    roomId,
    stats,
    get synced() {
      return synced
    },
    get rejected() {
      return rejected
    },
    get outboxLength() {
      return pending.size
    },
    snapshot,
    disconnect() {
      clearTimeout(retryTimer)
      if (ws) ws.close()
    },
    reconnect() {
      if (closed || rejected) return
      clearTimeout(retryTimer)
      if (ws) ws.close()
      connect()
    },
    destroy() {
      closed = true
      clearTimeout(retryTimer)
      doc.off('update', onLocalUpdate)
      if (ws) ws.close()
    },
  }
}
