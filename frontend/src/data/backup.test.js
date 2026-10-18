import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { openFamily } from './family'
import { setUpFamily } from './schema'
import { insert, get, all } from './collection'
import { putAsset, getAsset } from './assets'
import { createBackup, parseBackup, restoreBackup, exportJson } from './backup'

describe('backup', () => {
  it('round-trips main and asset docs through the backup file', () => {
    const doc = new Y.Doc()
    const assets = new Y.Doc()
    setUpFamily(doc, { familyName: 'Smith', adminName: 'Alex' })
    insert(doc, 'todos', { title: 'Dishes' }, 't1')
    const photo = putAsset(assets, new Uint8Array([5, 6]), 'image/jpeg')
    const parsed = parseBackup(createBackup({ doc, assets }))
    const doc2 = new Y.Doc()
    const assets2 = new Y.Doc()
    Y.applyUpdate(doc2, parsed.main)
    Y.applyUpdate(assets2, parsed.assets)
    expect(get(doc2, 'todos', 't1').title).toBe('Dishes')
    expect(getAsset(assets2, photo).data).toEqual(new Uint8Array([5, 6]))
  })

  it('rejects files that are not family backups', () => {
    expect(() => parseBackup('hello')).toThrow('That file is not a Yggltree backup')
    const empty = createBackup({ doc: new Y.Doc(), assets: new Y.Doc() })
    expect(() => parseBackup(empty)).toThrow('That backup has no family in it')
  })

  it('restore replaces what is stored in IndexedDB', async () => {
    const opts = { dbName: 'restore-main', assetsDbName: 'restore-assets' }
    const live = await openFamily(opts)
    setUpFamily(live.doc, { familyName: 'Old', adminName: 'Alex' })
    insert(live.doc, 'todos', { title: 'Old todo' }, 'old')

    const source = new Y.Doc()
    setUpFamily(source, { familyName: 'New', adminName: 'Alex' })
    insert(source, 'todos', { title: 'New todo' }, 'new')
    const parsed = parseBackup(createBackup({ doc: source, assets: new Y.Doc() }))

    await restoreBackup(parsed, { current: live, ...opts })
    const reopened = await openFamily(opts)
    expect(get(reopened.doc, 'todos', 'old')).toBe(null)
    expect(get(reopened.doc, 'todos', 'new').title).toBe('New todo')
    await reopened.destroy()
  })

  it('JSON export includes settings and every collection', () => {
    const doc = new Y.Doc()
    setUpFamily(doc, { familyName: 'Smith', adminName: 'Alex' })
    const out = exportJson(doc)
    expect(out.settings.family_name).toBe('Smith')
    expect(out.collections.members).toHaveLength(1)
    expect(out.collections.checkin_prompts).toHaveLength(all(doc, 'checkin_prompts').length)
  })
})
