import { all, byText, get, insert, patch, remove, requireText } from '../collection'
import { getMember, listMembers } from '../members'

const T = 'birthdays'
const NOTIFICATIONS = 'notifications'
export const REMINDER_TYPE = 'birthday'

// A reminder is written on the day, and on any of the six days after it. That covers a family whose devices were
// all off on the birthday: the first device opened in that week writes it.
const CATCH_UP_DAYS = 6
const DAY_MS = 86400000
// February allows 29 days because the year may not be known; a stated year is checked against it.
const MONTH_LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function pad(n) {
  return String(n).padStart(2, '0')
}

// "Today" is the device's own date, the same way the calendar works it out.
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

// A birthday is stored as a month, a day, and optionally the year born. Older entries kept one YYYY-MM-DD
// `birth_date`, and are read the same way.
export function birthdayParts(row) {
  if (row.birth_month != null) return { month: row.birth_month, day: row.birth_day, year: row.birth_year ?? null }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.birth_date ?? '')
  return match ? { month: Number(match[2]), day: Number(match[3]), year: Number(match[1]) } : null
}

// The day a birthday is celebrated in a given year. A 29 February birthday is celebrated on 28 February in years
// without one.
export function celebrationDate({ month, day }, year) {
  const celebrated = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day
  return `${year}-${pad(month)}-${pad(celebrated)}`
}

// The next celebration on or after `today`, as YYYY-MM-DD.
export function nextCelebration(parts, today = todayIso()) {
  const year = Number(today.slice(0, 4))
  const thisYear = celebrationDate(parts, year)
  return thisYear >= today ? thisYear : celebrationDate(parts, year + 1)
}

// The age someone is on a date, or null when the year they were born isn't known. The birthday counts from its
// celebration day, so the day before is still the old age.
export function ageOn(parts, date) {
  if (parts.year == null) return null
  const year = Number(date.slice(0, 4))
  return year - parts.year - (date < celebrationDate(parts, year) ? 1 : 0)
}

function daysBetween(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS)
}

// A whole number from a form field: null when the field is blank, NaN when it's not a whole number.
function wholeNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isInteger(n) ? n : NaN
}

// The year born that gives `age` today. A birthday that hasn't come round yet this year is one year further off.
function birthYearFromAge(month, day, age, today) {
  const thisYear = Number(today.slice(0, 4))
  const passed = celebrationDate({ month, day }, thisYear) <= today
  return thisYear - age - (passed ? 0 : 1)
}

// Checks a birthday form and returns the fields to store. The year born and the age are both optional; an age
// fills in the year born.
export function validateBirthday(input, today = todayIso()) {
  const name = requireText(input.name, 'name is required')
  const month = wholeNumber(input.birth_month)
  const day = wholeNumber(input.birth_day)
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Choose the month of the birthday')
  if (!Number.isInteger(day) || day < 1 || day > MONTH_LENGTHS[month - 1]) throw new Error('Choose a day that exists in that month')

  const thisYear = Number(today.slice(0, 4))
  const year = wholeNumber(input.birth_year)
  const age = wholeNumber(input.age)
  if (Number.isNaN(year) || Number.isNaN(age)) throw new Error('The year born and the age must be whole numbers')
  if (year !== null && (year < 1900 || year > thisYear)) throw new Error(`The year born must be between 1900 and ${thisYear}`)
  if (age !== null && (age < 0 || age > 130)) throw new Error('The age must be between 0 and 130')

  let birthYear = year
  if (age !== null) {
    const fromAge = birthYearFromAge(month, day, age, today)
    if (year !== null && year !== fromAge) throw new Error("The year born and the age don't match")
    birthYear = fromAge
  }
  if (birthYear !== null && month === 2 && day === 29 && !isLeapYear(birthYear)) {
    throw new Error(`A 29 February birthday needs a leap year, and ${birthYear} isn't one`)
  }
  if (birthYear !== null && `${birthYear}-${pad(month)}-${pad(day)}` > today) throw new Error("The birthday can't be in the future")

  return { name, birth_month: month, birth_day: day, birth_year: birthYear, member_id: input.member_id || null }
}

