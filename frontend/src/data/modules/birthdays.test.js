import { describe, it, expect } from 'vitest'
import { newFamilyDoc, forkDoc, syncDocs } from '../testing'
import { insert } from '../collection'
import { listNotifications } from '../notifications'
import { ageOn, celebrationDate, celebrationsInMonth, deleteBirthday, listBirthdays, nextCelebration, recordBirthdayReminders, saveBirthday } from './birthdays'

const TODAY = '2026-10-15'

function birthdayReminders(doc, memberId) {
  return listNotifications(doc, memberId).filter((n) => n.type === 'birthday')
}

describe('birthdays: dates', () => {
  it('a 29 February birthday is celebrated on 28 February in years without one', () => {
    expect(celebrationDate({ month: 2, day: 29 }, 2027)).toBe('2027-02-28')
    expect(celebrationDate({ month: 2, day: 29 }, 2028)).toBe('2028-02-29')
  })

  it('the next celebration is today on the day, and next year once it has passed', () => {
    expect(nextCelebration({ month: 10, day: 15 }, TODAY)).toBe('2026-10-15')
    expect(nextCelebration({ month: 10, day: 14 }, TODAY)).toBe('2027-10-14')
    expect(nextCelebration({ month: 1, day: 2 }, '2026-12-31')).toBe('2027-01-02')
  })

  it('age counts from the celebration day, so the day before is still the old age', () => {
    expect(ageOn({ month: 3, day: 14, year: 2018 }, '2026-03-13')).toBe(7)
    expect(ageOn({ month: 3, day: 14, year: 2018 }, '2026-03-14')).toBe(8)
    expect(ageOn({ month: 2, day: 29, year: 2020 }, '2027-02-28')).toBe(7)
  })

  it('no age is given when the year born is not known', () => {
    expect(ageOn({ month: 3, day: 14, year: null }, '2026-03-14')).toBe(null)
  })
})

describe('birthdays: entering them', () => {
  it('needs a name, a month and a day that exist', () => {
    const { doc } = newFamilyDoc()
    expect(() => saveBirthday(doc, { birth_month: 3, birth_day: 14 }, TODAY)).toThrow('name is required')
    expect(() => saveBirthday(doc, { name: 'Ana', birth_day: 14 }, TODAY)).toThrow('Choose the month of the birthday')
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 2, birth_day: 30 }, TODAY)).toThrow('Choose a day that exists in that month')
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 4, birth_day: 31 }, TODAY)).toThrow('Choose a day that exists in that month')
  })

  it('the year born is optional, and must be a real, past year', () => {
    const { doc } = newFamilyDoc()
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 3, birth_day: 14, birth_year: 1850 }, TODAY)).toThrow('between 1900 and 2026')
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 3, birth_day: 14, birth_year: 2027 }, TODAY)).toThrow('between 1900 and 2026')
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 12, birth_day: 1, birth_year: 2026 }, TODAY)).toThrow("can't be in the future")
  })

  it('the age is optional, and must be a whole number from 0 to 130', () => {
    const { doc } = newFamilyDoc()
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 3, birth_day: 14, age: 200 }, TODAY)).toThrow('between 0 and 130')
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 3, birth_day: 14, age: 7.5 }, TODAY)).toThrow('whole numbers')
  })

  it('a year and an age that disagree are refused, and a year and age that agree are accepted', () => {
    const { doc } = newFamilyDoc()
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 10, birth_day: 14, birth_year: 2018, age: 3 }, TODAY)).toThrow("don't match")
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 10, birth_day: 14, birth_year: 2018, age: 8 }, TODAY)).not.toThrow()
  })

  it('a 29 February birthday needs a leap year', () => {
    const { doc } = newFamilyDoc()
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 2, birth_day: 29, birth_year: 2019 }, TODAY)).toThrow('needs a leap year')
    expect(() => saveBirthday(doc, { name: 'Ana', birth_month: 2, birth_day: 29, birth_year: 2020 }, TODAY)).not.toThrow()
  })

  it('with only a month and a day, the birthday is listed without an age', () => {
    const { doc } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ana', birth_month: '3', birth_day: '14' }, TODAY)
    expect(listBirthdays(doc, TODAY)).toEqual([
      expect.objectContaining({ name: 'Ana', birth_month: 3, birth_day: 14, birth_year: null, next_date: '2027-03-14', turns: null }),
    ])
  })

  it('an age fills in the year born, counted from today', () => {
    const { doc } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ben', birth_month: 10, birth_day: 20, age: 8 }, TODAY)
    expect(listBirthdays(doc, TODAY)).toEqual([
      expect.objectContaining({ name: 'Ben', birth_year: 2017, next_date: '2026-10-20', turns: 9, days_until: 5 }),
    ])
  })

  it('lists the soonest first, with the age each person turns', () => {
    const { doc } = newFamilyDoc()
    saveBirthday(doc, { name: 'Zoe', birth_month: 12, birth_day: 1, birth_year: 2019 }, TODAY)
    saveBirthday(doc, { name: 'Ana', birth_month: 10, birth_day: 20, birth_year: 2018 }, TODAY)
    saveBirthday(doc, { name: 'Ben', birth_month: 1, birth_day: 5, birth_year: 2015 }, TODAY)
    expect(listBirthdays(doc, TODAY).map((b) => [b.name, b.next_date, b.turns, b.days_until])).toEqual([
      ['Ana', '2026-10-20', 8, 5],
      ['Zoe', '2026-12-01', 7, 47],
      ['Ben', '2027-01-05', 12, 82],
    ])
  })

  it('can be edited and deleted', () => {
    const { doc } = newFamilyDoc()
    const id = saveBirthday(doc, { name: 'Ana', birth_month: 10, birth_day: 20, birth_year: 2018 }, TODAY)
    saveBirthday(doc, { id, name: 'Ana B', birth_month: 10, birth_day: 21 }, TODAY)
    expect(listBirthdays(doc, TODAY)).toMatchObject([{ name: 'Ana B', birth_month: 10, birth_day: 21, birth_year: null }])
    deleteBirthday(doc, id)
    expect(listBirthdays(doc, TODAY)).toEqual([])
  })
})

