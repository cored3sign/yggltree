import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import { family } from '../data/family'
import { newId } from '../data/ids'
import { setCurrentMemberId } from '../data/session'
import { hasFamily, parseBackup } from '../data/backupFormat.js'
import { bootSync, probeHubInfo, HUB_INFO_TIMEOUT_MS } from '../data/sync/boot.js'
import { createHubApi, HubApiError } from '../data/sync/hubApi.js'
import { applyPairing, planPairing } from '../data/sync/pairing.js'
import { WipeError } from '../data/sync/wipe.js'
import { loadProblem, getLastSyncedAt } from '../data/sync/config.js'
import { deriveSyncStatus, statusCopy } from '../data/sync/status.js'

// Sync store: this device's pairing (role, config, hub info), the pending
// "replace this device's family?" decision, and the live sync status.
//
// The bootSync result, its connection and the hub API stay outside the
// reactive state (they hold sockets and docs); state mirrors what the UI
// needs and is re-derived by a 1 s ticker, online/offline events and the
// connection's 'change' events.

export const ALREADY_SET_UP_MESSAGE = 'Your family is already set up on this hub'
export const REPLACE_WIPE_MESSAGE =
  "Couldn't clear this device's old data. Close any other Yggltree tabs or windows on this device and try again."
const HUB_UNREACHABLE_MESSAGE = "Couldn't reach Yggltree on this computer. Make sure it's running, then try again."

const CLAIM_ID_KEY = 'fh.setupClaimId'
// Hub machine, status "waiting": how often /api/hub/info is re-probed so
// the "isn't running" / "isn't on the hub yet" copy follows the hub.
export const HUB_REPROBE_MS = 15000

function defaultDeps() {
  return {
    bootSync,
    createHubApi,
    applyPairing,
    storage: undefined, // config.js defaults to localStorage
    session: () => globalThis.sessionStorage,
    location: globalThis.location,
    reload: () => globalThis.location.reload(),
    now: () => Date.now(),
    online: () => globalThis.navigator?.onLine !== false,
    clearMemberId: () => setCurrentMemberId(null),
    ticker: true,
    // Where the "leave this page?" warning is installed while stuck.
    unloadTarget: () => globalThis.window,
  }
}

let deps = defaultDeps()

// Test-only: replace any of the dependencies above; null restores them.
export function setSyncDepsForTests(over) {
  setUnloadWarning(false)
  restoreInFlight = false
  deps = over ? { ...defaultDeps(), ...over } : defaultDeps()
}

// Non-reactive runtime pieces (one app per page, so module scope is fine).
let boot = null // the live bootSync result
let api = null
let bootedAt = 0
let teardown = []
// The hub's answer to a restore whose local wipe then failed, so Retry
// only redoes the wipe instead of restoring into yet another room.
let restored = null
// Hub-machine re-probe while waiting: when the last probe started (boot's
// own probe counts), whether one is in flight, and which boot it belongs to.
let lastProbeAt = 0
let probing = false
let probeGen = 0
let probeMisses = 0
// A restore through the hub is under way (from the hub call until the
// success reload, or until it fails): no re-probe or re-boot may swap the
// page out from under it.
let restoreInFlight = false
// While a wipe is stuck (replaceStuck / restoreStuck) the open family is
// destroyed and only Retry can finish the job; a reload or a closed tab
// would lose the in-memory copy. One beforeunload listener, central here so
// /connect and Settings share it; removed before the success reload.
let unloadListener = null
let unloadTarget = null

function onBeforeUnload(event) {
  event.preventDefault()
  event.returnValue = '' // older browsers need returnValue set
  return ''
}

function setUnloadWarning(on) {
  if (on && !unloadListener) {
    const target = deps.unloadTarget?.()
    if (!target?.addEventListener) return
    target.addEventListener('beforeunload', onBeforeUnload)
    unloadListener = onBeforeUnload
    unloadTarget = target
  } else if (!on && unloadListener) {
    unloadTarget.removeEventListener('beforeunload', unloadListener)
    unloadListener = null
    unloadTarget = null
  }
}

export const RESTORE_IN_PROGRESS_MESSAGE =
  'A restore is still finishing on this computer. Press Retry to finish it before restoring another file.'

