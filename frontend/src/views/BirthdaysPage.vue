<script setup>
import { useItemHighlight } from '../lib/highlight'

useItemHighlight()
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { Cake, Plus, PartyPopper, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useFamily, useLive } from '../data/vue'
import { listBirthdays, celebrationsInMonth, saveBirthday, deleteBirthday, todayIso } from '../data/modules/birthdays'
import { listMembers } from '../data/members'

const { doc } = useFamily()

// The birthday list: which day each one falls on, and the age that makes when the year born is known.
const birthdays = useLive((d) => listBirthdays(d))
const members = useLive(listMembers)
// Today moves on at midnight. The page re-reads it every minute, and when it comes back into view, so the calendar and
// the saves always use the real day.
const today = ref(todayIso())
const thisYear = computed(() => Number(today.value.slice(0, 4)))
const thisMonth = computed(() => Number(today.value.slice(5, 7)) - 1) // 0-based, as the calendar keeps its months
function refreshToday() {
  today.value = todayIso()
}
let todayTimer = null
onMounted(() => {
  todayTimer = setInterval(refreshToday, 60_000)
  document.addEventListener('visibilitychange', refreshToday)
})
onUnmounted(() => {
  clearInterval(todayTimer)
  document.removeEventListener('visibilitychange', refreshToday)
})

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Not saved, so every visit to the page opens on the list.
const tab = ref('list')

// A reminder opens the page with ?item=. The highlight only finds rows on the list, so the page switches to it first,
// as the Communication page does for a 1:1.
const route = useRoute()
function showLinkedBirthday(id) {
  if (id && birthdays.value.some((b) => b.id === id)) tab.value = 'list'
}
showLinkedBirthday(route.query.item)
watch(() => route.query.item, showLinkedBirthday)

// The calendar shows one month and one selected day. The day starts as today.
const viewYear = ref(thisYear.value)
const viewMonth = ref(thisMonth.value)
const selectedDate = ref(today.value)

// Tapping a day opens its birthdays in a sheet, as the Calendar page does. Under the grid they would sit below the
// fold on a phone.
const dayOpen = ref(false)

// Add and edit share one sheet (AppModal, a bottom sheet on mobile), like the other modules.
const formOpen = ref(false)
const editingId = ref(null)
const formName = ref('')
const formMonth = ref('')
const formDay = ref('')
const formYear = ref('')
const formAge = ref('')
const formMember = ref('')
const formError = ref('')

// February is offered in full, since the year born may not be known.
const dayOptions = computed(() => {
  const month = Number(formMonth.value)
  const count = month === 2 ? 29 : [4, 6, 9, 11].includes(month) ? 30 : 31
  return Array.from({ length: count }, (_, i) => i + 1)
})

function clearForm() {
  formName.value = ''
  formMonth.value = ''
  formDay.value = ''
  formYear.value = ''
  formAge.value = ''
  formMember.value = ''
  formError.value = ''
}

function openAdd() {
  editingId.value = null
  clearForm()
  formOpen.value = true
}

