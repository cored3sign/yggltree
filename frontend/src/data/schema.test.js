import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { isSetUp, setUpFamily, DEFAULT_CHECKIN_PROMPTS } from './schema'
import { getMember } from './members'
import { getSettings } from './settings'
import { all } from './collection'
import { syncDocs } from './testing'

describe('setUpFamily', () => {
  it('creates settings, an admin and the default check-in prompts', () => {
    const doc = new Y.Doc()
    expect(isSetUp(doc)).toBe(false)
    const adminId = setUpFamily(doc, { familyName: 'Smith', adminName: 'Alex' })
    expect(isSetUp(doc)).toBe(true)
    expect(getMember(doc, adminId)).toMatchObject({ name: 'Alex', role: 'admin', nav_pinned: ['todos', 'shopping'] })
    expect(getSettings(doc)).toMatchObject({ family_name: 'Smith', week_start_day: 'sunday' })
    expect(all(doc, 'checkin_prompts')).toHaveLength(DEFAULT_CHECKIN_PROMPTS.length)
  })

  it('validates before writing anything (no rollback in Yjs)', () => {
    const doc = new Y.Doc()
    expect(() => setUpFamily(doc, { familyName: 'Smith', adminName: ' ' })).toThrow('Your name is required')
    expect(isSetUp(doc)).toBe(false)
    expect(doc.getMap('settings').size).toBe(0)
  })

  it('a second device that synced the doc sees it as set up', () => {
    const a = new Y.Doc()
    setUpFamily(a, { familyName: 'Smith', adminName: 'Alex' })
    const b = new Y.Doc()
    syncDocs(a, b)
    expect(isSetUp(b)).toBe(true)
  })

  it('seeded prompts use deterministic ids so two seedings merge', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    setUpFamily(a, { familyName: 'A', adminName: 'Alex' })
    setUpFamily(b, { familyName: 'A', adminName: 'Alex' })
    syncDocs(a, b)
    expect(all(a, 'checkin_prompts')).toHaveLength(DEFAULT_CHECKIN_PROMPTS.length)
  })
})
