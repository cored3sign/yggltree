<script setup>
// On-device barcode scan.
//
// On-device scan, server-side data lookup -- two separate concerns: this
// component ONLY decodes a barcode from the camera feed and emits
// the digits. It never calls any lookup API itself and no video frame or
// image ever leaves the device -- the caller (LibraryPage) is responsible
// for taking the decoded value and calling library_lookup_isbn.
//
// Feature detection order:
//   1. Native BarcodeDetector (Chromium/Android today) -- zero extra bytes.
//   2. @zxing/browser (pure JS, works in Safari/iOS where the native API
//      doesn't exist).
//   3. Neither available (or getUserMedia itself denied/unsupported) ->
//      graceful fallback message, never a silent dead camera view. The
//      manual-ISBN-entry path remains available regardless.
//
// Secure-context note: getUserMedia requires a secure context. Chromium's
// localhost secure-context exception applies to the plain-http Vite dev
// server on localhost.
import { ref, onBeforeUnmount, onMounted } from 'vue'

const emit = defineEmits(['detected', 'close'])
// 'isbn' (book barcodes, digits only) or 'qr' (any QR code, the full text).
const props = defineProps({ kind: { type: String, default: 'isbn' } })

const videoEl = ref(null)
const status = ref('idle') // idle | starting | scanning | unsupported | denied | error
const errorMessage = ref('')

let mediaStream = null
let zxingReader = null
let nativeDetectorTimer = null

const SUPPORTED_ISBN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

function hasNativeBarcodeDetector() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

function hasGetUserMedia() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

async function start() {
  if (!hasGetUserMedia()) {
    status.value = 'unsupported'
    errorMessage.value = 'Camera access is not available in this browser.'
    return
  }
  if (!window.isSecureContext) {
    // Belt-and-suspenders: getUserMedia would already reject in this case,
    // but a distinct message is clearer than the generic error branch below.
    status.value = 'unsupported'
    errorMessage.value = 'Camera scan requires a secure connection (HTTPS or localhost).'
    return
  }

  status.value = 'starting'
  errorMessage.value = ''

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
  } catch (e) {
    status.value = e?.name === 'NotAllowedError' ? 'denied' : 'error'
    errorMessage.value =
      e?.name === 'NotAllowedError'
        ? 'Camera permission was denied. You can still enter the ISBN manually below.'
        : `Could not start the camera (${e?.message || e?.name || 'unknown error'}).`
    return
  }

  // Closed or unmounted while the permission prompt was open: release the stream we just got.
  if (!videoEl.value) {
    stop()
    return
  }
  videoEl.value.srcObject = mediaStream
  await videoEl.value.play()
  status.value = 'scanning'

  if (hasNativeBarcodeDetector()) {
    startNativeDetection()
  } else {
    await startZxingFallback()
  }
}

function startNativeDetection() {
  let detector
  try {
    detector = new window.BarcodeDetector({ formats: props.kind === 'qr' ? ['qr_code'] : SUPPORTED_ISBN_FORMATS })
  } catch {
    // formats option rejected (unsupported list) -- fall back to default ctor.
    detector = new window.BarcodeDetector()
  }

  const tick = async () => {
    if (status.value !== 'scanning' || !videoEl.value) return
    try {
      const codes = await detector.detect(videoEl.value)
      if (codes.length > 0) {
        handleDetected(codes[0].rawValue)
        return
      }
    } catch {
      // Transient decode errors (e.g. frame not ready) are expected during
      // normal scanning -- keep polling rather than surfacing every miss.
    }
    nativeDetectorTimer = requestAnimationFrame(tick)
  }
  nativeDetectorTimer = requestAnimationFrame(tick)
}

async function startZxingFallback() {
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    zxingReader = new BrowserMultiFormatReader()
    await zxingReader.decodeFromVideoElement(videoEl.value, (result, err) => {
      if (result && status.value === 'scanning') {
        handleDetected(result.getText())
      }
      // err fires continuously for "no barcode in this frame yet" -- not a
      // real failure, so it's intentionally ignored here.
    })
  } catch (e) {
    status.value = 'error'
    errorMessage.value = `Barcode scanning is unavailable in this browser (${e?.message || 'load failed'}). Enter the ISBN manually below.`
  }
}

function handleDetected(rawValue) {
  if (props.kind === 'qr') {
    if (!rawValue) return
    stop()
    emit('detected', String(rawValue))
    return
  }
  const digits = String(rawValue || '').replace(/[^0-9Xx]/g, '')
  if (digits.length < 10) return // not ISBN-shaped, keep scanning
  stop()
  emit('detected', digits)
}

function stop() {
  if (nativeDetectorTimer) {
    cancelAnimationFrame(nativeDetectorTimer)
    nativeDetectorTimer = null
  }
  if (zxingReader) {
    zxingReader.stopContinuousDecode?.()
    zxingReader = null
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
}

function closeAndStop() {
  stop()
  emit('close')
}

// QR mode asks for the camera as soon as it opens: one tap on the button, then the
// permission prompt, then the live view. No second "start" step.
onMounted(() => {
  if (props.kind === 'qr') start()
  // The desktop app hides the window rather than unloading the page, so the camera must stop on hide.
  window.addEventListener('yggltree:hidden', closeAndStop)
})

onBeforeUnmount(stop)
onBeforeUnmount(() => window.removeEventListener('yggltree:hidden', closeAndStop))

defineExpose({ start, stop })
</script>

<template>
  <div class="barcode-scanner">
    <div class="barcode-scanner__viewport" :class="{ 'is-active': status === 'scanning' }">
      <video ref="videoEl" muted playsinline></video>
      <div v-if="status === 'scanning'" class="barcode-scanner__reticle" aria-hidden="true"></div>
      <div v-if="status === 'starting'" class="barcode-scanner__overlay">Starting camera…</div>
    </div>

    <p v-if="status === 'unsupported'" class="barcode-scanner__message">
      {{ errorMessage }} Camera scanning needs a browser with camera support; you can still type the ISBN
      below.
    </p>
    <p v-else-if="status === 'denied'" class="barcode-scanner__message">{{ errorMessage }}</p>
    <p v-else-if="status === 'error'" class="barcode-scanner__message">{{ errorMessage }}</p>
    <p v-else-if="status === 'scanning'" class="barcode-scanner__hint">
      Point the camera at the book's barcode.
    </p>

    <div class="barcode-scanner__actions">
      <AppButton v-if="status === 'idle' && kind !== 'qr'" variant="primary" @click="start">Start camera</AppButton>
      <AppButton variant="ghost" @click="closeAndStop">Cancel</AppButton>
    </div>
  </div>
</template>

<style scoped>
.barcode-scanner {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.barcode-scanner__viewport {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
}

.barcode-scanner__viewport video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.barcode-scanner__reticle {
  position: absolute;
  inset: 20% 10%;
  border: 2px solid rgba(255, 255, 255, 0.85);
  border-radius: 8px;
  box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

.barcode-scanner__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font: var(--type-body);
  background: rgba(0, 0, 0, 0.35);
}

.barcode-scanner__message {
  font: var(--type-body);
  color: var(--text-muted);
  margin: 0;
}

.barcode-scanner__hint {
  font: var(--type-label);
  color: var(--text-muted);
  margin: 0;
  text-align: center;
}

.barcode-scanner__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
