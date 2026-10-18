<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCoreStore } from '../stores/core'
import { useSyncStore } from '../stores/sync'
import { connectState } from '../lib/connectState'
import { family } from '../data/family'
import { createBackup } from '../data/backupFormat.js'
import { parseRelayLink } from '../data/relay/config.js'
import { stageMessage } from '../data/relay/stage.js'
import { offerRelayJoin } from '../data/relay/pending.js'
import { isIosDevice, isIosSafariTab, isStandaloneApp } from '../lib/platform.js'
import IosInstallGuide from '../components/IosInstallGuide.vue'
import { inDesktopApp } from '../lib/platform.js'

// The desktop app's window says the app's way; a browser on a source checkout keeps the npm wording.
const notRunningHint = inDesktopApp()
  ? 'Open Yggltree from the leaf in your menu bar, then reload.'
  : 'Start Yggltree on this computer (npm start), then reload.'

// Where a device waits while it has no family yet (joining it, pulling the
// family from the hub, the hub not running), and where it confirms
// replacing this device's family with the hub's or uploading it to an
// empty hub. The router never sends a device here once it has a
// family, except for a pending replace.
//
// A phone joins by scanning the family's QR code from Settings → Family
// relay, or by pasting the family link. Both are handled below.
const GETTING_STARTED_URL = 'https://github.com/cored3sign/yggltree#readme'
const SLOW_HINT_MS = 10_000

const core = useCoreStore()
const sync = useSyncStore()
const router = useRouter()

// An iPhone Safari tab with no family is sent to the Home Screen app first.
// "Use in Safari instead" turns that off for this page load.
const iosSafari = isIosSafariTab()
const useSafariInstead = ref(false)
const state = computed(() =>
  connectState({
    pendingReplace: sync.pendingReplace,
    replaceStuck: sync.replaceStuck,
    problem: sync.problem,
    role: sync.role,
    hubInfo: sync.hubInfo,
    config: sync.config,
    status: sync.status,
    installFirst: iosSafari && !useSafariInstead.value,
  }),
)
const hubAddress = computed(() => sync.config?.hubUrl ?? sync.pendingReplace?.hubUrl ?? '')

// Guards only run on navigation: leave once the family has arrived (and
// nothing is pending), or once this computer may set up.
watch(
  () => (core.familyReady && !sync.pendingReplace) || (!core.familyReady && sync.canSetUp),
  (leave) => {
    if (leave) router.replace('/')
  },
)

// The step the relay connection is on (opening storage, reaching the relay, waiting for the family's data),
// so a stall says where it is.
const stepText = computed(() =>
  stageMessage(sync.relayStage, {
    storageTimedOut: sync.storageTimedOut,
    errorCode: sync.relayErrorCode,
    attempts: sync.relayAttempts,
  }),
)

// "connecting" grows a hint if it takes a while.
const slow = ref(false)
let slowTimer = null
onMounted(() => {
  slowTimer = setTimeout(() => (slow.value = true), SLOW_HINT_MS)
})
onBeforeUnmount(() => clearTimeout(slowTimer))

// --- not-paired: a family link pasted in (a home-screen app can't read Safari's link) ---
const relayLinkText = ref('')
const relayLinkError = ref('')

function useRelayLink() {
  relayLinkError.value = ''
  const candidate = parseRelayLink(relayLinkText.value)
  if (!candidate) {
    relayLinkError.value = "That isn't a family link. Copy the whole link from Settings → Sync."
    return
  }
  if (!offerRelayJoin(candidate)) {
    relayLinkError.value = 'This device already uses that family.'
    return
  }
  relayLinkText.value = ''
}

// On an iPhone Home Screen app, the join needs its own scan (see IosInstallGuide.vue).
const iosHomeScreenApp = isIosDevice() && isStandaloneApp()

// --- not-paired: scan the family's QR code, or paste the family link ---
const showScanner = ref(false)

function onFamilyQrScanned(text) {
  showScanner.value = false
  relayLinkText.value = text
  useRelayLink()
}


// --- confirm-replace / adopt ---
// A failed wipe moves to 'replace-failed' (store.replaceStuck): the docs
// are destroyed, so only Retry and a backup download are offered there --
// Y.Doc.destroy() keeps the in-memory state, so createBackup still works.
const busy = ref(false)
const replaceError = ref('')
const backupError = ref('')

async function confirm() {
  replaceError.value = ''
  busy.value = true
  try {
    await sync.confirmReplace() // reloads on success
  } catch (err) {
    replaceError.value = err.message
    busy.value = false
  }
}

function cancel() {
  replaceError.value = ''
  sync.cancelReplace()
  router.replace('/')
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10)
}

