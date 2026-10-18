<script setup>
// Settings. Not a module (there is no per-module gate on any
// of its actions), same "platform, not add-on" tier as member
// management/export -- manually routed in router.js, same precedent as
// /modules.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import {
  Home, UserRound, Users, Database,
  Camera, Download, AlertTriangle, Palette,
  Smartphone, MonitorSmartphone, Lock,
} from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { useSyncStore } from '../stores/sync'
import { useAdminLockStore } from '../stores/adminLock'
import PinForm from '../components/PinForm.vue'
import { firstName } from '../lib/names'
import { useFamily, useLive } from '../data/vue'
import { assetUrl, putImageFile, removeAsset } from '../data/assets'
import { listMembers, addMember as addMemberRecord, setMemberRole, updateMember } from '../data/members'
import { saveSettings as saveSettingsRecord } from '../data/settings'
import { effectiveTheme } from '../lib/theme'
import { createBackup, exportJson } from '../data/backup'
import { family } from '../data/family'
import { loadRelayConfig, saveRelayConfig, clearRelayConfig, relayPairingUrl, relayDeviceId, parseRelayLink } from '../data/relay/config'
import { isStandaloneApp, isIosSafariTab } from '../lib/platform.js'
import { newFamilyKey, deriveRoomId, deriveAuth, toBase64Url } from '../data/relay/crypto'
import QRCode from 'qrcode'
import { createHubApi } from '../data/sync/hubApi.js'
import { relayNameOf, relayVersionState } from '../data/relay/version.js'
import { listDevices, describeLastSeen, thisDeviceLabel } from '../data/presence.js'

const core = useCoreStore()
const sync = useSyncStore()
const router = useRouter()
const { doc, assets, actor } = useFamily()
const adminLock = useAdminLockStore()

const members = useLive(listMembers)

const devices = useLive(listDevices)
const thisDeviceId = relayDeviceId()
const thisDeviceName = thisDeviceLabel()
// Ticks once a minute so "10 min ago" stays current while the page is open.
const clock = ref(new Date())
const clockTimer = setInterval(() => (clock.value = new Date()), 60 * 1000)
onUnmounted(() => clearInterval(clockTimer))

// The devices a member is using, and the devices with no one signed in on them.
function devicesOf(memberId) {
  return devices.value.filter((d) => (d.member_id ?? null) === memberId)
}
const noOneDevices = computed(() => devicesOf(null))

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function switchProfile() {
  core.switchProfile()
  router.push('/profiles')
}

const savingSettings = ref(false)
const settingsError = ref('')
const settingsSuccess = ref('')

// --- Hub name / week start day ---
const familyName = ref(core.config?.family_name ?? core.familyName ?? '')
const weekStartDay = ref(core.config?.week_start_day ?? 'sunday')

function saveSettings() {
  settingsError.value = ''
  settingsSuccess.value = ''
  savingSettings.value = true
  try {
    saveSettingsRecord(doc, actor(), { family_name: familyName.value, week_start_day: weekStartDay.value })
    settingsSuccess.value = 'Saved.'
  } catch (e) {
    settingsError.value = e.message
  } finally {
    savingSettings.value = false
  }
}

// --- Your theme: each member picks their own; coral is the default. The two colors are the
// theme's main ones, shown as filled circles on its chip. ---
const THEME_CHOICES = [
  { key: 'coral', label: 'Coral', primary: '#f4633a', secondary: '#0ca9d6' },
  { key: 'bold', label: 'Bold', primary: '#ff6347', secondary: '#1e4ca1' },
  { key: 'garden', label: 'Garden', primary: '#556b2f', secondary: '#cc5959' },
  { key: 'garage', label: 'Garage', primary: '#215f72', secondary: '#713d21' },
  { key: 'fruit', label: 'Fruit', primary: '#e15335', secondary: '#97a868' },
  { key: 'breeze', label: 'Breeze', primary: '#1a5fa8', secondary: '#2ba38a' },
  { key: 'carnival', label: 'Carnival', primary: '#e0457a', secondary: '#2196c9' },
  { key: 'meadow', label: 'Meadow', primary: '#3a7d43', secondary: '#c15f76' },
]
const myTheme = computed(() => effectiveTheme(core.memberTheme))
const themeError = ref('')

// Saving changes the doc, and core's store re-applies the theme on this device straight away.
function chooseTheme(key) {
  if (key === myTheme.value) return
  themeError.value = ''
  try {
    updateMember(doc, core.memberId, { theme_preference: key })
  } catch (e) {
    themeError.value = e.message
  }
}

// --- Member management (admin only) ---
const showAddMember = ref(false)
const newMemberName = ref('')
const newMemberRole = ref('member')
const addMemberError = ref('')

async function addMember() {
  addMemberError.value = ''
  if (!newMemberName.value.trim()) {
    addMemberError.value = 'A name is required.'
    return
  }
  if (newMemberRole.value === 'admin' && !(await adminLock.confirmAdmin(core.memberId, 'Enter your PIN to add an admin.'))) {
    return
  }
  try {
    addMemberRecord(doc, { name: newMemberName.value, role: newMemberRole.value })
    newMemberName.value = ''
    newMemberRole.value = 'member'
    showAddMember.value = false
  } catch (e) {
    addMemberError.value = e.message
  }
}

const changeRoleError = ref('')

// `select` is the dropdown itself: if the PIN isn't confirmed, it goes back to the role it had.
async function changeRole(m, role, select) {
  changeRoleError.value = ''
  if (!(await adminLock.confirmAdmin(core.memberId, `Enter your PIN to change ${firstName(m.name)}'s role.`))) {
    if (select) select.value = m.role
    return
  }
  try {
    setMemberRole(doc, actor(), m.id, role)
  } catch (e) {
    changeRoleError.value = e.message
  }
}