// Editing shows the year born. The age is only ever typed in, so it starts blank.
function openEdit(b) {
  editingId.value = b.id
  clearForm()
  formName.value = b.name
  formMonth.value = String(b.birth_month)
  formDay.value = String(b.birth_day)
  formYear.value = b.birth_year == null ? '' : String(b.birth_year)
  formMember.value = b.member_id ?? ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

// A birthday opened from a day's sheet swaps that sheet for the edit sheet.
function editFromDay(b) {
  dayOpen.value = false
  openEdit(b)
}

function save() {
  formError.value = ''
  try {
    saveBirthday(
      doc,
      {
        id: editingId.value ?? undefined,
        name: formName.value,
        birth_month: formMonth.value,
        birth_day: formDay.value,
        birth_year: formYear.value,
        age: formAge.value,
        member_id: formMember.value,
      },
      today.value,
    )
    formOpen.value = false
  } catch (e) {
    formError.value = e.message
  }
}

function remove() {
  deleteBirthday(doc, editingId.value)
  formOpen.value = false
}

// The year 2000 is a leap year, so a 29 February birthday displays correctly.
function dayAndMonth(month, day) {
  return new Date(2000, month - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
}

// "Born 14 March 2018" when the year is known, otherwise "Birthday 14 March".
function metaLabel(b) {
  if (b.birth_year == null) return `Birthday ${dayAndMonth(b.birth_month, b.birth_day)}`
  const born = new Date(b.birth_year, b.birth_month - 1, b.birth_day)
  return `Born ${born.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`
}

// "Today", "Tomorrow", "In 3 days", then the date.
function whenLabel(b) {
  if (b.days_until === 0) return 'Today'
  if (b.days_until === 1) return 'Tomorrow'
  if (b.days_until <= 6) return `In ${b.days_until} days`
  const [y, m, d] = b.next_date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// Built from local date parts, not toISOString, which can shift the day in some time zones. The month is 0-based.
function isoDate(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

const monthLabel = computed(() => new Date(viewYear.value, viewMonth.value, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))

// "Wednesday, October 14", the way the calendar names a day.
function longDate(date) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// A day's accessible name: its date, then its birthday count.
function dayLabel(date, count) {
  if (count === 0) return longDate(date)
  return `${longDate(date)}, ${count} ${count === 1 ? 'birthday' : 'birthdays'}`
}

// The birthdays celebrated in the month on screen, grouped by day. celebrationsInMonth takes a 1-based month,
// and the view keeps 0-based ones.
const monthBirthdays = computed(() => {
  const byDay = {}
  for (const b of celebrationsInMonth(birthdays.value, viewYear.value, viewMonth.value + 1)) {
    ;(byDay[b.date] ??= []).push(b)
  }
  return byDay
})

// Weeks start on Sunday. Slots before the 1st and after the last day are empty placeholders, not buttons.
const gridCells = computed(() => {
  const year = viewYear.value
  const month = viewMonth.value
  const cells = Array.from({ length: new Date(year, month, 1).getDay() }, (_, i) => ({ key: `lead-${i}`, date: null }))
  const days = new Date(year, month + 1, 0).getDate()
  for (let day = 1; day <= days; day++) {
    const date = isoDate(year, month, day)
    const count = monthBirthdays.value[date]?.length ?? 0
    cells.push({
      key: date,
      date,
      day,
      label: dayLabel(date, count),
      dots: Math.min(count, 3),
      extra: Math.max(count - 3, 0),
    })
  }
  // Six rows in every month, so the grid keeps its height when the month changes.
  while (cells.length < 42) cells.push({ key: `tail-${cells.length}`, date: null })
  return cells
})

const selectedBirthdays = computed(() => monthBirthdays.value[selectedDate.value] ?? [])

// Tapping a day selects it and opens its sheet.
function openDay(date) {
  selectedDate.value = date
  dayOpen.value = true
}

// Moves the calendar by whole months, and selects the 1st of the month it lands on.
function moveMonths(delta) {
  const first = new Date(viewYear.value, viewMonth.value + delta, 1)
  viewYear.value = first.getFullYear()
  viewMonth.value = first.getMonth()
  selectedDate.value = isoDate(viewYear.value, viewMonth.value, 1)
}

function goToday() {
  viewYear.value = thisYear.value
  viewMonth.value = thisMonth.value
  selectedDate.value = today.value
}
</script>

<template>
  <div class="module-page">
    <div class="birthdays-header">
      <div class="birthdays-header__tile">
        <Cake :size="22" />
      </div>
      <h2>Birthdays</h2>
    </div>

    <p class="birthdays-intro">
      Add a name and a birthday. On the day, everyone in the family gets a reminder.
    </p>

    <AppButton variant="primary" class="add-pill" @click="openAdd">
      <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Add a birthday
    </AppButton>

    <div class="birthdays-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        class="birthdays-tab"
        :aria-selected="tab === 'list'"
        :class="{ active: tab === 'list' }"
        @click="tab = 'list'"
      >
        List
      </button>
      <button
        type="button"
        role="tab"
        class="birthdays-tab"
        :aria-selected="tab === 'calendar'"
        :class="{ active: tab === 'calendar' }"
        @click="tab = 'calendar'"
      >
        Calendar
      </button>
    </div>

    <ul v-if="tab === 'list' && birthdays.length" class="module-list birthdays-list">
      <li
        v-for="b in birthdays"
        :key="b.id"
        class="birthday-card"
        :class="{ 'birthday-card--today': b.days_until === 0 }"
        :data-item-id="b.id"
      >
        <button type="button" class="birthday-card__body" @click="openEdit(b)">
          <div class="birthday-card__name">
            <PartyPopper v-if="b.days_until === 0" :size="16" class="birthday-card__party" />
            {{ b.name }}
          </div>
          <div class="birthday-card__meta">{{ metaLabel(b) }}</div>
        </button>
        <div class="birthday-card__when">
          <span class="birthday-card__label">{{ whenLabel(b) }}</span>
          <AppTag v-if="b.turns !== null">Turns {{ b.turns }}</AppTag>
        </div>
      </li>
    </ul>

    <EmptyState v-else-if="tab === 'list'" illustration="birthdays">
      No birthdays yet. Add one above, and the family is reminded on the day.
    </EmptyState>

    <div v-else-if="tab === 'calendar'" class="birthdays-calendar">
      <div class="birthdays-calendar__toolbar">
        <button type="button" class="birthdays-calendar__icon-btn" aria-label="Previous month" @click="moveMonths(-1)">
          <ChevronLeft :size="20" />
        </button>
        <strong class="birthdays-calendar__month" aria-live="polite">{{ monthLabel }}</strong>
        <button type="button" class="birthdays-calendar__icon-btn" aria-label="Next month" @click="moveMonths(1)">
          <ChevronRight :size="20" />
        </button>
        <AppButton variant="secondary" @click="goToday">Today</AppButton>
      </div>

      <div class="birthdays-calendar__card">
        <div class="birthdays-calendar__grid">
          <div v-for="wd in WEEKDAYS" :key="wd" class="birthdays-calendar__weekday">{{ wd }}</div>
          <template v-for="cell in gridCells" :key="cell.key">
            <span v-if="cell.date === null" aria-hidden="true"></span>
            <button
              v-else
              type="button"
              class="birthdays-calendar__day"
              :class="{
                'birthdays-calendar__day--today': cell.date === today,
                'birthdays-calendar__day--selected': cell.date === selectedDate,
              }"
              :aria-label="cell.label"
              :aria-current="cell.date === today ? 'date' : undefined"
              :aria-pressed="cell.date === selectedDate"
              @click="openDay(cell.date)"
            >
              <span class="birthdays-calendar__day-number">{{ cell.day }}</span>
              <span class="birthdays-calendar__dots">
                <span v-for="n in cell.dots" :key="n" class="birthdays-calendar__dot" aria-hidden="true"></span>
                <span v-if="cell.extra" class="birthdays-calendar__more">+{{ cell.extra }}</span>
              </span>
            </button>
          </template>
        </div>
      </div>
    </div>

    <AppModal :open="formOpen" :title="editingId ? 'Edit birthday' : 'Add a birthday'" @close="closeForm">
      <form class="birthdays-form" @submit.prevent="save">
        <FormField v-model="formName" label="Name" placeholder="Ana, Grandma Rose…" required />
        <label class="form-field">
          <span class="form-field__label">In the family? <span class="birthdays-form__optional">(optional)</span></span>
          <select v-model="formMember">
            <option value="">Not a family member</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </label>
        <fieldset class="birthdays-form__date">
          <legend class="form-field__label">Birthday</legend>
          <div class="birthdays-form__row">
            <label class="form-field">
              <span class="form-field__label">Month</span>
              <select v-model="formMonth" required>
                <option value="" disabled>Choose…</option>
                <option v-for="(name, i) in MONTHS" :key="name" :value="String(i + 1)">{{ name }}</option>
              </select>
            </label>
            <label class="form-field">
              <span class="form-field__label">Day</span>
              <select v-model="formDay" required>
                <option value="" disabled>Choose…</option>
                <option v-for="d in dayOptions" :key="d" :value="String(d)">{{ d }}</option>
              </select>
            </label>
          </div>
        </fieldset>
        <label class="form-field">
          <span class="form-field__label">Year born <span class="birthdays-form__optional">(optional)</span></span>
          <input v-model="formYear" type="number" inputmode="numeric" :min="1900" :max="thisYear" placeholder="e.g. 2018" />
        </label>
        <label class="form-field">
          <span class="form-field__label">Or age now <span class="birthdays-form__optional">(optional)</span></span>
          <input v-model="formAge" type="number" inputmode="numeric" min="0" max="130" placeholder="e.g. 8" />
        </label>
        <p v-if="formError" class="error">{{ formError }}</p>
        <div class="birthdays-form__actions">
          <AppButton v-if="editingId" type="button" variant="danger" @click="remove">Delete</AppButton>
          <AppButton type="submit" variant="primary">Save</AppButton>
        </div>
      </form>
    </AppModal>

    <AppModal :open="dayOpen" :title="longDate(selectedDate)" @close="dayOpen = false">
      <ul v-if="selectedBirthdays.length" class="module-list birthdays-list">
        <li v-for="b in selectedBirthdays" :key="b.id" class="birthday-card">
          <button type="button" class="birthday-card__body" @click="editFromDay(b)">
            <div class="birthday-card__name">
              <PartyPopper v-if="b.date === today" :size="16" class="birthday-card__party" />
              {{ b.name }}
            </div>
            <div class="birthday-card__meta">{{ metaLabel(b) }}</div>
          </button>
          <div class="birthday-card__when">
            <AppTag v-if="b.turns !== null">{{ b.date < today ? 'Turned' : 'Turns' }} {{ b.turns }}</AppTag>
          </div>
        </li>
      </ul>
      <p v-else class="birthdays-day__empty">No birthdays on this day.</p>
    </AppModal>
  </div>
</template>

<style scoped>
/* Header: icon tile + title, the same treatment as the other module pages. */
.birthdays-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.birthdays-header__tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
  background: linear-gradient(135deg, var(--tile-birthday-start), var(--tile-birthday-end));
}

.birthdays-header h2 {
  margin: 0;
}

.birthdays-intro {
  margin: 0 0 16px;
  font: var(--type-label);
  color: var(--text-muted);
}

.add-pill {
  display: inline-flex;
  align-items: center;
  margin-bottom: 16px;
}

/* Underlined List / Calendar tabs, the same treatment as the Speak page's section tabs. */
.birthdays-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
}

.birthdays-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: var(--type-label);
  padding: 10px 14px;
  min-height: 44px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}