// Adds or edits a birthday (`input.id` makes it an edit). Any reminder due now is written straight away, so a
// birthday entered on the day still gets its reminder.
export function saveBirthday(doc, input, today = todayIso()) {
  const fields = validateBirthday(input, today)
  if (fields.member_id && !getMember(doc, fields.member_id)) throw new Error('member_id must be a real member of this family')
  let id = input.id
  if (id) {
    if (!get(doc, T, id)) throw new Error('Birthday not found')
    patch(doc, T, id, { ...fields, birth_date: null })
  } else {
    id = insert(doc, T, fields)
  }
  recordBirthdayReminders(doc, today)
  return id
}

export function deleteBirthday(doc, id) {
  remove(doc, T, id)
}

// Every birthday with its next celebration, the age that makes them (null when the year born is unknown), and how
// many days away it is. Soonest first.
export function listBirthdays(doc, today = todayIso()) {
  return all(doc, T)
    .map((row) => ({ row, parts: birthdayParts(row) }))
    .filter(({ parts }) => parts)
    .map(({ row, parts }) => {
      const date = nextCelebration(parts, today)
      return {
        id: row.id,
        name: row.name,
        birth_month: parts.month,
        birth_day: parts.day,
        birth_year: parts.year,
        member_id: row.member_id ?? null,
        next_date: date,
        turns: ageOn(parts, date),
        days_until: daysBetween(today, date),
      }
    })
    .sort((a, b) => a.next_date.localeCompare(b.next_date) || byText(a.name, b.name))
}

// The birthdays celebrated in one month of one year, from the list listBirthdays returns (month is 1 to 12). Each keeps
// its list fields, with the celebration date that year and the age on that day. Soonest first.
export function celebrationsInMonth(list, year, month) {
  return list
    .filter((b) => b.birth_year == null || year >= b.birth_year)
    .map((b) => {
      const parts = { month: b.birth_month, day: b.birth_day, year: b.birth_year }
      const date = celebrationDate(parts, year)
      return { ...b, date, turns: ageOn(parts, date) }
    })
    .filter((b) => Number(b.date.slice(5, 7)) === month)
    .sort((a, b) => a.date.localeCompare(b.date) || byText(a.name, b.name))
}

function reminderText(name, turns, daysAgo) {
  const age = turns !== null && turns >= 1
  if (daysAgo === 0) return age ? `Today is ${name}'s birthday, turning ${turns}.` : `Today is ${name}'s birthday.`
  const when = daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
  return age ? `${name} turned ${turns} ${when}.` : `${name}'s birthday was ${when}.`
}

// Writes one reminder to each family member for each birthday from the last six days (today included). The
// reminder's id is fixed by the birthday, the celebration year and the member, so two devices that both write it
// end up with one record, not two, and a reminder is never written twice. Returns how many were written. Safe to
// call as often as you like.
export function recordBirthdayReminders(doc, today = todayIso()) {
  const year = Number(today.slice(0, 4))
  const due = []
  for (const row of all(doc, T)) {
    const parts = birthdayParts(row)
    if (!parts) continue
    for (const celebrationYear of [year - 1, year]) {
      const date = celebrationDate(parts, celebrationYear)
      const daysAgo = daysBetween(date, today)
      if (daysAgo >= 0 && daysAgo <= CATCH_UP_DAYS) due.push({ row, date, daysAgo, celebrationYear, parts })
    }
  }
  if (due.length === 0) return 0
  const members = listMembers(doc)
  let written = 0
  doc.transact(() => {
    for (const { row, date, daysAgo, celebrationYear, parts } of due) {
      const message = reminderText(row.name, ageOn(parts, date), daysAgo)
      for (const m of members) {
        if (m.id === row.member_id) continue // the birthday person doesn't get a reminder about their own birthday
        const id = `birthday-${row.id}-${celebrationYear}-${m.id}`
        if (get(doc, NOTIFICATIONS, id)) continue
        insert(doc, NOTIFICATIONS, { recipient_member_id: m.id, type: REMINDER_TYPE, message, related_id: row.id, read_at: null }, id)
        written++
      }
    }
  })
  return written
}
