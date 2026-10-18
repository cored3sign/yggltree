// Where a relay connection is, in order: opening this browser's storage, reaching the relay, waiting for the
// family's data from the relay, and synced. The connecting screen names the current step, so a connection
// that stalls shows where it stalled.

// How long the browser's storage gets to open before the connection starts anyway. A storage that never
// opens would otherwise keep the phone on the connecting screen with no error.
export const STORAGE_WAIT_MS = 5000

// Resolves with the promise's value, or rejects after `ms`. Used for the storage step only.
export function waitAtMost(promise, ms, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimer(() => reject(new Error('timed out')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimer(timer))
}

// The line shown under "Connecting to your Yggltree…" for each step. Empty once synced.
export function stageMessage(stage, { storageTimedOut = false } = {}) {
  if (stage === 'storage') {
    return storageTimedOut
      ? "This browser's storage isn't responding. Trying the relay anyway."
      : "Opening this browser's storage…"
  }
  if (stage === 'socket') return 'Reaching the family relay…'
  if (stage === 'handshake') return "Waiting for your family's data from the relay…"
  return ''
}