.birthdays-tab:hover {
  color: var(--text);
}

.birthdays-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 700;
}

.birthdays-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.birthdays-list {
  gap: 10px;
}

.birthday-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 12px 14px;
}

/* The day itself gets a tinted card, so it stands out in the list without relying on color alone:
   the "Today" label and the party icon say the same thing. */
.birthday-card--today {
  background: color-mix(in srgb, var(--tile-birthday-start) 22%, var(--surface));
}

.birthday-card__body {
  flex: 1;
  min-width: 0;
  text-align: left;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: inherit;
}

.birthday-card__name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.birthday-card__party {
  color: var(--accent);
}

.birthday-card__meta {
  margin-top: 2px;
  font: var(--type-label);
  color: var(--text-muted);
}

.birthday-card__when {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.birthday-card__label {
  font: var(--type-label);
  font-weight: 600;
  color: var(--text);
}

/* Capped at 640px, since the page is wider on a computer. */
.birthdays-calendar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 640px;
}

/* Month toolbar: the same bar as the Calendar page's. */
.birthdays-calendar__toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 8px 10px;
}

.birthdays-calendar__icon-btn {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.birthdays-calendar__icon-btn:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
}

.birthdays-calendar__icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.birthdays-calendar__month {
  flex: 1 1 auto;
  min-width: 0;
  text-align: center;
  font: var(--type-title);
  color: var(--text);
}