function hubApi() {
  if (!api) api = createHubApiFor()
  return api
}

function createHubApiFor() {
  return deps.createHubApi({ baseUrl: deps.location?.origin ?? '' })
}

// The claim id survives reloads of this tab (a repeat of the same id is
// accepted by the hub) but is not shared with other tabs or browsers.
function claimId() {
  let session = null
  try {
    session = deps.session()
    const existing = session?.getItem(CLAIM_ID_KEY)
    if (existing) return existing
  } catch {
    session = null
  }
  const id = newId()
  try {
    session?.setItem(CLAIM_ID_KEY, id)
  } catch {
    // sessionStorage blocked: this id lasts for this page only
  }
  return id
}

function restoreFailedError(err) {
  let message = "Couldn't reach Yggltree on this computer to restore. Make sure it's running, then try again."
  if (err instanceof HubApiError && err.status === 413) message = 'That backup file is too large for the hub.'
  else if (err instanceof HubApiError && err.status === 400) message = "The hub couldn't read that backup file."
  else if (err instanceof HubApiError) message = `The hub couldn't restore the backup (error ${err.status}).`
  const e = new Error(message)
  e.cause = err
  return e
}

// The ticker re-reads every second; only assign when something changed.
function sameJson(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function friendlyWipeError(err) {
  if (err instanceof WipeError) {
    const e = new Error(REPLACE_WIPE_MESSAGE)
    e.cause = err
    return e
  }
  return err
}

export const useSyncStore = defineStore('sync', {
  state: () => ({
    role: 'unpaired',
    config: null,
    hubInfo: null,
    problem: null,
    status: 'connecting',
    statusCopy: statusCopy('connecting'),
    // The relay connection's current step (see data/relay/stage.js), for the connecting screen.
    relayStage: null,
    storageTimedOut: false,
    pendingReplace: null,
    // A confirm-replace entered the wipe and failed: the open family has
    // been destroyed (and a database may be gone), so the app must not
    // resume -- only Retry, or download a backup of what's still in memory.
    replaceStuck: false,
    // Same, for a restore through the hub: the hub already moved the family
    // to a new room and this browser's wipe failed. Only Retry
    // (retryRestore, which reuses the hub's answer) or a backup download.
    restoreStuck: false,
    lastSyncedAt: null,
    online: true,
  }),

  getters: {
    isHubMachine: (state) => state.role === 'hub-machine',
    canSetUp: (state) => state.role === 'hub-machine' && state.hubInfo?.familyExists === false,
    stuck: (state) => state.replaceStuck || state.restoreStuck,
  },

  actions: {
    // Runs once before mount. Never throws: editing is never blocked.
    async boot() {
      this.stop()
      api = null
      restored = null
      bootedAt = deps.now()
      lastProbeAt = bootedAt
      probing = false
      probeGen++
      probeMisses = 0
      restoreInFlight = false
      this.online = deps.online()
      try {
        boot = await deps.bootSync({ fam: family(), location: deps.location, storage: deps.storage })
      } catch (err) {
        console.error('Yggltree sync could not start:', err)
        boot = null
      }
      if (boot) {
        this.role = boot.role
        this.hubInfo = boot.hubInfo ? markRaw({ ...boot.hubInfo }) : null
        this.pendingReplace = boot.pendingReplace
        if (boot.connection) {
          const off = boot.connection.on('change', () => this.refreshStatus())
          teardown.push(off)
        }
      }
      this.watchEnvironment()
      this.refreshStatus()
    },

    watchEnvironment() {
      const w = globalThis.window
      if (w?.addEventListener) {
        const onOnline = () => this.setOnline(true)
        const onOffline = () => this.setOnline(false)
        w.addEventListener('online', onOnline)
        w.addEventListener('offline', onOffline)
        teardown.push(() => {
          w.removeEventListener('online', onOnline)
          w.removeEventListener('offline', onOffline)
        })
      }
      if (deps.ticker) {
        const timer = setInterval(() => this.refreshStatus(), 1000)
        teardown.push(() => clearInterval(timer))
      }
    },

    // Test hook and teardown: stops the ticker and listeners, and drops
    // any re-probe in flight (its answer is ignored; the next may start).
    stop() {
      for (const fn of teardown.splice(0)) fn()
      probeGen++
      probing = false
    },

    setOnline(value) {
      this.online = value
      this.refreshStatus()
    },

    refreshStatus() {
      const opts = { storage: deps.storage }
      const config = boot?.config ?? null
      if (!sameJson(this.config, config)) this.config = config ? { ...config } : null
      const snap = boot?.connection && !boot.connection.destroyed ? boot.connection.snapshot() : null
      let problem = loadProblem(opts)
      // A flag from another room (e.g. before a re-pair) is not this room's problem.
      if (problem && config && problem.roomId !== config.roomId) problem = null
      if (!sameJson(this.problem, problem)) this.problem = problem
      this.lastSyncedAt = snap?.lastSyncedAt ?? getLastSyncedAt(opts)
      this.relayStage = snap?.stage ?? null
      this.storageTimedOut = !!snap?.storageTimedOut
      const status = deriveSyncStatus({
        hasConfig: !!config,
        problem: this.problem,
        online: this.online,
        mainSynced: !!snap?.mainSynced,
        connectingSinceMs: snap?.attemptStartedAt ?? bootedAt,
        nowMs: deps.now(),
        role: this.role,
      })
      const copy = statusCopy(status, { role: this.role, problem: this.problem, hubRunning: !!this.hubInfo, hasConnection: !!snap })
      if (status !== this.status || copy.message !== this.statusCopy.message) {
        this.status = status
        this.statusCopy = copy
      }
      if (this.role === 'hub-machine') {
        // The family reached the hub: the setup claim has done its job.
        // Forgetting the id means a duplicated tab (which copies
        // sessionStorage) can't reuse it.
        if (status === 'connected' && hasFamily(family().doc)) this.releaseClaimId()
      }
      if (status === 'waiting' && this.role === 'hub-machine') this.reprobeHub()
    },

    // hubInfo is first read at boot; while the hub machine waits, re-probe
    // it (the 1.5 s loopback probe) at most every HUB_REPROBE_MS, so the
    // copy tracks a hub that was started or stopped since. hubInfo goes
    // null ("isn't running") only after two misses in a row, so one slow
    // answer doesn't bounce the hub machine off /setup (canSetUp).
    //
    // Never while a wipe is stuck or a restore is under way: a changed
    // hubInfo (canSetUp) would swap /setup out mid-restore.
    // When the hub comes back and this browser has no live connection,
    // sync boots again, so setup / adopt / the pull happen without a reload.
    reprobeHub() {
      const now = deps.now()
      if (this.stuck || restoreInFlight) return
      if (probing || now - lastProbeAt < HUB_REPROBE_MS) return
      probing = true
      lastProbeAt = now
      const gen = probeGen
      return probeHubInfo(hubApi(), HUB_INFO_TIMEOUT_MS).then((info) => {
        if (gen !== probeGen) return
        probing = false
        if (this.stuck || restoreInFlight) return
        probeMisses = info ? 0 : probeMisses + 1
        if (!info && probeMisses < 2) return
        const cameBack = !!info && !this.hubInfo
        if (!sameJson(this.hubInfo, info)) this.hubInfo = info ? markRaw({ ...info }) : null
        const live = boot?.connection && !boot.connection.destroyed
        if (cameBack && !live && !this.pendingReplace) return this.boot({})
        this.refreshStatus()
      })
    },

    // POST /api/hub/claim before this browser may seed the family (the
    // seeding invariant). Throws ALREADY_SET_UP_MESSAGE on 409.
    async claimForSetup() {
      if (this.role !== 'hub-machine') throw new Error('Families are set up on the family computer.')
      try {
        await hubApi().claim(claimId())
      } catch (err) {
        if (err instanceof HubApiError && err.status === 409) throw new Error(ALREADY_SET_UP_MESSAGE)
        if (err instanceof HubApiError) throw new Error(`Yggltree couldn't start setup (error ${err.status}).`)
        throw new Error(HUB_UNREACHABLE_MESSAGE)
      }
    },

    // Called once the family has synced to the hub (refreshStatus), not
    // right after seeding: until then a hub restart may need the same claim
    // again from this tab.
    releaseClaimId() {
      try {
        deps.session()?.removeItem(CLAIM_ID_KEY)
      } catch {
        // sessionStorage blocked: nothing stored
      }
    },

    // The user confirmed the pending replace.
    //   adopt: claim the empty hub room, then save it WITHOUT wiping;
    //                the reload connects and uploads this browser's family.
    //   otherwise: wipe this device's family, save the new room, reload
    //                and pull. The old fh.memberId belongs to the old family.
    // On failure nothing is saved and pendingReplace stays, so the same
    // call can be retried. A WipeError gets REPLACE_WIPE_MESSAGE.
    async confirmReplace() {
      const p = this.pendingReplace
      if (!p) return
      const opts = { incoming: p.incoming, hubUrl: p.hubUrl, role: p.role, storage: deps.storage }
      if (p.adopt) {
        await this.claimForSetup() // throws on 409: no config is saved
        await deps.applyPairing({ ...opts, plan: 'adopt', claimed: true })
      } else {
        try {
          await deps.applyPairing({ ...opts, plan: 'confirm-replace', current: family() })
        } catch (err) {
          this.setStuck('replace', true)
          throw friendlyWipeError(err)
        }
        this.setStuck('replace', false)
        deps.clearMemberId()
      }
      deps.reload()
    },

    // Keep this device's own family. A device with a stored room reloads and
    // reconnects to it; otherwise the app just runs unsynced for now.
    // After a failed wipe (replaceStuck) the open family is destroyed, so
    // this never resumes the app: it reloads (the UI warns first).
    cancelReplace() {
      if (this.replaceStuck) {
        deps.reload()
        return
      }
      this.pendingReplace = null
      if (boot) boot.pendingReplace = null
      if (boot?.config && boot.role !== 'hub-machine') deps.reload()
      else this.refreshStatus()
    },

    // kind: 'replace' | 'restore'. Keeps the beforeunload warning in step.
    setStuck(kind, value) {
      if (kind === 'replace') this.replaceStuck = value
      else this.restoreStuck = value
      setUnloadWarning(this.replaceStuck || this.restoreStuck)
    },

    // Restore a backup file through the hub (a new room and token).
    // Order: parse locally, stop syncing the old room, restore on the hub,
    // then wipe + save the new room (applyPairing confirm-replace), reload.
    // If the wipe fails after the hub restored, restoreStuck is set and the
    // page must offer only Retry (retryRestore) and a backup download.
    async restoreOnHub(file) {
      const text = await file.text()
      parseBackup(text) // throws on a bad file, before anything changes
      if (this.restoreStuck && restored?.text !== text) throw new Error(RESTORE_IN_PROGRESS_MESSAGE)
      if (restored?.text !== text) {
        restoreInFlight = true
        boot?.connection?.destroy()
        let result
        try {
          result = await hubApi().restore(text)
        } catch (err) {
          // Nothing changed on the hub: boot sync again (fresh connection,
          // same handlers) so this page doesn't sit with no sync.
          restoreInFlight = false
          await this.boot({})
          throw restoreFailedError(err)
        }
        restored = { text, result }
      }
      return this.finishRestore()
    },

    // Setup's "Restore from a backup file": claim the hub first (the
    // seeding invariant) -- unless a restore already reached the hub and
    // only this browser's part is left (stuck, or retried): its new room
    // holds a family, so a claim would 409. Then it is a plain retry.
    async restoreForSetup(file) {
      if (!this.restoreStuck && !restored) await this.claimForSetup()
      return this.restoreOnHub(file)
    },

    // Retry after a failed wipe: reuses the hub's answer, never restores
    // into another room.
    async retryRestore() {
      if (!restored) throw new Error('There is no restore to retry.')
      return this.finishRestore()
    },

    // Wipe this browser's old family and save the restored room, then reload.
    async finishRestore() {
      const { roomId, token } = restored.result
      restoreInFlight = true
      try {
        await deps.applyPairing({
          plan: 'confirm-replace',
          incoming: { roomId, token, familyExists: true },
          hubUrl: deps.location.origin,
          role: 'hub-machine',
          current: family(),
          storage: deps.storage,
        })
      } catch (err) {
        restoreInFlight = false // restoreStuck covers it from here
        this.setStuck('restore', true)
        throw friendlyWipeError(err)
      }
      this.setStuck('restore', false)
      // restoreInFlight stays set: the page is reloading.
      deps.reload()
    },
  },
})
