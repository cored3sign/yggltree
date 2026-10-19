// The terminal PIN reset: the token, clearing admin PINs in the family doc,
// and the route that needs the token on top of the usual admin guard.
import { describe, it, expect, afterEach } from 'vitest'
import { stat } from 'node:fs/promises'
import * as Y from 'yjs'
import { setUpFamily } from '../../frontend/src/data/schema.js'
import {
  RESET_HEADER,
  RESET_TOKEN_FILE,
  createResetToken,
  readResetToken,
  resetAdminPins,
  resetTokenMatches,
} from '../src/adminPin.js'
import { createFixtures, httpCall, ADMIN_HEADERS } from './helpers.js'
import { join } from 'node:path'

const fx = createFixtures()
afterEach(() => fx.cleanup())

function adminRecords(doc) {
  return [...doc.getMap('members').values()].filter((m) => m.get('role') === 'admin')
}

describe('resetAdminPins', () => {
  it('clears every admin PIN, names the admins, and leaves other members alone', () => {
    const doc = new Y.Doc()
    setUpFamily(doc, { familyName: 'Smith', adminName: 'Alex', modules: ['todos'] })
    for (const admin of adminRecords(doc)) admin.set('pin_hash', 'set-by-admin')
    const member = new Y.Map()
    member.set('name', 'Alex')
    member.set('role', 'member')
    member.set('pin_hash', 'not-an-admin')
    doc.getMap('members').set('member-alex', member)

    expect(resetAdminPins(doc)).toEqual(['Alex'])
    expect(adminRecords(doc).every((m) => m.get('pin_hash') === null && m.get('pin_salt') === null)).toBe(true)
    expect(member.get('pin_hash')).toBe('not-an-admin')
  })

  it('does nothing harmful for a doc with no members', () => {
    expect(resetAdminPins(new Y.Doc())).toEqual([])
  })
})

describe('the reset token', () => {
  // Windows doesn't keep Unix file modes. The file sits in the user's own profile folder, which only that user can read.
  it.skipIf(process.platform === 'win32')('is written owner-only, and a new one replaces it on each start', async () => {
    const dir = await fx.tmpDir()
    const first = await createResetToken(dir)
    const mode = (await stat(join(dir, RESET_TOKEN_FILE))).mode & 0o777
    expect(mode).toBe(0o600)
    expect(await readResetToken(dir)).toBe(first)
    const second = await createResetToken(dir)
    expect(second).not.toBe(first)
    expect(await readResetToken(dir)).toBe(second)
  })

  it('reads as null when there is no token file', async () => {
    expect(await readResetToken(await fx.tmpDir())).toBe(null)
  })

  it('matches only the exact token', () => {
    expect(resetTokenMatches('abc123', 'abc123')).toBe(true)
    expect(resetTokenMatches('abc123', 'abc124')).toBe(false)
    expect(resetTokenMatches('abc123', 'abc12')).toBe(false)
    expect(resetTokenMatches('abc123', undefined)).toBe(false)
    expect(resetTokenMatches(null, null)).toBe(false)
    expect(resetTokenMatches('', '')).toBe(false)
  })
})

describe('POST /api/admin/reset-pin', () => {
  async function hubWithAdminPin() {
    const dataDir = await fx.tmpDir()
    const hub = await fx.hub({ dataDir })
    const doc = await hub._debug.doc('main')
    setUpFamily(doc, { familyName: 'Smith', adminName: 'Alex', modules: ['todos'] })
    for (const admin of adminRecords(doc)) admin.set('pin_hash', 'set-by-admin')
    return { hub, doc, dataDir }
  }

  it('refuses without the reset token, even with the admin headers', async () => {
    const { hub, doc } = await hubWithAdminPin()
    const res = await httpCall(hub.port, { method: 'POST', path: '/api/admin/reset-pin', headers: ADMIN_HEADERS, body: {} })
    expect(res.status).toBe(403)
    expect(adminRecords(doc).every((m) => m.get('pin_hash') === 'set-by-admin')).toBe(true)
  })

  it('refuses a wrong token', async () => {
    const { hub, doc } = await hubWithAdminPin()
    const res = await httpCall(hub.port, {
      method: 'POST',
      path: '/api/admin/reset-pin',
      headers: { ...ADMIN_HEADERS, [RESET_HEADER]: 'not-the-token' },
      body: {},
    })
    expect(res.status).toBe(403)
    expect(adminRecords(doc).every((m) => m.get('pin_hash') === 'set-by-admin')).toBe(true)
  })

  it('clears the admin PINs with the right token, and reports the admins', async () => {
    const { hub, doc, dataDir } = await hubWithAdminPin()
    const token = await readResetToken(dataDir)
    const res = await httpCall(hub.port, {
      method: 'POST',
      path: '/api/admin/reset-pin',
      headers: { ...ADMIN_HEADERS, [RESET_HEADER]: token },
      body: {},
    })
    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true, admins: ['Alex'] })
    expect(adminRecords(doc).every((m) => m.get('pin_hash') === null)).toBe(true)
  })

  it('still needs the usual admin headers', async () => {
    const { hub, dataDir } = await hubWithAdminPin()
    const token = await readResetToken(dataDir)
    const res = await httpCall(hub.port, {
      method: 'POST',
      path: '/api/admin/reset-pin',
      headers: { [RESET_HEADER]: token, 'x-family-hub-admin': '1' },
      body: {},
    })
    expect(res.status).toBe(403)
  })
})
