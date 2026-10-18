<script setup>
// Help page: tutorial replay, install instructions and the live Sync card.
// Not a module (there is no per-module gate), same
// platform-level tier as Settings/Modules -- manually routed in router.js,
// same precedent as those two.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { AlertTriangle, Cloud, CloudOff, HelpCircle, Loader, Smartphone, WifiOff } from 'lucide-vue-next'
import { useOnboardingStore } from '../stores/onboarding'
import { useCoreStore } from '../stores/core'
import { useSyncStore } from '../stores/sync'
import { SYNC_ICON, syncMessage, lastSyncedText } from '../lib/syncIndicator'
import { loadRelayConfig } from '../data/relay/config'

// The onboarding tutorial's callout sequence lives in its Pinia store --
// this page only calls the store's start() action, same mechanism the
// tutorial uses to auto-start on first
// login, so "View tutorial" here just re-triggers it on demand rather than
// implementing any of the tutorial itself.
const onboarding = useOnboardingStore()

function startTutorial() {
  onboarding.start()
}

// Live Sync card (the header indicator links to /help#sync).
const sync = useSyncStore()
const core = useCoreStore()
const route = useRoute()
const ICONS = { AlertTriangle, Cloud, CloudOff, Loader, WifiOff }
const syncIcon = computed(() => ICONS[SYNC_ICON[sync.status]] ?? Cloud)
const now = ref(new Date())
let timer = null
const syncMessageText = computed(() => syncMessage({ status: sync.status, statusCopy: sync.statusCopy }, now.value))
const lastSynced = computed(() => lastSyncedText(sync.lastSyncedAt, now.value))
// The family relay: the address phones sync through and open to install the
// app. Read once; the relay is set up from Settings, which reloads the page.
const relayAddress = loadRelayConfig()?.url ?? null
// Which copy of the app this is, for comparing devices: the version number and the build stamp. Phones load
// the app from the relay, so a phone's build is the relay's build.
const APP_VERSION = __APP_VERSION__
const APP_BUILD = __APP_BUILD_VERSION__
const runningFrom = computed(() => (sync.isHubMachine ? 'This family computer' : 'Your family relay'))

// No router scrollBehavior: scroll to the card for /help#sync ourselves.
function scrollToHash() {
  if (route.hash !== '#sync') return
  nextTick(() => document.getElementById('sync')?.scrollIntoView({ block: 'start' }))
}
onMounted(() => {
  timer = setInterval(() => (now.value = new Date()), 30000)
  scrollToHash()
})
onUnmounted(() => clearInterval(timer))
watch(() => route.hash, scrollToHash)
</script>

<template>
  <div class="module-page help-page">
    <h2>Help</h2>

    <AppCard class="settings-card">
      <div class="settings-card__header">
        <span class="settings-icon-tile settings-icon-tile--tutorial">
          <HelpCircle :size="20" />
        </span>
        <h3>Tutorial</h3>
      </div>
      <p class="subtitle">Walk back through the guided tour of Yggltree, step by step.</p>
      <AppButton @click="startTutorial">View tutorial</AppButton>
    </AppCard>

    <!-- Live sync status: the same state and copy as the header indicator
         (stores/sync.js, data/sync/status.js). -->
    <AppCard id="sync" class="settings-card sync-card">
      <div class="settings-card__header">
        <span class="settings-icon-tile settings-icon-tile--status">
          <component :is="syncIcon" :size="20" />
        </span>
        <h3>Sync</h3>
      </div>
      <p class="sync-state" :class="`sync-state--${sync.statusCopy.tone}`">
        <span class="sync-state__dot" aria-hidden="true" />
        <strong>{{ sync.statusCopy.label }}</strong>
      </p>
      <p class="subtitle">{{ syncMessageText }}</p>

      <dl class="sync-facts">
        <div>
          <dt>Last synced</dt>
          <dd>{{ lastSynced }}</dd>
        </div>
        <div v-if="relayAddress">
          <dt>Family relay</dt>
          <dd class="sync-facts__address">{{ relayAddress }}</dd>
        </div>
        <div>
          <dt>This device</dt>
          <dd v-if="sync.isHubMachine">This computer is your Yggltree.</dd>
          <dd v-else-if="sync.config">Joined to your family.</dd>
          <dd v-else>Not joined to a family yet.</dd>
        </div>
      </dl>

      <p v-if="sync.isHubMachine" class="hint">
        <template v-if="core.isAdmin">
          To add a device, open <router-link to="/settings">Settings</router-link> → Sync, expand Add a device, and scan
          its QR code with the phone.
        </template>
        <template v-else>
          An admin can add devices in <router-link to="/settings">Settings</router-link> on this computer.
        </template>
      </p>
      <p v-else class="hint">
        To join this device again, scan the family QR code from Settings → Sync on the family computer. Your
        changes stay saved on this device while it isn't syncing.
      </p>
    </AppCard>

    <AppCard class="settings-card">
      <div class="settings-card__header">
        <span class="settings-icon-tile settings-icon-tile--app">
          <Smartphone :size="20" />
        </span>
        <h3>Install the app</h3>
      </div>
      <p class="subtitle">
        Yggltree works as an app straight from the browser -- no store, no sideloading, and no separate download to
        keep up to date. Install it after this phone has joined the family.
      </p>
      <p v-if="!relayAddress" class="hint">
        Set up the family relay first: open Settings → Sync on the family computer.
      </p>
      <ol class="app-install-steps">
        <li>On the family computer, open Settings → Sync, expand Add a device, and keep its QR code on screen.</li>
        <li>Scan the QR code with the phone's Camera app. It opens Yggltree in Safari.</li>
        <li>
          Put it on the Home Screen. iPhone: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, then
          <strong>Add</strong>. Android: tap the <strong>⋮</strong> menu, then <strong>Add to Home screen</strong>.
        </li>
        <li>
          Open Yggltree from its new icon and scan the QR code again. On iPhone this second scan is needed: the icon
          keeps its own data apart from Safari, and notifications only work from the icon.
        </li>
      </ol>
      <p class="hint">
        This creates a home-screen shortcut. Once the app has opened once, it also opens without a connection. Changes
        made without a connection wait on the phone and sync when it reaches the family relay again.
      </p>
    </AppCard>
    <section class="about" aria-label="About Yggltree">
      <dl class="about__versions" aria-label="Version details">
        <div>
          <dt>Version</dt>
          <dd>{{ APP_VERSION }}</dd>
        </div>
        <div>
          <dt>Build</dt>
          <dd><code>{{ APP_BUILD }}</code></dd>
        </div>
        <div>
          <dt>Running from</dt>
          <dd>{{ runningFrom }}</dd>
        </div>
      </dl>
      <p><strong>Yggltree</strong> &copy; 2026 Yggltree contributors. Free software under the MIT License.</p>
      <p>
        The software is provided &ldquo;as is&rdquo;, without warranty of any kind. &ldquo;Yggltree&rdquo; and the
        Yggltree logo are the names of this project. The license covers the code and documentation, not the names or
        the logo.
      </p>
      <p>Source and the full license: <a href="https://github.com/cored3sign/yggltree">github.com/cored3sign/yggltree</a></p>
    </section>
  </div>
