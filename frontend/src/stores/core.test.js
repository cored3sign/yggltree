import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as Y from 'yjs'
import { memoryStorage, newFamilyDoc } from '../data/testing'
import { setFamilyForTests } from '../data/family'
import { isSetUp } from '../data/schema'
import { listMembers } from '../data/members'
import { HubApiError } from '../data/sync/hubApi.js'
import { useCoreStore } from './core'
import { useSyncStore, setSyncDepsForTests } from './sync'

let claimAnswer
let claims
let session

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('document', { documentElement: { setAttribute() {}, removeAttribute() {} } })
  claimAnswer = 200
  claims = []
  session = memoryStorage()
  setSyncDepsForTests({
    bootSync: async () => ({ role: 'hub-machine', config: null, hubInfo: { familyExists: false }, pendingReplace: null, connection: null }),
    createHubApi: () => ({
      claim: async (id) => {
        claims.push(id)
        if (claimAnswer === 409) throw new HubApiError(409, 'conflict')
        return { ok: true }
      },
    }),
    storage: memoryStorage(),
    session: () => session,
    location: { origin: 'http://localhost:8787', hostname: 'localhost' },
    online: () => true,
    ticker: false,
  })
})

afterEach(() => {
  useSyncStore().stop()
  setSyncDepsForTests(null)
  setFamilyForTests(null)
  vi.unstubAllGlobals()
})

describe('core.createFamily', () => {
  it('claims on the hub first, then seeds and selects the admin', async () => {
    const doc = new Y.Doc()
    setFamilyForTests({ doc, assets: new Y.Doc() })
    await useSyncStore().boot({})
    const core = useCoreStore()
    core.start()
    await core.createFamily({ familyName: 'Test Family', adminName: 'Pat Parent' })
    expect(claims).toHaveLength(1)
    expect(isSetUp(doc)).toBe(true)
    expect(core.familyReady).toBe(true)
    expect(core.memberId).toBe(listMembers(doc)[0].id)
  })

  it('keeps the claim id after creating the family (released once it has synced to the hub)', async () => {
    setFamilyForTests({ doc: new Y.Doc(), assets: new Y.Doc() })
    await useSyncStore().boot({})
    useCoreStore().start()
    await useCoreStore().createFamily({ familyName: 'Test Family', adminName: 'Pat Parent' })
    expect(session.getItem('fh.setupClaimId')).toBe(claims[0])
  })

  it('a family that synced in while claiming (duplicated tab) is not seeded twice', async () => {
    const { doc } = newFamilyDoc()
    setFamilyForTests({ doc, assets: new Y.Doc() })
    await useSyncStore().boot({})
    const core = useCoreStore()
    const before = listMembers(doc).length
    await expect(core.createFamily({ familyName: 'Other', adminName: 'Alex' })).rejects.toThrow('Your family is already set up on this hub')
    expect(listMembers(doc)).toHaveLength(before)
    expect(claims).toHaveLength(1)
  })

  it('a 409 claim never seeds the doc', async () => {
    claimAnswer = 409
    const doc = new Y.Doc()
    setFamilyForTests({ doc, assets: new Y.Doc() })
    await useSyncStore().boot({})
    const core = useCoreStore()
    core.start()
    await expect(core.createFamily({ familyName: 'Test Family', adminName: 'Pat Parent' })).rejects.toThrow('Your family is already set up on this hub')
    expect(isSetUp(doc)).toBe(false)
    expect(core.familyReady).toBe(false)
  })

  it('blank names fail before any claim is taken', async () => {
    setFamilyForTests({ doc: new Y.Doc(), assets: new Y.Doc() })
    await useSyncStore().boot({})
    await expect(useCoreStore().createFamily({ familyName: ' ', adminName: 'Pat' })).rejects.toThrow('Family name is required')
    expect(claims).toHaveLength(0)
  })
})

describe('core: stale member id', () => {
  it('an fh.memberId that is not in this family resolves to no member', () => {
    const { doc } = newFamilyDoc()
    setFamilyForTests({ doc, assets: new Y.Doc() })
    localStorage.setItem('fh.memberId', 'member-from-a-replaced-family')
    const core = useCoreStore()
    core.start()
    expect(core.familyReady).toBe(true)
    expect(core.memberId).toBeNull()
    expect(core.isAuthenticated).toBe(false)
  })
})