/* Padding is 8px, not 12, so the day cells have room for a 44px tap width on phones from 390px wide up. */
.birthdays-calendar__card {
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 8px;
}

/* minmax(0, 1fr) keeps the seven columns inside the card on a narrow phone, so the grid never scrolls sideways. The
   columns sit 4px apart, not 6px, for the same tap width. */
.birthdays-calendar__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px 4px;
}

.birthdays-calendar__weekday {
  text-align: center;
  font: var(--type-label);
  color: var(--text-muted);
  padding: 4px 0 8px;
}

/* Each day is a button at least 44px tall, for tapping. The cells sit on the card's own surface, so the grid gap and
   the selected tint are what separate them. */
.birthdays-calendar__day {
  min-height: 44px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  gap: 4px;
  padding: 4px;
  background: transparent;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font: inherit;
  color: var(--text);
  text-align: left;
  transition: background-color 120ms ease;
}

/* Not on the selected day: a touch screen keeps the hover after a tap, and that would cover the selected tint. */
.birthdays-calendar__day:hover:not(.birthdays-calendar__day--selected) {
  background: var(--surface-variant);
}

.birthdays-calendar__day:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.birthdays-calendar__day--selected {
  background: var(--accent-container);
}

.birthdays-calendar__day--selected .birthdays-calendar__day-number {
  color: var(--on-accent-container);
}

.birthdays-calendar__day-number {
  font: var(--type-label);
  font-size: 12px;
}

.birthdays-calendar__day--today .birthdays-calendar__day-number {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 800;
}

/* Selected and today together: the circle keeps its own contrast over the tint. */
.birthdays-calendar__day--selected.birthdays-calendar__day--today .birthdays-calendar__day-number {
  color: var(--accent-contrast);
}

.birthdays-calendar__dots {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  width: 100%;
  min-height: 6px;
}

.birthdays-calendar__dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.birthdays-calendar__more {
  font: var(--type-label);
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1;
}

.birthdays-day__empty {
  margin: 0;
  font: var(--type-label);
  color: var(--text-muted);
}

.birthdays-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.birthdays-form__date {
  margin: 0;
  padding: 0;
  border: none;
}

.birthdays-form__row {
  display: flex;
  gap: 12px;
}

.birthdays-form__row .form-field {
  flex: 1;
}

.birthdays-form__optional {
  font-weight: 400;
  color: var(--text-muted);
}

.birthdays-form__actions {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
}
</style>