describe('birthdays: reminders', () => {
  it('on the day, every family member gets one reminder, and a second check adds none', () => {
    const { doc, admin, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ana', birth_month: 10, birth_day: 15, birth_year: 2018 }, TODAY)
    expect(birthdayReminders(doc, kid.id)).toEqual([
      expect.objectContaining({ type: 'birthday', message: "Today is Ana's birthday, turning 8.", read_at: null }),
    ])
    expect(birthdayReminders(doc, admin.id)).toHaveLength(1)
    expect(recordBirthdayReminders(doc, TODAY)).toBe(0)
    expect(birthdayReminders(doc, kid.id)).toHaveLength(1)
  })

  it('the birthday person does not get a reminder about their own birthday, but everyone else does', () => {
    const { doc, admin, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Kit Kid', birth_month: 10, birth_day: 15, birth_year: 2018, member_id: kid.id }, TODAY)
    expect(birthdayReminders(doc, kid.id)).toEqual([])
    expect(birthdayReminders(doc, admin.id)).toHaveLength(1)
  })

  it('a birthday can be linked only to a real family member', () => {
    const { doc } = newFamilyDoc()
    expect(() => saveBirthday(doc, { name: 'Ghost', birth_month: 10, birth_day: 15, member_id: 'nobody' }, TODAY)).toThrow('member_id must be a real member of this family')
  })

  it('a birthday without a year still gets a reminder, without an age', () => {
    const { doc, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ben', birth_month: 10, birth_day: 15 }, TODAY)
    expect(birthdayReminders(doc, kid.id)).toEqual([expect.objectContaining({ message: "Today is Ben's birthday." })])
  })

  it('a birthday from the last few days is not forgotten, and one from further back gets no reminder', () => {
    const { doc, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ben', birth_month: 10, birth_day: 1, birth_year: 2018 }, TODAY)
    saveBirthday(doc, { name: 'Cal', birth_month: 10, birth_day: 16, birth_year: 2018 }, TODAY)
    expect(birthdayReminders(doc, kid.id)).toEqual([])
  })

  it('a device that was off on the day writes the reminder when it next opens, within six days', () => {
    const { doc, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ana', birth_month: 10, birth_day: 15, birth_year: 2018 }, '2026-10-10')
    expect(recordBirthdayReminders(doc, '2026-10-18')).toBe(2)
    expect(recordBirthdayReminders(doc, '2026-10-18')).toBe(0)
    expect(birthdayReminders(doc, kid.id)).toEqual([expect.objectContaining({ message: 'Ana turned 8 3 days ago.' })])
  })

  it('nothing is written more than six days after the birthday', () => {
    const { doc, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ana', birth_month: 10, birth_day: 15, birth_year: 2018 }, '2026-10-10')
    expect(recordBirthdayReminders(doc, '2026-10-22')).toBe(0)
    expect(birthdayReminders(doc, kid.id)).toEqual([])
  })

  it('a birthday just before New Year is still caught up in January', () => {
    const { doc, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ivy', birth_month: 12, birth_day: 30, birth_year: 2019 }, '2026-12-01')
    expect(recordBirthdayReminders(doc, '2027-01-02')).toBe(2)
    expect(birthdayReminders(doc, kid.id)).toEqual([expect.objectContaining({ message: 'Ivy turned 7 3 days ago.' })])
  })

  it('two devices that both record the day write one reminder per member', () => {
    const { doc, admin, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ana', birth_month: 10, birth_day: 15, birth_year: 2018 }, '2026-10-01')
    const other = forkDoc(doc)
    expect(recordBirthdayReminders(doc, TODAY)).toBe(2)
    expect(recordBirthdayReminders(other, TODAY)).toBe(2)
    syncDocs(doc, other)
    expect(birthdayReminders(doc, kid.id)).toHaveLength(1)
    expect(birthdayReminders(other, admin.id)).toHaveLength(1)
  })

  it('reads an older entry that stored one birth date', () => {
    const { doc } = newFamilyDoc()
    insert(doc, 'birthdays', { name: 'Old Entry', birth_date: '2018-10-20' }, 'legacy')
    expect(listBirthdays(doc, TODAY)).toEqual([expect.objectContaining({ name: 'Old Entry', birth_year: 2018, next_date: '2026-10-20', turns: 8 })])
  })
})

describe('birthdays: calendar', () => {
  it('the birthdays in a month come back soonest first, each with the age on that day', () => {
    const { doc } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ana', birth_month: 10, birth_day: 20, birth_year: 2018 }, TODAY)
    saveBirthday(doc, { name: 'Zoe', birth_month: 10, birth_day: 1, birth_year: 2019 }, TODAY)
    saveBirthday(doc, { name: 'Ben', birth_month: 12, birth_day: 1, birth_year: 2015 }, TODAY)
    expect(celebrationsInMonth(listBirthdays(doc, TODAY), 2026, 10).map((b) => [b.name, b.date, b.turns])).toEqual([
      ['Zoe', '2026-10-01', 7],
      ['Ana', '2026-10-20', 8],
    ])
  })

  it('a 29 February birthday is listed on 28 February in 2027, and on 29 February in 2028', () => {
    const { doc } = newFamilyDoc()
    saveBirthday(doc, { name: 'Leap', birth_month: 2, birth_day: 29, birth_year: 2020 }, TODAY)
    const list = listBirthdays(doc, TODAY)
    expect(celebrationsInMonth(list, 2027, 2)).toEqual([expect.objectContaining({ name: 'Leap', date: '2027-02-28', turns: 7 })])
    expect(celebrationsInMonth(list, 2028, 2)).toEqual([expect.objectContaining({ name: 'Leap', date: '2028-02-29', turns: 8 })])
  })

  it('nothing is listed for a year before the year born', () => {
    const { doc } = newFamilyDoc()
    saveBirthday(doc, { name: 'Early', birth_month: 3, birth_day: 14, birth_year: 2019 }, TODAY)
    expect(celebrationsInMonth(listBirthdays(doc, TODAY), 2018, 3)).toEqual([])
    expect(celebrationsInMonth(listBirthdays(doc, TODAY), 2019, 3)).toEqual([expect.objectContaining({ name: 'Early', turns: 0 })])
  })

  it('a birthday with no year born is listed, with turns null', () => {
    const { doc } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ben', birth_month: 3, birth_day: 14 }, TODAY)
    expect(celebrationsInMonth(listBirthdays(doc, TODAY), 2027, 3)).toEqual([
      expect.objectContaining({ name: 'Ben', date: '2027-03-14', turns: null }),
    ])
  })

  it('an older entry that stored only a birth date is listed too', () => {
    const { doc } = newFamilyDoc()
    insert(doc, 'birthdays', { name: 'Old Entry', birth_date: '2018-10-20' }, 'legacy')
    expect(celebrationsInMonth(listBirthdays(doc, TODAY), 2026, 10)).toEqual([
      expect.objectContaining({ name: 'Old Entry', date: '2026-10-20', turns: 8 }),
    ])
  })
})