function downloadBackup() {
  backupError.value = ''
  try {
    const url = URL.createObjectURL(new Blob([createBackup(family())], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: `yggltree-backup-${todayStamp()}.yggltree.json` })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (err) {
    backupError.value = err.message
  }
}

function reload() {
  window.location.reload()
}
</script>

<template>
  <AppCard class="connect-card">
    <template v-if="state === 'confirm-replace'">
      <h1>Replace this device's family?</h1>
      <p class="subtitle">
        This device already has family data that isn't from this Yggltree. Replacing it deletes that data from
        this device and loads your family from the hub. Download a backup first if you might need it.
      </p>
      <div class="connect-actions">
        <AppButton variant="secondary" :disabled="busy" @click="downloadBackup">Download a backup first</AppButton>
        <AppButton variant="danger" :disabled="busy" @click="confirm">{{ busy ? 'Replacing…' : 'Replace' }}</AppButton>
        <AppButton variant="ghost" :disabled="busy" @click="cancel">Cancel</AppButton>
      </div>
      <p v-if="backupError" class="error">{{ backupError }}</p>
      <p v-if="replaceError" class="error">{{ replaceError }}</p>
    </template>

    <template v-else-if="state === 'replace-failed'">
      <h1>Replacing didn't finish</h1>
      <p class="subtitle">
        Download a backup now, then close any other Yggltree tabs or windows and press Retry. Don't reload or close
        this page until it succeeds.
      </p>
      <div class="connect-actions">
        <AppButton variant="secondary" :disabled="busy" @click="downloadBackup">Download a backup first</AppButton>
        <AppButton variant="danger" :disabled="busy" @click="confirm">{{ busy ? 'Replacing…' : 'Retry' }}</AppButton>
      </div>
      <p v-if="backupError" class="error">{{ backupError }}</p>
      <p v-if="replaceError" class="error">{{ replaceError }}</p>
    </template>

    <template v-else-if="state === 'confirm-adopt'">
      <h1>Your Yggltree is empty</h1>
      <p class="subtitle">
        This computer already has your family's data. Upload it to the hub so phones and tablets can sync with it.
      </p>
      <div class="connect-actions">
        <AppButton variant="primary" :disabled="busy" @click="confirm">
          {{ busy ? 'Uploading…' : replaceError ? 'Retry' : "Upload this computer's copy to the hub" }}
        </AppButton>
        <AppButton variant="secondary" :disabled="busy" @click="downloadBackup">Download a backup first</AppButton>
        <AppButton variant="ghost" :disabled="busy" @click="cancel">Cancel</AppButton>
      </div>
      <p v-if="backupError" class="error">{{ backupError }}</p>
      <p v-if="replaceError" class="error">{{ replaceError }}</p>
    </template>

    <template v-else-if="state === 'needs-pairing'">
      <h1>Reconnect this device</h1>
      <p class="subtitle">{{ sync.statusCopy.message }}</p>
    </template>

    <template v-else-if="state === 'hub-not-running'">
      <h1>Yggltree isn't running</h1>
      <p class="subtitle">{{ notRunningHint }}</p>
      <div class="connect-actions">
        <AppButton variant="primary" @click="reload">Reload</AppButton>
      </div>
    </template>

    <template v-else-if="state === 'install-first'">
      <h1>Step 1 of 2: put Yggltree on your Home Screen</h1>
      <IosInstallGuide @safari-instead="useSafariInstead = true" />
    </template>

    <template v-else-if="state === 'not-paired'">
      <h1>Join your family</h1>
      <p class="connect-text">Scan the QR code on the family computer.</p>
      <p v-if="iosHomeScreenApp" class="connect-text connect-text--muted">
        iPhone keeps this app's data apart from Safari, so it needs its own scan. You only do this once.
      </p>
      <AppButton variant="primary" type="button" @click="showScanner = true">Scan the family QR code</AppButton>
      <BarcodeScanner v-if="showScanner" kind="qr" @detected="onFamilyQrScanned" @close="showScanner = false" />
      <form class="connect-code" novalidate @submit.prevent="useRelayLink">
        <label class="form-field connect-code__field">
          <span class="form-field__label">Or paste the family link</span>
          <input v-model="relayLinkText" class="connect-code__input" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </label>
        <AppButton variant="secondary" type="submit">Use this link</AppButton>
      </form>
      <p v-if="relayLinkError" class="error" role="alert">{{ relayLinkError }}</p>
      <p class="connect-text connect-text--muted">
        First time? <a :href="GETTING_STARTED_URL" target="_blank" rel="noopener">Read the getting-started guide</a>.
      </p>
    </template>

    <template v-else-if="state === 'hub-empty'">
      <h1>Almost there</h1>
      <p class="subtitle">Finish setting up on the family computer first.</p>
    </template>

    <template v-else>
      <h1>Connecting to your Yggltree…</h1>
      <p v-if="hubAddress" class="subtitle">{{ hubAddress }}</p>
      <p v-if="stepText" class="connect-text connect-text--muted">{{ stepText }}</p>
      <p v-if="slow" class="connect-text connect-text--muted">
        Check that this phone has a connection, on Wi-Fi or mobile data. If it stays here, check that the family computer
        is on and Yggltree is running there.
      </p>
    </template>
  </AppCard>
</template>

<style scoped>
.connect-card {
  max-width: 420px;
}
.connect-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.connect-text {
  margin: 0 0 12px;
}
.connect-text--muted {
  color: var(--text-muted);
  font-size: 14px;
}
.connect-card .error {
  margin-top: 12px;
}
.connect-code {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}
.connect-code__input {
  font-size: 22px;
  letter-spacing: 0.12em;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
</style>