// --- Your admin PIN: changing it asks for the current PIN first. ---
const showChangePin = ref(false)

async function openChangePin() {
  if (await adminLock.confirmAdmin(core.memberId, 'Enter your current PIN to change it.')) showChangePin.value = true
}

// --- My own profile ---
const myName = ref(core.memberName ?? '')
const savingProfile = ref(false)
const profileError = ref('')
const profileSuccess = ref('')

function saveProfile() {
  profileError.value = ''
  profileSuccess.value = ''
  if (!myName.value.trim()) {
    profileError.value = 'Name is required.'
    return
  }
  savingProfile.value = true
  try {
    updateMember(doc, core.memberId, { name: myName.value })
    profileSuccess.value = 'Saved.'
  } catch (e) {
    profileError.value = e.message
  } finally {
    savingProfile.value = false
  }
}

// Avatar upload, client-resized/capped BEFORE it is stored -- resizes to a
// max 256x256 square (cover-cropped) via canvas and re-encodes as JPEG at a
// fixed quality, so even a multi-MB phone photo becomes a tiny image.
const AVATAR_MAX_DIM = 256
const avatarUploading = ref(false)
const avatarError = ref('')
const avatarInputEl = ref(null)

function resizeImageToBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const sx = (img.width - side) / 2
      const sy = (img.height - side) / 2
      const canvas = document.createElement('canvas')
      canvas.width = AVATAR_MAX_DIM
      canvas.height = AVATAR_MAX_DIM
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_MAX_DIM, AVATAR_MAX_DIM)
      URL.revokeObjectURL(objectUrl)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process image'))), 'image/jpeg', 0.85)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not read image file'))
    }
    img.src = objectUrl
  })
}

async function onAvatarChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  avatarError.value = ''
  if (!file.type.startsWith('image/')) {
    avatarError.value = 'Please choose an image file.'
    return
  }
  avatarUploading.value = true
  try {
    const resizedBlob = await resizeImageToBlob(file)
    const resizedFile = new File([resizedBlob], 'avatar.jpg', { type: 'image/jpeg' })
    const prev = core.avatarAssetId
    const id = await putImageFile(assets, resizedFile, { maxDim: AVATAR_MAX_DIM })
    updateMember(doc, core.memberId, { avatar_asset_id: id })
    if (prev) removeAsset(assets, prev)
  } catch (err) {
    avatarError.value = err.message || 'Upload failed.'
  } finally {
    avatarUploading.value = false
    if (avatarInputEl.value) avatarInputEl.value.value = ''
  }
}

// --- Data export + import, admin only ---
// A full Yjs-state backup and a single JSON export, both computed
// synchronously from the local doc.
const exportError = ref('')

function todayStamp() {
  return new Date().toISOString().slice(0, 10)
}

async function downloadBackup() {
  exportError.value = ''
  if (!(await adminLock.confirmAdmin(core.memberId, 'Enter your PIN to download a backup.'))) return
  try {
    download(`yggltree-backup-${todayStamp()}.yggltree.json`, createBackup(family()), 'application/json')
  } catch (e) {
    exportError.value = e.message
  }
}

async function downloadJsonExport() {
  exportError.value = ''
  if (!(await adminLock.confirmAdmin(core.memberId, 'Enter your PIN to download a readable export.'))) return
  try {
    download(`yggltree-export-${todayStamp()}.json`, JSON.stringify(exportJson(doc), null, 2), 'application/json')
  } catch (e) {
    exportError.value = e.message
  }
}

// --- Family relay: phones sync through a relay the family runs on its own account.
const relayUrlInput = ref('')
const relay = ref(loadRelayConfig())
const relayError = ref('')
const relayLink = computed(() => (relay.value ? relayPairingUrl(relay.value.url, relay.value.key) : ''))
const relayQr = ref('')
watch(relayLink, async (link) => {
  relayQr.value = link ? await QRCode.toDataURL(link, { margin: 1, width: 220 }) : ''
}, { immediate: true })

// A family link (from Add a device on the family computer) carries the family's key, so this computer joins the
// same room as the phones. A bare address has no key: saving it starts a new, empty room that the phones can't
// reach, so it's only offered after the person confirms that no phone uses this relay yet.
function startRelay() {
  relayError.value = ''
  const text = relayUrlInput.value.trim()
  const link = parseRelayLink(text)
  if (link) {
    saveRelayConfig(link)
    window.location.reload()
    return
  }
  const url = text.replace(/\/$/, '')
  if (!/^https:\/\/[^/\s]+$/.test(url) && !/^http:\/\/localhost(:\d+)?$/.test(url)) {
    relayError.value = 'Paste the family link from Add a device, or a relay address that starts with https://.'
    return
  }
  if (!window.confirm('Start a new family key for this relay? Only do this for a relay no phone uses yet. Phones already on this relay could not follow.')) return
  saveRelayConfig({ url, key: newFamilyKey() })
  window.location.reload()
}

// --- Set up the relay from this computer. The Cloudflare token stays on this computer, and the
// hub creates or deletes the relay on the family's Cloudflare account.
const hubRelay = createHubApi({ baseUrl: globalThis.location?.origin ?? '' })

// --- Relay version: phones get the app from the relay, so an older relay means older phones.
// Updating sends this app's build to the relay under the same name. Nothing is deleted.
const relayVersion = ref(null) // 'current' | 'outdated' | 'unknown' | null (not checked yet)
const relayUpdateBusy = ref(false)
const relayUpdateMessage = ref('')