</template>

<style scoped>
.help-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Card language match (SettingsPage.vue precedent): same card/header/icon-tile
   classes as Settings so Help reads as the same family of platform page,
   not a new layout style. */
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

.settings-icon-tile--tutorial { background: linear-gradient(135deg, var(--accent-soft), var(--accent)); }
.settings-icon-tile--app { background: linear-gradient(135deg, var(--complement-mid), var(--complement)); }

/* Neutral (checking/ok) vs. a distinct warning treatment (unreachable) --
   not color alone: the icon itself also changes (Wifi/WifiOff), matching
   this app's existing "never rely on color alone for state" convention
   (see e.g. LibraryPage.vue's status tags). */
.settings-icon-tile--status { background: linear-gradient(135deg, var(--complement-soft), var(--complement-mid)); }

/* The card the header indicator links to: keep it clear of the sticky
   topbar when scrolled into view. */
.sync-card {
  scroll-margin-top: 96px;
}

.sync-state {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  color: var(--text);
}

/* Same tones as the header indicator; the label carries the state too. */
.sync-state__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--sync-dot);
}

.sync-state--green { --sync-dot: #2e9d5b; }
.sync-state--yellow { --sync-dot: #f2c230; }
.sync-state--orange { --sync-dot: #f08a24; }
.sync-state--red { --sync-dot: #d93025; }
.sync-state--gray { --sync-dot: #9aa0a6; }

.sync-facts {
  display: grid;
  gap: 8px;
  margin: 0;
}

.sync-facts div {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.sync-facts dt {
  min-width: 140px;
  color: var(--text-muted);
  font: var(--type-label);
}

.sync-facts dd {
  margin: 0;
  color: var(--text);
}

.sync-facts__address {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  word-break: break-all;
}

.hint--warning {
  margin: 0 0 14px;
  border: 1px solid var(--danger);
  color: var(--text);
}

.subtitle {
  margin: 0 0 14px;
  color: var(--text-muted);
  font: var(--type-label);
}

.app-install-steps {
  margin: 16px 0 0;
  padding-left: 20px;
  color: var(--text);
}

.app-install-steps li {
  margin-bottom: 6px;
}

.hint {
  margin: 14px 0 0;
  padding: 10px 14px;
  background: var(--surface-variant);
  border-radius: 10px;
  color: var(--text-muted);
  font: var(--type-label);
}

/* Slightly stronger than a plain .hint: this one hands the person a value
   they need to actually type on another device, not just background
   context, so it reads first (margin-bottom instead of -top) and sits ahead
   of the numbered steps that reference it. */
.hint--address {
  margin: 0 0 14px;
  border: 1px solid var(--accent-soft);
}

.hint--address strong {
  color: var(--text);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  word-break: break-all;
}

.hint code {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  background: var(--surface);
  padding: 1px 5px;
  border-radius: 4px;
}
.about {
  margin-top: 32px;
  font-size: 0.9rem;
  color: var(--text-muted);
}

.about p + p {
  margin-top: 8px;
}

.about__versions {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 16px;
  margin: 0 0 16px;
}

.about__versions div {
  display: contents;
}

.about__versions dt {
  color: var(--text-muted);
}

.about__versions dd {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
</style>
