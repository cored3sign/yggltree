<script setup>
// Shown to an admin who has no PIN yet: the first admin after setup, or an existing
// admin after this update. The app opens once the PIN is saved.
import { useRouter } from 'vue-router'
import { useCoreStore } from '../stores/core'
import PinForm from '../components/PinForm.vue'

const core = useCoreStore()
const router = useRouter()

function saved() {
  router.push('/')
}
</script>

<template>
  <AppCard class="pin-setup-card">
    <h1>Set your admin PIN</h1>
    <p class="hint">
      Admins use a six-digit PIN to open the admin profile on this device and to confirm changes to the family.
      Choose one you will remember.
    </p>
    <PinForm :member-id="core.memberId" @saved="saved" />
    <p class="hint">
      If you forget it, choose <strong>Reset admin PIN…</strong> from the Yggltree menu bar icon on the family computer.
      Each admin then sets a new PIN.
    </p>
  </AppCard>
</template>

<style scoped>
.pin-setup-card {
  max-width: 480px;
}
</style>