async function checkRelayVersion() {
  if (!relay.value) return
  try {
    relayVersion.value = relayVersionState(await hubRelay.relayVersion(relay.value.url))
  } catch {
    relayVersion.value = 'unknown'
  }
}

async function updateRelayNow() {
  relayUpdateMessage.value = ''
  if (!(await adminLock.confirmAdmin(core.memberId, 'Enter your PIN to update the relay.'))) return
  relayUpdateBusy.value = true
  try {
    await hubRelay.updateRelay(relayNameOf(relay.value.url))
    relayUpdateMessage.value = 'Done. Open Yggltree on each phone to get the new version.'
    await checkRelayVersion()
  } catch (e) {
    relayUpdateMessage.value = e.userMessage ?? e.message
  } finally {
    relayUpdateBusy.value = false
  }
}
const cloudflare = ref({ connected: false, method: null, accountName: null })
const cloudflareToken = ref('')
const relayNameInput = ref('')
const relaySetupBusy = ref('') // '' | connect | create | replace | erase
const relaySetupError = ref('')
const RELAY_NAME_SHAPE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/

function relaySetupFailure(err) {
  relaySetupError.value = err?.userMessage || 'Something went wrong. Check the connection on this computer, then try again.'
}

async function loadCloudflareStatus() {
  if (!core.isAdmin) return
  try {
    cloudflare.value = await hubRelay.checkRelay()
  } catch {
    cloudflare.value = { connected: false, method: null, accountName: null }
  }
}

// Opens Cloudflare's login page in the browser. The family signs in there and clicks Allow.
async function connectWithCloudflare() {
  relaySetupError.value = ''
  relaySetupBusy.value = 'connect'
  try {
    cloudflare.value = await hubRelay.loginCloudflare()
  } catch (err) {
    relaySetupFailure(err)
  } finally {
    relaySetupBusy.value = ''
  }
}

// The advanced option: a Cloudflare API token that the family pastes in.
async function connectWithToken() {
  relaySetupError.value = ''
  relaySetupBusy.value = 'connect-token'
  try {
    cloudflare.value = await hubRelay.saveRelayToken(cloudflareToken.value.trim())
    cloudflareToken.value = ''
  } catch (err) {
    relaySetupFailure(err)
  } finally {
    relaySetupBusy.value = ''
  }
}

async function forgetCloudflare() {
  relaySetupError.value = ''
  try {
    cloudflare.value = await hubRelay.forgetRelayToken()
  } catch (err) {
    relaySetupFailure(err)
  }
}

