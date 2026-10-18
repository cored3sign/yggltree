<script setup>
// The admin's checklist for a new family. The dashboard shows one slim button at the top, with how many steps are
// left, and the checklist opens in a dialog, so the dashboard's content stays where it is. Once every step is done,
// the button is gone.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Check, ListChecks } from 'lucide-vue-next'
import { useFamily, useLive } from '../data/vue'
import { listDevices } from '../data/presence.js'
import { loadRelayConfig, relayDeviceId } from '../data/relay/config.js'
import { useCoreStore } from '../stores/core'

const core = useCoreStore()
const router = useRouter()
const { doc } = useFamily()
const devices = useLive(listDevices)
const open = ref(false)

const steps = computed(() => {
  const others = devices.value.filter((d) => d.id !== relayDeviceId())
  return [
    { key: 'family', label: 'Your family is set up', done: true },
    { key: 'pin', label: 'Your admin PIN is set', done: !core.needsAdminPin },
    { key: 'relay', label: 'Set up the relay, so phones can sync', done: Boolean(loadRelayConfig()), to: '/settings' },
    { key: 'device', label: 'Add a phone or another computer', done: others.length > 0, to: '/settings' },
  ]
})

const remaining = computed(() => steps.value.filter((s) => !s.done).length)
const doneCount = computed(() => steps.value.length - remaining.value)
const familyName = computed(() => core.familyName || 'your family')

function go(path) {
  open.value = false
  router.push(path)
}
</script>

<template>
  <div v-if="remaining > 0" class="finish-setup">
    <button type="button" class="finish-setup__trigger" :aria-expanded="open" @click="open = true">
      <ListChecks :size="16" aria-hidden="true" />
      <span>Finish setting up</span>
      <span class="finish-setup__count">{{ doneCount }} of {{ steps.length }}</span>
    </button>

    <AppModal :open="open" :title="`Finish setting up ${familyName}`" @close="open = false">
      <p class="hint">A few steps, and the family is ready. Only you see this list.</p>
      <ul class="finish-setup__steps">
        <li v-for="s in steps" :key="s.key" class="finish-setup__step" :class="{ 'finish-setup__step--done': s.done }">
          <span class="finish-setup__mark" aria-hidden="true">
            <Check v-if="s.done" :size="14" />
          </span>
          <span class="finish-setup__label">{{ s.label }}</span>
          <AppButton v-if="!s.done && s.to" variant="secondary" @click="go(s.to)">Open</AppButton>
        </li>
      </ul>
    </AppModal>
  </div>
</template>

<style scoped>
.finish-setup {
  margin: 0 0 16px;
}

.finish-setup__trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: none;
  border-radius: 999px;
  background: var(--accent-container);
  color: var(--on-accent-container);
  font: var(--type-label);
  font-weight: 600;
  cursor: pointer;
}

.finish-setup__count {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--text-muted);
  font-weight: 500;
}

.finish-setup__steps {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.finish-setup__step {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.finish-setup__mark {
  width: 22px;
  height: 22px;
  border: 2px solid var(--border);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.finish-setup__step--done .finish-setup__mark {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}

.finish-setup__step--done .finish-setup__label {
  color: var(--text-muted);
  text-decoration: line-through;
}

.finish-setup__label {
  flex: 1;
  min-width: 180px;
}
</style>
