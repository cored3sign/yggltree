// The relay as the app's sync connection. Same shape as the hub connection
// (data/sync/connection.js) so the sync store and the status logic don't change:
// snapshot(), on('change'), destroy() and destroyed.
import { deriveRoomId } from './crypto.js'
import { createRelayRoom } from './provider.js'

export function connectRelay({
  fam,
  relayConfig,
  storage = globalThis.localStorage,
  WebSocketImpl = globalThis.WebSocket,
  outbox,
  src = '',
  onError = () => {},
  now = () => Date.now(),
}) {
  const { url, key } = relayConfig
  const mainRoom = deriveRoomId(key, 'main')
  const assetsRoom = deriveRoomId(key, 'assets')
  const sinceStore = {
    get: (room) => storage?.getItem(`fh.relay.since.${room}`) ?? null,
    set: (room, value) => {
      try {
        storage?.setItem(`fh.relay.since.${room}`, String(value))
      } catch {
        // storage blocked: the next connection replays from further back
      }
    },
  }
  const assetsSeededKey = `fh.relay.assets-seeded.${assetsRoom}`
  const assetsSeeded = storage?.getItem(assetsSeededKey) === '1'

  const listeners = new Set()
  let destroyed = false
  let lastSyncedAt = null
  const emit = () => {
    for (const fn of Array.from(listeners)) fn()
  }
  const onChange = (snap) => {
    if (snap.synced) lastSyncedAt = new Date(now()).toISOString().slice(0, 19).replace('T', ' ')
    emit()
  }

  const common = { url, key, WebSocketImpl, outbox, src, onError, now }
  const main = createRelayRoom({ ...common, doc: fam.doc, roomId: mainRoom, sinceStore, fullState: true, onChange })
  const assets = createRelayRoom({
    ...common,
    doc: fam.assets,
    roomId: assetsRoom,
    sinceStore,
    fullState: !assetsSeeded,
    onFullStateSent: () => {
      try {
        storage?.setItem(assetsSeededKey, '1')
      } catch {}
    },
    onChange: emit,
  })

  return {
    get destroyed() {
      return destroyed
    },
    snapshot() {
      const m = main.snapshot()
      return {
        mainSynced: m.synced,
        assetsSynced: assets.synced,
        wsStatus: m.wsStatus,
        closeCode: null,
        attemptStartedAt: m.attemptStartedAt,
        lastSyncedAt,
        rejected: m.rejected || assets.rejected,
        stage: m.stage,
        storageTimedOut: m.storageTimedOut,
        errorCode: m.errorCode,
        attempts: m.attempts,
      }
    },
    on(type, fn) {
      if (type !== 'change') throw new Error(`Unknown connection event: ${type}`)
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      listeners.clear()
      main.destroy()
      assets.destroy()
    },
  }
}