// A starting name for the relay, from the family's name: "The Smiths" becomes "the-smiths-relay".
function suggestRelayName(familyName) {
  const base = String(familyName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
  return base.length >= 3 ? `${base}-relay` : 'family-relay'
}

const setUpLabel = computed(() => {
  if (relaySetupBusy.value === 'connect') return 'Waiting for the Cloudflare page…'
  if (relaySetupBusy.value === 'create') return 'Setting up your relay… this takes a few minutes'
  return 'Set up my relay'
})

// The one path for a family without a relay: connect Cloudflare if needed, then create the relay.
async function setUpRelay() {
  relaySetupError.value = ''
  if (!RELAY_NAME_SHAPE.test(relayNameInput.value.trim())) {
    relaySetupError.value = 'Use 3 to 63 lowercase letters, digits or hyphens for the relay name.'
    return
  }
  if (!(await adminLock.confirmAdmin(core.memberId, 'Enter your PIN to set up the relay.'))) return
  if (!cloudflare.value.connected) {
    await connectWithCloudflare()
    if (!cloudflare.value.connected) return
  }
  await buildRelay({ replacing: false })
}

// Creates a relay under the chosen name, or replaces the current one: the old relay is deleted first.
async function buildRelay({ replacing }) {
  relaySetupError.value = ''
  const name = relayNameInput.value.trim()
  if (!RELAY_NAME_SHAPE.test(name)) {
    relaySetupError.value = 'Use 3 to 63 lowercase letters, digits or hyphens for the relay name.'
    return
  }
  if (!(await adminLock.confirmAdmin(core.memberId, 'Enter your PIN to change the relay.'))) return
  relaySetupBusy.value = replacing ? 'replace' : 'create'
  try {
    const { url } = await hubRelay.createRelay({ name, replace: replacing ? relay.value.url : null })
    saveRelayConfig({ url, key: newFamilyKey() })
    window.location.reload()
  } catch (err) {
    relaySetupFailure(err)
  } finally {
    relaySetupBusy.value = ''
  }
}

async function eraseRelay() {
  relaySetupError.value = ''
  if (!(await adminLock.confirmAdmin(core.memberId, 'Enter your PIN to erase the relay.'))) return
  const sure = window.confirm(
    "Erase the relay? This deletes everything it has stored on Cloudflare. Each phone keeps its own copy of the family's data. This can't be undone.",
  )
  if (!sure) return
  relaySetupBusy.value = 'erase'
  try {
    await hubRelay.deleteRelay(relay.value.url)
    clearRelayConfig()
    window.location.reload()
  } catch (err) {
    relaySetupFailure(err)
  } finally {
    relaySetupBusy.value = ''
  }
}

async function turnOffRelay() {
  // Stop this device's notifications first. Once the relay is off, nothing reaches this device from the
  // family. The relay forgets the subscription the next time a push to it fails.
  if (notifyState.value === 'on') await turnOffNotifications().catch(() => {})
  clearRelayConfig()
  window.location.reload()
}

// --- Notifications on this phone (relay mode). A notification only says that something
// changed, and tapping it opens the app. On iPhone this works from the Home Screen app.
const notifyState = ref('checking') // checking | on | off | unsupported | add-to-home | other-origin
const notifyError = ref('')

function urlBase64ToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

async function refreshNotify() {
  if (!relay.value) return
  if (globalThis.location.origin !== relay.value.url) return (notifyState.value = 'other-origin')
  if (!('serviceWorker' in navigator) || !('PushManager' in globalThis) || !('Notification' in globalThis)) {
    return (notifyState.value = 'unsupported')
  }
  if (isIosSafariTab()) return (notifyState.value = 'add-to-home')
  const reg = await navigator.serviceWorker.ready
  notifyState.value = (await reg.pushManager.getSubscription()) ? 'on' : 'off'
}

async function turnOnNotifications() {
  notifyError.value = ''
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    notifyError.value = `Notifications are ${permission}. Allow them for Yggltree in the phone's Settings.`
    return
  }
  const reg = await navigator.serviceWorker.ready
  const { key } = await (await fetch('/vapid-public-key')).json()
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) })
  const res = await fetch(`/room/${deriveRoomId(relay.value.key, 'main')}/subscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), src: relayDeviceId(), auth: toBase64Url(deriveAuth(relay.value.key)) }),
  })
  if (!res.ok) {
    notifyError.value = `Could not turn notifications on (HTTP ${res.status}).`
    return
  }
  notifyState.value = 'on'
}

async function turnOffNotifications() {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()
  notifyState.value = 'off'
}

onMounted(() => refreshNotify().catch(() => (notifyState.value = 'unsupported')))
onMounted(loadCloudflareStatus)
onMounted(checkRelayVersion)
onMounted(() => {
  if (!relayNameInput.value) relayNameInput.value = suggestRelayName(core.familyName)
})

const showRestoreModal = ref(false)
const restoreFile = ref(null)
const restoreConfirmText = ref('')
const restoreError = ref('')
const restoreSuccess = ref('')
const restoring = ref(false)
const restoreInputEl = ref(null)

// Restore goes through the hub (a new room and token), so it is only
// offered on the hub machine; other devices restore from the family
// computer. If this browser's wipe fails after the hub restored
// (sync.restoreStuck) the open family is destroyed: the modal can't be
// closed and only "Download a backup first" and Retry are offered. The
// sync store keeps a beforeunload warning up meanwhile.
function openRestoreModal() {
  restoreFile.value = null
  restoreConfirmText.value = ''
  restoreError.value = ''
  restoreSuccess.value = ''
  showRestoreModal.value = true
}

function onRestoreFileChange(e) {
  restoreFile.value = e.target.files?.[0] || null
}

function closeRestoreModal() {
  if (restoring.value || sync.restoreStuck) return
  showRestoreModal.value = false
}

async function confirmRestore() {
  restoreError.value = ''
  if (!sync.isHubMachine) {
    restoreError.value = 'Restore from the family computer.'
    return
  }
  if (!restoreFile.value) {
    restoreError.value = 'Choose a backup file to restore.'
    return
  }
  if (restoreConfirmText.value !== 'REPLACE') {
    restoreError.value = 'Type REPLACE exactly to confirm.'
    return
  }
  if (!(await adminLock.confirmAdmin(core.memberId, 'Enter your PIN to restore a backup.'))) return
  restoring.value = true
  try {
    await sync.restoreOnHub(restoreFile.value) // reloads on success
    restoreSuccess.value = 'Data restored. Reloading…'
  } catch (e) {
    restoreError.value = e.message
  } finally {
    restoring.value = false
  }
}

// Retry reuses the hub's answer: it never restores into another room.
async function retryRestore() {
  restoreError.value = ''
  if (!(await adminLock.confirmAdmin(core.memberId, 'Enter your PIN to restore a backup.'))) return
  restoring.value = true
  try {
    await sync.retryRestore() // reloads on success
    restoreSuccess.value = 'Data restored. Reloading…'
  } catch (e) {
    restoreError.value = e.message
  } finally {
    restoring.value = false
  }
}

// The family behind this page is destroyed while stuck: don't let an
// in-app navigation carry on with it.
onBeforeRouteLeave(() => !sync.restoreStuck)

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
</script>

<template>
  <div class="module-page settings-page">
    <h2>Settings</h2>

    <!-- You: settings that are yours alone, and follow you to every device you sign in on. -->
    <section class="settings-group" aria-labelledby="group-you">
      <h2 id="group-you" class="settings-group__title">You</h2>
      <p class="settings-group__note">Only you see these. They follow you to every device you sign in on.</p>

      <!-- My profile -->
      <AppCard class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--profile">
            <UserRound :size="20" />
          </span>
          <h3>My profile</h3>
        </div>
        <div class="avatar-row">
          <div class="avatar-preview">
            <img v-if="assetUrl(core.avatarAssetId)" :src="assetUrl(core.avatarAssetId)" alt="" />
            <span v-else>{{ initials(core.memberName) }}</span>
          </div>
          <div class="avatar-actions">
            <label class="app-btn app-btn--secondary avatar-upload-btn">
              <Camera :size="16" />
              {{ avatarUploading ? 'Uploading…' : 'Change photo' }}
              <input
                ref="avatarInputEl"
                type="file"
                accept="image/*"
                class="avatar-upload-input"
                :disabled="avatarUploading"
                @change="onAvatarChange"
              />
            </label>
            <p v-if="avatarError" class="error">{{ avatarError }}</p>
          </div>
        </div>
        <form class="settings-form" @submit.prevent="saveProfile">
          <FormField v-model="myName" label="Name" required />
          <p v-if="profileError" class="error">{{ profileError }}</p>
          <p v-if="profileSuccess" class="success">{{ profileSuccess }}</p>
          <AppButton type="submit" :disabled="savingProfile">{{ savingProfile ? 'Saving…' : 'Save profile' }}</AppButton>
        </form>
        <AppButton variant="ghost" type="button" @click="switchProfile">Switch profile</AppButton>
      </AppCard>

      <!-- Your theme: yours alone, and it follows you to every device you sign in on. Applies straight away. -->
      <AppCard class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--appearance">
            <Palette :size="20" />
          </span>
          <h3>Your theme</h3>
        </div>
        <p class="hint">Only you see this. It follows you to every device where you sign in. Applies straight away.</p>
        <div class="theme-picker" role="radiogroup" aria-label="Your theme">
          <button
            v-for="t in THEME_CHOICES"
            :key="t.key"
            type="button"
            role="radio"
            :aria-checked="myTheme === t.key"
            class="theme-chip"
            :class="{ 'theme-chip--selected': myTheme === t.key }"
            @click="chooseTheme(t.key)"
          >
            <span class="theme-chip__dots" aria-hidden="true">
              <span class="theme-chip__dot" :style="{ background: t.primary }" />
              <span class="theme-chip__dot" :style="{ background: t.secondary }" />
            </span>
            <span class="theme-chip__label">{{ t.label }}</span>
          </button>
        </div>
        <p v-if="themeError" class="error">{{ themeError }}</p>
      </AppCard>

      <!-- This device: its name, and turning sync off here. Sync and notifications are set per device. -->
      <AppCard class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--data">
            <MonitorSmartphone :size="20" />
          </span>
          <h3>This device</h3>
        </div>
        <p class="device-row__name">{{ thisDeviceName }}</p>
        <template v-if="relay">
          <p class="hint">
            This only affects this device. It stops syncing and notifications here. This device keeps its copy of
            the family's data.
          </p>
          <AppButton variant="danger" @click="turnOffRelay">Turn off sync on this device</AppButton>
        </template>
      </AppCard>

      <!-- Notifications on this phone: only for devices that use the family relay. -->
      <AppCard v-if="relay" class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--data">
            <Smartphone :size="20" />
          </span>
          <h3>Notifications on this phone</h3>
        </div>
        <p class="hint">
          Get a notification when something changes in your family's lists, even when the app is closed. The
          notification doesn't say what changed. Tap it to open the app.
        </p>
        <p v-if="notifyState === 'other-origin'" class="hint">
          Turn notifications on from the phone itself, using the family relay link (not from this computer).
        </p>
        <p v-else-if="notifyState === 'unsupported'" class="hint">This browser can't show notifications.</p>
        <p v-else-if="notifyState === 'add-to-home'" class="hint">
          On iPhone, first add Yggltree to the Home Screen (Share → Add to Home Screen), open it from its icon,
          then come back to this screen.
        </p>
        <template v-else-if="notifyState === 'on'">
          <p class="hint"><strong>On</strong> for this phone.</p>
          <AppButton variant="ghost" @click="turnOffNotifications">Turn off</AppButton>
        </template>
        <AppButton v-else-if="notifyState === 'off'" variant="secondary" @click="turnOnNotifications">
          Turn on notifications
        </AppButton>
        <p v-if="notifyError" class="error">{{ notifyError }}</p>
      </AppCard>
    </section>

    <!-- Family: shared by everyone. Only admins see this section. -->
    <section v-if="core.isAdmin" class="settings-group" aria-labelledby="group-family">
      <h2 id="group-family" class="settings-group__title">Family</h2>
      <p class="settings-group__note">Shared by everyone in the family. Admins manage these.</p>

      <AppCard class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--household">
            <Home :size="20" />
          </span>
          <h3>Household</h3>
        </div>
        <form class="settings-form" @submit.prevent="saveSettings">
          <FormField v-model="familyName" label="Family name" required />
          <label class="form-field">
            <span class="form-field__label">Week starts on</span>
            <select v-model="weekStartDay">
              <option value="sunday">Sunday</option>
              <option value="monday">Monday</option>
            </select>
          </label>
          <p v-if="settingsError" class="error">{{ settingsError }}</p>
          <p v-if="settingsSuccess" class="success">{{ settingsSuccess }}</p>
          <AppButton type="submit" :disabled="savingSettings">{{ savingSettings ? 'Saving…' : 'Save' }}</AppButton>
        </form>
      </AppCard>

      <AppCard class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--members">
            <Lock :size="20" />
          </span>
          <h3>Your admin PIN</h3>
        </div>
        <p class="hint">
          Your PIN opens your admin profile on this device, and confirms changes to the family. Changing it asks for the
          current PIN first.
        </p>
        <AppButton variant="secondary" @click="openChangePin">Change my PIN</AppButton>
      </AppCard>

      <!-- Family members & devices: each member, and the devices they're using. Admins manage members. -->
      <AppCard class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--members">
            <Users :size="20" />
          </span>
          <h3>Family members &amp; Devices</h3>
        </div>
        <p class="hint">Who is using each device.</p>
        <ul class="module-list">
          <ListRow v-for="m in members" :key="m.id">
            <div class="member-row">
              <div class="member-row__avatar">
                <img v-if="assetUrl(m.avatar_asset_id)" :src="assetUrl(m.avatar_asset_id)" alt="" />
                <span v-else :style="{ background: m.avatar_color || 'var(--accent-container)' }">{{ initials(m.name) }}</span>
              </div>
              <div class="member-row__body">
                <div class="member-row__name-line">
                  <span class="member-row__name">{{ firstName(m.name) }}</span>
                </div>
              </div>
              <select
                v-if="core.isAdmin"
                class="member-role-select"
                :value="m.role"
                @change="changeRole(m, $event.target.value, $event.target)"
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
              <span v-else class="hint">{{ m.role === 'admin' ? 'Admin' : 'Member' }}</span>
            </div>
            <ul v-if="devicesOf(m.id).length" class="device-list">
              <li v-for="d in devicesOf(m.id)" :key="d.id" class="device-row">
                <span class="device-row__name">{{ d.label || 'Device' }}</span>
                <span class="hint">
                  <template v-if="d.id === thisDeviceId">This device · </template>{{ describeLastSeen(d.last_seen, clock) }}
                </span>
              </li>
            </ul>
          </ListRow>
          <ListRow v-if="noOneDevices.length">
            <p class="hint">No one signed in</p>
            <ul class="device-list">
              <li v-for="d in noOneDevices" :key="d.id" class="device-row">
                <span class="device-row__name">{{ d.label || 'Device' }}</span>
                <span class="hint">
                  <template v-if="d.id === thisDeviceId">This device · </template>{{ describeLastSeen(d.last_seen, clock) }}
                </span>
              </li>
            </ul>
          </ListRow>
        </ul>
        <p v-if="changeRoleError" class="error">{{ changeRoleError }}</p>

        <template v-if="core.isAdmin">
          <AppButton v-if="!showAddMember" variant="secondary" @click="showAddMember = true">+ Add member</AppButton>

          <AddRow v-else button-label="Add member" @submit="addMember">
            <FormField v-model="newMemberName" placeholder="Name" required />
            <select v-model="newMemberRole">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </AddRow>
          <p v-if="addMemberError" class="error">{{ addMemberError }}</p>
        </template>
      </AppCard>

      <!-- Data export + import, admin only -->
      <AppCard v-if="core.isAdmin" class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--data">
            <Database :size="20" />
          </span>
          <h3>Data export &amp; import</h3>
        </div>
        <p class="hint">
          Your family's data belongs to you — download it any time in an open, portable format, or restore from a
          previous backup.
        </p>

        <div class="export-grid">
          <div class="export-option">
            <div class="export-option__body">
              <strong>Full backup</strong>
              <p class="hint">The exact state of your family's data — for a full restore later, or moving to another install.</p>
            </div>
            <AppButton variant="secondary" @click="downloadBackup">
              <Download :size="16" style="vertical-align: -3px; margin-right: 4px" />Download full backup
            </AppButton>
          </div>
          <div class="export-option">
            <div class="export-option__body">
              <strong>Export data (JSON)</strong>
              <p class="hint">A readable copy of everything — announcements, to-dos, check-ins, and more.</p>
            </div>
            <AppButton variant="secondary" @click="downloadJsonExport">
              <Download :size="16" style="vertical-align: -3px; margin-right: 4px" />Export data (JSON)
            </AppButton>
          </div>
        </div>
        <p v-if="exportError" class="error">{{ exportError }}</p>

        <div v-if="sync.isHubMachine" class="restore-section">
          <strong>Restore from backup</strong>
          <p class="hint">
            Replaces ALL of your family's current data with the contents of a backup file, including photos —
            a full backup includes every photo you've uploaded, and restoring one replaces the photos on every
            device with the photos from the backup.
          </p>
          <AppButton variant="danger" @click="openRestoreModal">
            <Upload :size="16" style="vertical-align: -3px; margin-right: 4px" />Restore from backup…
          </AppButton>
        </div>
        <div v-else class="restore-section">
          <strong>Restore from the family computer</strong>
          <p class="hint">
            Backups are restored through Yggltree on the family computer. Open Settings there to restore one.
          </p>
        </div>
      </AppCard>
    </section>

    <!-- Sync: how this device's family connects. Setting up the relay and adding devices is for admins. -->
    <section v-if="core.isAdmin || relay" class="settings-group" aria-labelledby="group-sync">
      <h2 id="group-sync" class="settings-group__title">Sync</h2>
      <p class="settings-group__note">The connection between your devices.</p>

      <!-- Relay: sync through a relay the family runs on its own account. -->
      <AppCard v-if="core.isAdmin || relay" class="settings-card">
        <div class="settings-card__header">
          <span class="settings-icon-tile settings-icon-tile--data">
            <Database :size="20" />
          </span>
          <h3>Relay</h3>
        </div>

        <!-- A relay is set up on this device: show its status. Admins can add a device from here. -->
        <template v-if="relay">
          <p class="hint">Syncing through your relay.</p>
          <template v-if="core.isAdmin">
            <p v-if="relayVersion === 'current'" class="hint">
              Phones get this version of Yggltree from your relay. It's up to date.
            </p>
            <p v-else-if="relayVersion === 'outdated'" class="hint">
              Phones still get an older version of Yggltree from your relay. Update the relay so they get this one.
              It takes a few minutes, and phones keep working meanwhile.
            </p>
            <AppButton
              v-if="relayVersion === 'outdated'"
              variant="secondary"
              :disabled="relayUpdateBusy"
              @click="updateRelayNow"
            >
              {{ relayUpdateBusy ? 'Updating the relay… this takes a few minutes' : 'Update the relay' }}
            </AppButton>
            <p v-if="relayUpdateMessage" class="hint">{{ relayUpdateMessage }}</p>
          </template>
          <details v-if="core.isAdmin" class="relay-setup">
            <summary>Add a device</summary>
            <p class="hint">
              Scan this code with a phone's camera, or open the link on the device. Keep it private: the link contains
              the family key.
            </p>
            <img v-if="relayQr" :src="relayQr" alt="Family relay link" width="220" height="220" />
            <p class="add-device__url">{{ relayLink }}</p>
          </details>
        </template>

        <!-- No relay yet: one name, one button. -->
        <div v-else class="relay-setup">
          <p class="hint">
            Phones sync through a relay on your own Cloudflare account. Name it, and Yggltree sets it up for you.
          </p>
          <label class="form-field">
            <span class="form-field__label">Relay name</span>
            <input v-model="relayNameInput" type="text" autocomplete="off" />
          </label>
          <AppButton variant="primary" :disabled="relaySetupBusy !== ''" @click="setUpRelay">{{ setUpLabel }}</AppButton>
          <p class="hint">The first time, your browser opens a Cloudflare page. Click Allow there, then come back.</p>
          <p v-if="relaySetupError" class="error">{{ relaySetupError }}</p>

          <details class="relay-setup__advanced">
            <summary>Join a family that already syncs, or use a relay address</summary>
            <p class="hint">
              To join a family whose phones already sync, paste the family link from Add a device on the family computer.
              It keeps the phones connected. For a relay you deployed yourself, with no phones on it yet, paste its address.
            </p>
            <label class="form-field">
              <span class="form-field__label">Family link or relay address</span>
              <input v-model="relayUrlInput" type="text" placeholder="Paste the link or the address" autocomplete="off" />
            </label>
            <AppButton variant="secondary" @click="startRelay">Connect this computer</AppButton>
            <p v-if="relayError" class="error">{{ relayError }}</p>
          </details>

          <details class="relay-setup__advanced">
            <summary>Use a Cloudflare API token instead</summary>
            <label class="form-field">
              <span class="form-field__label">Cloudflare API token</span>
              <input v-model="cloudflareToken" type="password" autocomplete="off" />
            </label>
            <AppButton
              variant="secondary"
              :disabled="!cloudflareToken.trim() || relaySetupBusy !== ''"
              @click="connectWithToken"
            >
              {{ relaySetupBusy === 'connect-token' ? 'Checking the token…' : 'Connect with this token' }}
            </AppButton>
          </details>
        </div>

        <!-- A relay exists: manage it from a quiet section. -->
        <details v-if="core.isAdmin && relay" class="relay-setup">
          <summary>Manage the relay</summary>
          <p class="hint">Relay: <strong>{{ relay.url }}</strong></p>
          <p v-if="cloudflare.connected" class="hint">
            Cloudflare account: <strong>{{ cloudflare.accountName }}</strong>
          </p>
          <label class="form-field">
            <span class="form-field__label">New relay name</span>
            <input v-model="relayNameInput" type="text" autocomplete="off" />
          </label>
          <div class="relay-setup__actions">
            <AppButton variant="secondary" :disabled="relaySetupBusy !== ''" @click="buildRelay({ replacing: true })">
              {{ relaySetupBusy === 'replace' ? 'Replacing the relay… this takes a few minutes' : 'Replace the relay with a new one' }}
            </AppButton>
            <AppButton variant="danger" :disabled="relaySetupBusy !== ''" @click="eraseRelay">
              {{ relaySetupBusy === 'erase' ? 'Erasing…' : 'Erase the relay' }}
            </AppButton>
          </div>
          <AppButton
            v-if="cloudflare.method === 'token'"
            variant="secondary"
            :disabled="relaySetupBusy !== ''"
            @click="forgetCloudflare"
          >
            Forget this token
          </AppButton>
          <p v-if="relaySetupError" class="error">{{ relaySetupError }}</p>
        </details>
      </AppCard>

    </section>

    <AppModal :open="showChangePin" title="Change your admin PIN" @close="showChangePin = false">
      <PinForm :member-id="core.memberId" @saved="showChangePin = false" />
    </AppModal>

    <AppModal :open="showRestoreModal || sync.restoreStuck" title="Restore from backup" @close="closeRestoreModal">
      <div v-if="sync.restoreStuck" class="restore-modal">
        <p class="restore-warning">
          <AlertTriangle :size="18" class="restore-warning__icon" />
          <span>Restoring didn't finish on this computer.</span>
        </p>
        <p class="restore-stuck__copy">
          Download a backup now, then close any other Yggltree tabs or windows and press Retry. Don't reload or
          close this page until it succeeds.
        </p>
        <p v-if="exportError" class="error">{{ exportError }}</p>
        <p v-if="restoreError" class="error">{{ restoreError }}</p>
        <p v-if="restoreSuccess" class="success">{{ restoreSuccess }}</p>
        <div class="restore-modal__actions">
          <AppButton variant="secondary" type="button" :disabled="restoring" @click="downloadBackup">
            <Download :size="16" style="vertical-align: -3px; margin-right: 4px" />Download a backup first
          </AppButton>
          <AppButton variant="danger" type="button" :disabled="restoring" @click="retryRestore">
            {{ restoring ? 'Retrying…' : 'Retry' }}
          </AppButton>
        </div>
      </div>
      <div v-else class="restore-modal">
        <p class="restore-warning">
          <AlertTriangle :size="18" class="restore-warning__icon" />
          <span>
            This will permanently replace every to-do, event, shopping item, chore, message, check-in, and photo
            currently stored for your family with the contents of the file you upload. This cannot be undone.
          </span>
        </p>
        <p class="restore-stuck__copy">
          Other browsers on this computer just need to reload.
        </p>
        <label class="form-field">
          <span class="form-field__label">Backup file (.yggltree.json)</span>
          <input ref="restoreInputEl" type="file" accept=".json,.yggltree.json,application/json" @change="onRestoreFileChange" />
        </label>
        <FormField
          v-model="restoreConfirmText"
          label='Type "REPLACE" to confirm'
          placeholder="REPLACE"
        />
        <p v-if="restoreError" class="error">{{ restoreError }}</p>
        <p v-if="restoreSuccess" class="success">{{ restoreSuccess }}</p>
        <div class="restore-modal__actions">
          <AppButton variant="ghost" type="button" :disabled="restoring" @click="closeRestoreModal">Cancel</AppButton>
          <AppButton
            variant="danger"
            type="button"
            :disabled="restoring || restoreConfirmText !== 'REPLACE' || !restoreFile"
            @click="confirmRestore"
          >
            {{ restoring ? 'Restoring…' : 'Replace all data' }}
          </AppButton>
        </div>
      </div>
    </AppModal>

  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Card language match (DashboardPage/TodosPage/BinderPage precedent): white
   rounded-16px surface + soft elevation shadow instead of AppCard's default
   centered-modal look, which this page overrides the same way BinderPage's
   .binder-help / .binder-section do. */
.settings-card {
  max-width: none;
  margin: 0;
  padding: 20px;
  text-align: left;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
}

.settings-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.settings-card__header h3 {
  margin: 0;
}

/* Icon tiles: 44x44px rounded-12px squares with a gradient background and a
   white lucide icon, matching DashboardPage/BinderPage/TodosPage's shared
   icon-tile language. Each section gets a distinct gradient identity from
   the token families (accent/complement) rather than a new hex. */
.settings-icon-tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
}

.settings-icon-tile--household { background: linear-gradient(135deg, var(--accent-soft), var(--accent)); }
.settings-icon-tile--profile { background: linear-gradient(135deg, var(--complement-mid), var(--complement)); }
.settings-icon-tile--members { background: linear-gradient(135deg, var(--tile-recipe-start), var(--accent)); }
.settings-icon-tile--data { background: linear-gradient(135deg, var(--tile-library), var(--tile-library-deep)); }
.settings-icon-tile--appearance { background: linear-gradient(135deg, var(--accent-soft), var(--complement)); }

/* Theme picker: a wrapping row of compact chips, each a real button (radiogroup).
   The two dots are the theme's main colors; the name follows them. */
.theme-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.theme-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 6px 14px 6px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  font: var(--type-label);
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.theme-chip:hover {
  border-color: color-mix(in srgb, var(--text) 30%, var(--border));
}

/* A thicker border with less padding keeps the chip the same size when selected. */
.theme-chip--selected {
  border: 2px solid var(--accent);
  padding: 5px 13px 5px 9px;
  background: var(--accent-container);
  color: var(--on-accent-container);
}

.theme-chip__dots {
  display: inline-flex;
  gap: 3px;
  flex: none;
}

.theme-chip__dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: var(--elevation-1);
}

.theme-chip__label {
  font-weight: 600;
}

.settings-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.success {
  color: var(--accent);
  font-size: 14px;
}

.hint {
  color: var(--text-muted);
  font: var(--type-label);
  font-size: 12px;
  margin: 0 0 8px;
}

.avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.avatar-preview {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--accent-container);
  color: var(--on-accent-container);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 20px;
  flex-shrink: 0;
}

.avatar-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.avatar-upload-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.avatar-upload-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* This row wraps at narrow widths (avatar + name/email block
   + role select all fixed/shrinking together would otherwise overlap on a
   real phone viewport -- min-width:0 defeats flex-wrap). .member-row__body gets a real min-width
   below so it triggers the wrap instead of shrinking indefinitely. */
.member-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  width: 100%;
}

.member-row__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.member-row__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.member-row__avatar span {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--on-accent-container);
  font-weight: 600;
  font-size: 14px;
}

.member-row__body {
  flex: 1;
  /* Real min-width (not 0) so this block triggers .member-row's flex-wrap
     instead of shrinking indefinitely against the fixed-width role select
     next to it -- the min-width:0-defeats-wrap bug documented above. */
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.member-row__name-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.member-row__name {
  font-weight: 600;
}

.member-role-select {
  flex: none;
  font: var(--type-label);
}

.device-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
}

.device-row__name {
  font-weight: 600;
}

.device-row .hint {
  margin: 0;
}

/* The three groups on this page: You, Family, Sync. Each has a title and a line saying who it reaches. */
.settings-group {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 8px;
}

.settings-group__title {
  margin: 0;
  font-size: 1.25rem;
}

.settings-group__note {
  margin: -8px 0 0;
  color: var(--text-muted);
  font: var(--type-label);
}

/* Under a member's row, indented to line up with the name (avatar 40px + 12px gap). */
.device-list {
  list-style: none;
  margin: 8px 0 0 52px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.export-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 8px;
}

/* Flex-wrap fix: title/hint block wraps onto its own line above the
   Download button at narrow widths instead of both being squeezed until
   they overlap -- .export-option__body gets a real min-width below so it
   actually triggers the wrap (the min-width:0-defeats-wrap bug documented
   on .member-row above). */
.export-option {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px 16px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.export-option__body {
  flex: 1;
  min-width: 200px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.export-option .app-btn {
  flex: none;
}

.export-option__body .hint {
  margin: 0;
}

.restore-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.restore-modal {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 320px;
}

.restore-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--danger);
  font: var(--type-body);
  margin: 0;
}

.restore-warning__icon {
  flex: none;
  margin-top: 2px;
}

.restore-modal__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.restore-stuck__copy {
  font: var(--type-body);
  margin: 0;
}

.add-device__url {
  font: var(--type-label);
  text-align: center;
  overflow-wrap: anywhere;
  margin: 0;
}

.relay-setup {
  display: grid;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}

.relay-setup h4 {
  margin: 0;
  font-size: 1rem;
}

.relay-setup__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.relay-setup__advanced {
  display: grid;
  gap: 12px;
}

.relay-setup__advanced summary {
  cursor: pointer;
  color: var(--text-muted);
}

</style>
