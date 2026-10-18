<script setup>
import { ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { useCoreStore } from '../stores/core'
import { useSyncStore } from '../stores/sync'
import { family } from '../data/family'
import { createBackup } from '../data/backupFormat.js'

// First run, on the family computer only: the router only sends the
// hub machine here, and only while its hub has no family. Creating (or
// restoring) first claims the hub (POST /api/hub/claim), so two browsers
// on this computer can't both seed a family. Phones and tablets never see
// this page; they join with the family QR code from Settings -> Sync.
const core = useCoreStore()
const sync = useSyncStore()
const router = useRouter()
const familyName = ref('')
const yourName = ref('')
const error = ref('')
const creating = ref(false)

// Guards only run on navigation: leave as soon as a family arrives (e.g.
// another browser on this computer finished setup and it synced here).
// Never while a restore is stuck: the page must stay up for Retry.
watch(
  () => !sync.restoreStuck && (core.familyReady || !sync.canSetUp),
  (leave) => {
    if (leave) router.replace('/')
  },
)
onBeforeRouteLeave(() => !sync.restoreStuck)

async function submit() {
  error.value = ''
  creating.value = true
  try {
    await core.createFamily({ familyName: familyName.value, adminName: yourName.value })
    router.push('/')
  } catch (err) {
    error.value = err.message
  } finally {
    creating.value = false
  }
}

// --- Restore from a backup file instead ---
const showRestore = ref(false)
const restoreFile = ref(null)
const restoreConfirmText = ref('')
const restoreError = ref('')
const restoring = ref(false)

function openRestore() {
  restoreFile.value = null
  restoreConfirmText.value = ''
  restoreError.value = ''
  showRestore.value = true
}

function onRestoreFileChange(e) {
  restoreFile.value = e.target.files?.[0] || null
}

async function confirmRestore() {
  restoreError.value = ''
  if (!restoreFile.value) {
    restoreError.value = 'Choose a backup file to restore.'
    return
  }
  if (restoreConfirmText.value !== 'REPLACE') {
    restoreError.value = 'Type REPLACE exactly to confirm.'
    return
  }
  restoring.value = true
  try {
    // Claims first, unless a restore already reached the hub (then it
    // only retries this browser's part).
    await sync.restoreForSetup(restoreFile.value) // reloads on success
  } catch (err) {
    restoreError.value = err.message
  } finally {
    restoring.value = false
  }
}

// The hub restored but this browser's wipe failed (sync.restoreStuck): the
// open family is gone, so only a backup download and Retry are offered,
// as in Settings. Retry reuses the hub's answer and never claims again.
async function retryRestore() {
  restoreError.value = ''
  restoring.value = true
  try {
    await sync.retryRestore() // reloads on success
  } catch (err) {
    restoreError.value = err.message
  } finally {
    restoring.value = false
  }
}

const backupError = ref('')

function downloadBackup() {
  backupError.value = ''
  try {
    const url = URL.createObjectURL(new Blob([createBackup(family())], { type: 'application/json' }))
    const stamp = new Date().toISOString().slice(0, 10)
    const a = Object.assign(document.createElement('a'), { href: url, download: `yggltree-backup-${stamp}.yggltree.json` })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (err) {
    backupError.value = err.message
  }
}

function closeRestore() {
  if (restoring.value || sync.restoreStuck) return
  showRestore.value = false
}
</script>

<template>
  <AppCard>
    <h1>Set up your Yggltree</h1>
    <p class="subtitle">Set up your family on this computer. Phones and tablets join later with the family QR code from Settings → Sync.</p>
    <form class="auth-form" @submit.prevent="submit">
      <FormField v-model="familyName" label="Family name" placeholder="The Smiths" required />
      <FormField v-model="yourName" label="Your name" placeholder="Alex" required />
      <p v-if="error" class="error">{{ error }}</p>
      <AppButton type="submit" variant="primary" :disabled="creating">
        {{ creating ? 'Creating…' : 'Create family' }}
      </AppButton>
      <AppButton type="button" variant="ghost" :disabled="creating" @click="openRestore">
        Restore from a backup file instead
      </AppButton>
    </form>
  </AppCard>

  <AppModal :open="showRestore || sync.restoreStuck" title="Restore from a backup file" @close="closeRestore">
    <div v-if="sync.restoreStuck" class="setup-restore">
      <p class="error">Restoring didn't finish on this computer.</p>
      <p>
        Download a backup now, then close any other Yggltree tabs or windows and press Retry. Don't reload or
        close this page until it succeeds.
      </p>
      <p v-if="backupError" class="error">{{ backupError }}</p>
      <p v-if="restoreError" class="error">{{ restoreError }}</p>
      <div class="setup-restore__actions">
        <AppButton variant="secondary" type="button" :disabled="restoring" @click="downloadBackup">
          Download a backup first
        </AppButton>
        <AppButton variant="danger" type="button" :disabled="restoring" @click="retryRestore">
          {{ restoring ? 'Retrying…' : 'Retry' }}
        </AppButton>
      </div>
    </div>
    <div v-else class="setup-restore">
      <p>
        Your family is created from the backup file (a <code>.yggltree.json</code> file from Settings → Data export
        &amp; import → Download full backup), including photos.
      </p>
      <label class="form-field">
        <span class="form-field__label">Backup file (.yggltree.json)</span>
        <input type="file" accept=".json,.yggltree.json,application/json" @change="onRestoreFileChange" />
      </label>
      <FormField v-model="restoreConfirmText" label='Type "REPLACE" to confirm' placeholder="REPLACE" />
      <p v-if="restoreError" class="error">{{ restoreError }}</p>
      <div class="setup-restore__actions">
        <AppButton variant="ghost" type="button" :disabled="restoring" @click="closeRestore">Cancel</AppButton>
        <AppButton
          variant="danger"
          type="button"
          :disabled="restoring || restoreConfirmText !== 'REPLACE' || !restoreFile"
          @click="confirmRestore"
        >
          {{ restoring ? 'Restoring…' : 'Restore' }}
        </AppButton>
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
.setup-restore {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 280px;
}
.setup-restore__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
