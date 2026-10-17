<script setup>
// The admin PIN prompt. Mounted once at the app root (App.vue); stores/adminLock.js opens it.
import { computed, ref, watch } from 'vue'
import { useAdminLockStore } from '../stores/adminLock'
import { family } from '../data/family'
import { memberName } from '../data/members'
import PinForm from './PinForm.vue'

const lock = useAdminLockStore()
const pin = ref('')
const name = computed(() => (lock.prompt ? memberName(family().doc, lock.prompt.memberId) : ''))

// Start empty each time the prompt opens.
watch(
  () => lock.prompt,
  (prompt) => {
    if (prompt) pin.value = ''
  },
)

function submit() {
  lock.submit(pin.value).then(() => {
    pin.value = ''
  })
}
</script>

<template>
  <AppModal :open="lock.prompt !== null" title="Enter your PIN" @close="lock.cancel()">
    <form v-if="lock.prompt" class="pin-prompt" @submit.prevent="submit">
      <p class="hint">{{ lock.prompt.reason }}</p>
      <label class="form-field">
        <span class="form-field__label">PIN for {{ name }}</span>
        <input v-model="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" required />
      </label>
      <p v-if="lock.prompt.error" class="error">{{ lock.prompt.error }}</p>
      <div class="pin-prompt__actions">
        <AppButton variant="ghost" type="button" @click="lock.cancel()">Cancel</AppButton>
        <AppButton type="submit" :disabled="lock.prompt.busy || pin.length !== 6">Confirm</AppButton>
      </div>
      <p class="hint">Forgot it? On the family computer, choose <strong>Reset admin PIN…</strong> from the Yggltree menu bar icon.</p>
    </form>
  </AppModal>
</template>

<style scoped>
.pin-prompt {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pin-prompt__actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
