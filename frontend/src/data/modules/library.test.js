import { describe, it, expect } from 'vitest'
import { newFamilyDoc } from '../testing'
import {
  listBooks, saveBook, convertToOwned, deleteBook, lookupIsbn,
  saveReadingProgress, deleteReadingProgress, readingList,
  listLoans, saveLoan, returnLoan, deleteLoan,
} from './library'

describe('books', () => {
  it('validates, filters by status, drops non-Open-Library covers, converts to owned', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const wish = saveBook(doc, admin, { title: 'Dune', status: 'want_to_read', cover_url: 'https://evil.example/x.jpg' })
    saveBook(doc, admin, { title: 'Anne', cover_url: 'https://covers.openlibrary.org/b/id/1-M.jpg', format: 'ebook' })
    expect(listBooks(doc, 'want_to_read').map((b) => b.title)).toEqual(['Dune'])
    expect(listBooks(doc).find((b) => b.id === wish)).toMatchObject({ cover_url: null, format: 'physical', added_by_member_id: admin.id })
    expect(() => saveBook(doc, admin, { title: 'x', format: 'scroll' })).toThrow('format must be physical, ebook or audiobook')
    expect(() => saveBook(doc, admin, { title: 'x', owner_member_id: 'ghost' })).toThrow('owner_member_id must be a real member of this family')
    convertToOwned(doc, { id: wish, owner_member_id: kid.id, isbn: '9780441013593' })
    expect(listBooks(doc, 'owned').find((b) => b.id === wish)).toMatchObject({ owner_member_id: kid.id, isbn: '9780441013593' })
  })

  it('deleting a book removes reading progress and unlinks loans', () => {
    const { doc, admin } = newFamilyDoc()
    const id = saveBook(doc, admin, { title: 'Dune' })
    saveReadingProgress(doc, admin, { book_id: id, status: 'reading', progress_pct: 40 })
    const loan = saveLoan(doc, admin, { book_id: id, direction: 'lent_out', counterparty_name: 'Aunt May' })
    deleteBook(doc, id)
    expect(readingList(doc)).toEqual([])
    expect(listLoans(doc).find((l) => l.id === loan)).toMatchObject({ book_id: null, book_title: null })
  })
})

describe('reading progress', () => {
  it('one record per member per book, with start/finish timestamps', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const book = saveBook(doc, admin, { title: 'Dune' })
    const id = saveReadingProgress(doc, kid, { book_id: book, status: 'reading', progress_pct: 10 })
    expect(saveReadingProgress(doc, kid, { book_id: book, status: 'finished', rating: 5, progress_pct: 90 })).toBe(id)
    const row = readingList(doc)[0]
    expect(row).toMatchObject({ status: 'finished', rating: 5, progress_pct: null, member_name: 'Kit Kid', book_title: 'Dune' })
    expect(row.started_at).toMatch(/^\d{4}-/)
    expect(row.finished_at).toMatch(/^\d{4}-/)
    expect(() => saveReadingProgress(doc, kid, { book_id: book, rating: 6 })).toThrow('rating must be between 1 and 5')
    deleteReadingProgress(doc, admin, id) // not theirs: ignored
    expect(readingList(doc)).toHaveLength(1)
    deleteReadingProgress(doc, kid, id)
    expect(readingList(doc)).toEqual([])
  })
})

describe('loans', () => {
  it('orders open loans by due date and returns them', () => {
    const { doc, admin } = newFamilyDoc()
    const later = saveLoan(doc, admin, { direction: 'borrowed', counterparty_name: 'Library', due_date: '2026-12-01' })
    const sooner = saveLoan(doc, admin, { direction: 'lent_out', counterparty_name: 'Alex', due_date: '2026-10-10' })
    saveLoan(doc, admin, { direction: 'lent_out', counterparty_name: 'Jo' })
    expect(listLoans(doc).map((l) => l.id).slice(0, 2)).toEqual([sooner, later])
    returnLoan(doc, sooner)
    expect(listLoans(doc, { onlyOut: true }).map((l) => l.id)).not.toContain(sooner)
    expect(() => saveLoan(doc, admin, { direction: 'gift', counterparty_name: 'x' })).toThrow('direction must be lent_out or borrowed')
    deleteLoan(doc, later)
    expect(listLoans(doc)).toHaveLength(2)
  })
})

describe('lookupIsbn', () => {
  const reply = (body, ok = true) => async () => ({ ok, json: async () => body })

  it('maps an Open Library hit', async () => {
    const result = await lookupIsbn('978-0-441-01359-3', reply({ docs: [{ title: 'Dune', author_name: ['Frank Herbert'], cover_i: 42 }] }))
    expect(result).toEqual({ found: true, isbn: '9780441013593', title: 'Dune', author: 'Frank Herbert', cover_url: 'https://covers.openlibrary.org/b/id/42-M.jpg' })
  })

  it('reports misses and offline failures without throwing', async () => {
    expect(await lookupIsbn('9780441013593', reply({ docs: [] }))).toEqual({ found: false, isbn: '9780441013593' })
    const offline = async () => { throw new TypeError('Failed to fetch') }
    expect(await lookupIsbn('9780441013593', offline)).toEqual({ found: false, isbn: '9780441013593', error: 'lookup_failed' })
    await expect(lookupIsbn('123')).rejects.toThrow('Enter a valid ISBN')
  })
})
