<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCoreStore } from '../stores/core'
import { useOnboardingStore } from '../stores/onboarding'
import { findAddon, navigableAddons } from '../addons/registry'
import { assetUrl } from '../data/assets'
import { useFamily } from '../data/vue'
import { recordBirthdayReminders } from '../data/modules/birthdays'
import { appLoadedAt, openAfterPush } from '../lib/pushOpen'
import DesktopNav from '../components/DesktopNav.vue'
import YggltreeLogo from '../components/YggltreeLogo.vue'
import OnboardingCallout from '../components/OnboardingCallout.vue'
import SyncStatus from '../components/SyncStatus.vue'
import {
  LayoutGrid, LayoutDashboard, Settings as SettingsIcon, LogOut,
  Grid2x2Plus, Plus, X, RotateCw, ChevronDown, HelpCircle,
  CheckCircle2, Calendar, ShoppingCart, Coins, ChefHat,
  Megaphone, Target, Gift, Library, BookOpen, Cake,
} from 'lucide-vue-next'

// Explicit map, not a `import * as` wildcard -- keeps every module's icon
// tree-shakeable into its own small set instead of pulling the entire
// lucide-vue-next icon library into the shell's own chunk (every page goes
// through this layout, so its bundle size is the one every visit pays for).
// Keys match addons/registry.js's `lucideIcon` field 1:1.
const ICONS = {
  CheckCircle2, Calendar, ShoppingCart, Coins, ChefHat,
  Megaphone, Target, Gift, Library, BookOpen, Cake,
}

const core = useCoreStore()
const onboarding = useOnboardingStore()
const router = useRouter()

function iconFor(addon) {
  return ICONS[addon?.lucideIcon] || LayoutGrid
}

// Portrait-only, always 4 slots: a flat constant rather than a computed
// breakpoint check, since landscape is blocked (see .rotate-lock). The
// FAB/quick-select-drawer/pin-and-navigate behavior all use this one slot
// count.
const slotCount = 4

// The phone's bottom menu: the member's pins, in their order. A pin that doesn't match a module with a page (stale
// data) is skipped, so the nav never links to nothing.
const validPinned = computed(() =>
  core.pinnedModules
    .map(findAddon)
    .filter((addon) => Boolean(addon?.route))
)

// Only as many pinned modules as there are real
// slots for become visible nav items; the rest (if the member has pinned
// more than fit here) are reachable via the FAB's quick-select drawer,
// same as any enabled-but-never-pinned module.
const visibleNavItems = computed(() => validPinned.value.slice(0, slotCount))

// The full ordered nav sequence -- half the slots, the FAB, half the
// slots, built as one typed array so the template is a plain v-for with
// no index arithmetic to get subtly wrong at either breakpoint. Each
// empty-slot entry carries its own real slot index (0-based, among ALL
// slots, not just empty ones) so openDrawer(n) pins into the exact slot
// the member tapped.
const navSequence = computed(() => {
  const half = slotCount / 2
  const items = visibleNavItems.value
  const seq = []
  for (let i = 0; i < slotCount; i++) {
    if (i === half) seq.push({ type: 'fab' })
    seq.push(items[i] ? { type: 'module', addon: items[i] } : { type: 'empty', slotIndex: i })
  }
  return seq
})

// Quick-select drawer contents: every module NOT currently occupying a visible slot. That covers both "never
// pinned" and "pinned but overflowing this breakpoint's slot count", since both are just "not in the nav right now."
const visibleKeys = computed(() => new Set(visibleNavItems.value.map((a) => a.key)))
const quickSelectModules = computed(() => navigableAddons.filter((addon) => !visibleKeys.value.has(addon.key)))

const drawerOpen = ref(false)
// null = opened via the FAB (tapping a module just navigates); a number =
// opened via that empty slot index's "+" (tapping a module pins it into
// this slot, then navigates in -- reaching for an empty slot is itself
// the intent to use that module now).
const drawerPinTarget = ref(null)
const pinning = ref(false)

function openDrawer(pinTarget = null) {
  // Empty-list shortcut: nothing to quick-select means the drawer
  // would just be an extra tap before the same destination -- skip it.
  if (quickSelectModules.value.length === 0) {
    router.push('/modules')
    return
  }
  drawerPinTarget.value = pinTarget
  drawerOpen.value = true
}

function closeDrawer() {
  drawerOpen.value = false
  drawerPinTarget.value = null
}

async function selectModule(addon) {
  if (drawerPinTarget.value !== null) {
    pinning.value = true
    try {
      await core.pinModule(addon.key)
    } finally {
      pinning.value = false
    }
  }
  closeDrawer()
  router.push(addon.route)
}

// Same fallback as SettingsPage.vue's avatar rows (member-list rows and
// "my profile" both use this exact logic) -- not shared via a lib module,
// so copied verbatim rather than reimplemented differently here.
function initials(name) {
  return (name || '?')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

const menuOpen = ref(false)
const menuRootEl = ref(null)

// Same click-outside-to-close pattern NotificationBell.vue already uses.
function onClickOutsideMenu(e) {
  if (menuOpen.value && menuRootEl.value && !menuRootEl.value.contains(e.target)) {
    menuOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onClickOutsideMenu))
onUnmounted(() => document.removeEventListener('click', onClickOutsideMenu))

function switchProfile() {
  core.switchProfile()
  router.push('/profiles')
}

// Steps 1-2 anchor to elements that only exist in the MOBILE bottom-nav
// (`.nav-item--empty` / `.nav-fab`), which is `display: none` at the
// >=1200px desktop breakpoint where DesktopNav's left rail
// (`.desktop-rail` / `.desktop-nav__cta`) renders instead. Without
// desktop-specific steps, OnboardingCallout's own "no real anchor"
// fallback (see its measure()) would keep those two steps from breaking
// outright on desktop -- they'd just fall back to an unanchored, centered
// card -- but the copy would still describe mobile-only "empty slot"
// pinning, which doesn't exist on desktop (the rail lists every enabled
// module directly, no slots to pin into). Tracked reactively via matchMedia (no existing breakpoint-tracking
// JS anywhere in this codebase to mirror -- the portrait-lock above is
// CSS-only) so the step list recomputes live if the tour is open across a
// resize/orientation change, same as OnboardingCallout's own resize
// listener already keeps a step's highlight box in sync.
const DESKTOP_QUERY = '(min-width: 1200px)'
const desktopMql = window.matchMedia(DESKTOP_QUERY)
const isDesktop = ref(desktopMql.matches)
function onDesktopChange(e) {
  isDesktop.value = e.matches
}
onMounted(() => desktopMql.addEventListener('change', onDesktopChange))
onUnmounted(() => desktopMql.removeEventListener('change', onDesktopChange))

// Birthday reminders are written by whichever family device is open on the day (data/modules/birthdays.js
// makes the writes idempotent). Checked on load, every 30 minutes, and when the app comes back into view.
const { doc: familyDoc } = useFamily()
function checkBirthdays() {
  recordBirthdayReminders(familyDoc)
}
function onVisibilityChange() {
  if (document.visibilityState === 'visible') checkBirthdays()
}
let birthdayTimer = null
onMounted(() => {
  checkBirthdays()
  birthdayTimer = setInterval(checkBirthdays, 30 * 60_000)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onUnmounted(() => {
  clearInterval(birthdayTimer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// A phone notification opens the place that changed (lib/pushOpen.js). A cold start from one arrives as
// /dashboard?from=push and waits for the first change to sync in; a notification tapped while the app is open
// arrives as a message from the service worker.
function openFromPush(options) {
  return openAfterPush({ router, doc: familyDoc, memberId: core.memberId, ...options }).catch(() => {})
}
function onServiceWorkerMessage(event) {
  if (event.data?.type === 'open-latest-change') openFromPush({ since: Date.now() - 2 * 60 * 1000 })
}
onMounted(() => {
  const { from, ...query } = router.currentRoute.value.query
  if (from === 'push') {
    router.replace({ path: router.currentRoute.value.path, query })
    openFromPush({ since: appLoadedAt - 60 * 1000, waitMs: 8000 })
  }
  navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage)
})
onUnmounted(() => navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage))

// The tour's real step sequence. Anchored entirely to elements that
// already exist above -- no placeholder UI added for the tour's sake.
// Length must stay 4-6; the onboarding store's TOTAL_STEPS constant must
// match this array's length (kept in sync by hand, like any other "two
// things must agree" pair in this codebase).
//
// Step 3 differs by breakpoint. On a computer it points at the Dashboard link in the left rail, and it never opens the
// phone's quick-select drawer. On a phone it points at the drawer's "More modules" link, and the watch below opens that
// drawer for it. Step 4 (the topbar menu) is the same on both breakpoints.
const ONBOARDING_STEPS = computed(() => {
  const desktopSteps = [
    {
      // Step 1 (desktop): points at the FIRST enabled-module link (the
      // `.desktop-nav__item` immediately after the divider, via an adjacent-
      // sibling selector -- no markup change needed, DesktopNav.vue already
      // renders Dashboard, then the divider, then each module's own
      // `.desktop-nav__item` in a v-for) rather than the whole
      // `.desktop-rail` column: `.desktop-rail`/`.desktop-nav` both
      // span the full content-row height (height: 100%), so `placement:
      // 'below'` would position the callout at rect.bottom + gap -- off the
      // bottom of the viewport entirely. The highlight ring (rect.top/left
      // directly) would render correctly around the whole rail; only the
      // callout bubble itself, positioned relative to rect.bottom, would be
      // invisible. A single nav item is a normal ~40-50px box, so `below`
      // placement lands safely on-screen, and highlighting one real module
      // link (rather than a 1px divider, which would make an oddly
      // sliver-thin highlight ring) still visually represents "your
      // enabled modules show up here." Since "all modules enabled by
      // default" is this app's own signup default, a first-run family
      // always has at least one module link to anchor to in practice; if
      // one somehow doesn't exist yet, this step falls back to the
      // existing unanchored/centered treatment like any other missing
      // target (see OnboardingCallout.vue's own isRealAnchor handling).
      selector: '.desktop-nav__divider + .desktop-nav__item',
      placement: 'below',
      text: 'Every module is in this sidebar.',
    },
    {
      // Step 2 (desktop): DesktopNav.vue's "Add modules" CTA, the desktop
      // equivalent of the mobile FAB.
      selector: '.desktop-nav__cta',
      placement: 'above',
      text: 'The Modules page is here. Use it any time to see everything Yggltree does.',
    },
  ]
  const mobileSteps = [
    {
      // Step 1 (mobile): an empty bottom-nav slot -- only todos/shopping
      // are pre-pinned for new signups, so 2 of 4 slots are reliably empty
      // right after signup, giving this step something real and
      // immediately-actionable to point at.
      selector: '.nav-item--empty',
      placement: 'above',
      text: 'Tap an empty slot to pin a module you use often -- it\'ll show up here every time.',
    },
    {
      // Step 2 (mobile): the FAB, right next to the empty slots.
      selector: '.nav-fab',
      placement: 'above',
      text: 'Tap the + button any time to jump to another module, even ones you haven\'t pinned yet.',
    },
  ]

  // Step 3, per breakpoint: the Dashboard link at the top of the left rail on a computer, the FAB drawer's link on a phone.
  const dashboardStep = {
    // Step 3 (desktop): the Dashboard link right under the logo, the way back to the summary from any module.
    selector: '.desktop-nav > .desktop-nav__item',
    placement: 'below',
    text: 'Dashboard is at the top of this sidebar. It\'s the way back to your summary any time.',
  }
  const drawerStep = {
    // Step 3 (mobile): the FAB drawer's "More modules" link. The drawer is opened for this step (see the watch below),
    // so the real element exists to anchor to.
    selector: '.quick-drawer__more',
    placement: 'above',
    text: 'Open Modules to pin your favorites to this menu, in the order you want.',
  }
  const menuStep = {
    // Step 4: the topbar avatar/menu trigger -- Settings, Help, and Sign out all live behind it. Same on both breakpoints.
    selector: '.topbar__menu-trigger',
    placement: 'below',
    text: 'Your avatar opens Settings, Help, and more -- it\'s always here in the top corner.',
  }
  return isDesktop.value
    ? [...desktopSteps, dashboardStep, menuStep]
    : [...mobileSteps, drawerStep, menuStep]
})

// Drives the FAB drawer / topbar menu open state to match whichever step is
// current, so steps 3 and 4's real anchor elements exist on screen when
// their callout tries to measure them. Runs whenever the tour is active and
// the step changes (including the initial start()).
watch(
  () => (onboarding.active ? onboarding.stepIndex : null),
  (stepIndex) => {
    if (stepIndex === null) {
      // The tour just ended (X or reaching the last step via Next) -- clean
      // up whatever step 3/4 forced open rather than returning early,
      // which would leave drawerOpen true after closing on step 3, or
      // menuOpen true after closing on step 4. Same
      // closeDrawer()/menuOpen pattern used everywhere else in this file.
      if (drawerOpen.value) {
        closeDrawer()
      }
      menuOpen.value = false
      return
    }
    const needsDrawer = stepIndex === 2 && !isDesktop.value // the phone drawer's "More modules" link
    const needsMenu = stepIndex === 3 // avatar/menu trigger's own menu
    if (needsDrawer && !drawerOpen.value) {
      openDrawer(null)
    } else if (!needsDrawer && drawerOpen.value) {
      closeDrawer()
    }
    menuOpen.value = needsMenu
  },
  { immediate: true }
)

function onOnboardingNext() {
  onboarding.next()
}

function onOnboardingClose() {
  onboarding.close()
}
</script>

<template>
  <div class="app-shell">
    <!-- Landscape is blocked: portrait is forced, and nothing happens on
         screen rotation. A true CSS/JS orientation
         lock isn't available to a regular (non-fullscreen) web page, so
         this is the standard mobile-web equivalent -- a full-screen
         overlay that blocks all module content in landscape until the
         device is rotated back, rather than letting the cramped landscape
         layout render at all. -->
    <div class="rotate-lock">
      <RotateCw :size="40" />
      <p>Please rotate your device back to portrait to use Yggltree.</p>
    </div>
    <header class="topbar">
      <YggltreeLogo class="topbar__logo" />
      <div class="topbar__identity">
        <div class="topbar__brand">{{ core.familyName }}</div>
        <div class="topbar__who">{{ core.myFirstName }} <span class="topbar__role">{{ core.memberRole }}</span></div>
      </div>

      <div class="topbar__actions" ref="menuRootEl">
        <SyncStatus />
        <NotificationBell />
        <button type="button" class="topbar__menu-trigger" :class="{ 'topbar__menu-trigger--open': menuOpen }" @click="menuOpen = !menuOpen" :aria-expanded="menuOpen" aria-label="More">
          <span class="topbar__menu-trigger-avatar">
            <img v-if="assetUrl(core.avatarAssetId)" :src="assetUrl(core.avatarAssetId)" alt="" />
            <span v-else>{{ initials(core.memberName) }}</span>
          </span>
          <ChevronDown :size="14" class="topbar__menu-trigger-chevron" />
        </button>
        <div v-if="menuOpen" class="topbar__menu" @click="menuOpen = false">
          <router-link to="/dashboard" class="topbar__menu-item">
            <LayoutDashboard :size="18" />
            Dashboard
          </router-link>
          <router-link to="/modules" class="topbar__menu-item">
            <LayoutGrid :size="18" />
            Modules
          </router-link>
          <router-link to="/settings" class="topbar__menu-item">
            <SettingsIcon :size="18" />
            Settings
          </router-link>
          <router-link to="/help" class="topbar__menu-item">
            <HelpCircle :size="18" />
            Help
          </router-link>
          <button type="button" class="topbar__menu-item topbar__menu-item--danger" @click="switchProfile">
            <LogOut :size="18" />
            Switch profile
          </button>
        </div>
      </div>
    </header>

    <!-- Desktop shell only (>=1200px, see .app-shell's media query below):
         a permanent 1/4-width left rail listing every module, plus
         an accent-colored "Add modules" CTA. Below the breakpoint this
         simply doesn't render -- the mobile bottom-nav (further down)
         covers navigation instead. -->
    <DesktopNav class="desktop-rail" />

    <main class="content">
      <router-view />
    </main>

    <!-- Nav slots, split evenly around the center FAB (navSequence already interleaves
         them in render order). Empty slots show a "+" that opens the
         quick-select drawer in pin-and-go mode; the FAB opens it in
         navigate-only mode. Both skip straight to /modules when there's
         nothing to quick-select. -->
    <nav class="bottom-nav">
      <template v-for="(entry, i) in navSequence" :key="i">
        <router-link v-if="entry.type === 'module'" :to="entry.addon.route" class="nav-item">
          <component :is="iconFor(entry.addon)" :size="26" class="nav-icon" />
          <span class="nav-label">{{ entry.addon.label }}</span>
        </router-link>
        <button v-else-if="entry.type === 'fab'" type="button" class="nav-fab" aria-label="More modules" @click="openDrawer(null)">
          <Grid2x2Plus :size="28" />
        </button>
        <button v-else type="button" class="nav-item nav-item--empty" aria-label="Pin a module to this slot" @click="openDrawer(entry.slotIndex)">
          <Plus :size="26" class="nav-icon" />
          <span class="nav-label">Add</span>
        </button>
      </template>
    </nav>

    <Teleport to="body">
      <div v-if="drawerOpen" class="quick-drawer__backdrop" @click.self="closeDrawer">
        <div class="quick-drawer__panel" role="dialog" aria-modal="true" aria-label="Quick select a module">
          <div class="quick-drawer__header">
            <h3>{{ drawerPinTarget !== null ? 'Pin a module' : 'Jump to a module' }}</h3>
            <button type="button" class="quick-drawer__close" aria-label="Close" @click="closeDrawer">
              <X :size="20" />
            </button>
          </div>
          <ul class="quick-drawer__grid">
            <li v-for="addon in quickSelectModules" :key="addon.key">
              <button type="button" class="quick-drawer__item" :disabled="pinning" @click="selectModule(addon)">
                <span class="quick-drawer__item-icon">
                  <component :is="iconFor(addon)" :size="24" />
                </span>
                <span class="quick-drawer__item-label">{{ addon.label }}</span>
              </button>
            </li>
          </ul>
          <router-link to="/modules" class="quick-drawer__more" @click="closeDrawer">
            <LayoutGrid :size="18" />
            More modules
          </router-link>
        </div>
      </div>
    </Teleport>

    <!-- Onboarding tutorial. Mounted here (the shared authenticated
         shell every page renders inside) rather than in any one module page,
         so it survives navigation between steps if a step ever needed to
         (none currently do, but the mount point stays correct either way). -->
    <OnboardingCallout
      v-if="onboarding.active"
      :target-selector="ONBOARDING_STEPS[onboarding.stepIndex].selector"
      :placement="ONBOARDING_STEPS[onboarding.stepIndex].placement"
      :text="ONBOARDING_STEPS[onboarding.stepIndex].text"
      :step-index="onboarding.stepIndex"
      :total-steps="onboarding.totalSteps"
      @next="onOnboardingNext"
      @close="onOnboardingClose"
    />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* The menu trigger shows the current member's own avatar
   (photo, or initials-in-a-circle fallback, same pattern as SettingsPage's
   "my profile"/member rows) rather than a plain icon. Sized to
   roughly match that icon's ~20px visual footprint inside the existing
   44px round button. Trigger itself needs position:relative (not set by
   style.css's base rule) so the overlapping chevron below can anchor to it. */
.topbar__menu-trigger {
  position: relative;
}

.topbar__menu-trigger-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-container);
  color: var(--on-accent-container);
  font-size: 11px;
  font-weight: 700;
}

.topbar__menu-trigger-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Small caret overlapping the avatar's corner -- makes it unambiguous this
   control opens a menu, not just a profile-picture display. Reuses the
   existing --open class (already toggled from menuOpen) as its state hook
   rather than adding a new class, same as the rest of this button. */
.topbar__menu-trigger-chevron {
  position: absolute;
  right: 2px;
  bottom: 2px;
  background: var(--accent);
  color: var(--accent-contrast);
  border-radius: 50%;
  padding: 1px;
  box-sizing: content-box;
  transition: transform 120ms ease;
}

.topbar__menu-trigger--open .topbar__menu-trigger-chevron {
  transform: rotate(180deg);
}

.nav-fab {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-top: -26px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, var(--accent-soft), var(--accent));
  color: var(--accent-contrast);
  box-shadow: var(--elevation-3);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.nav-fab:hover,
.nav-fab:focus-visible {
  transform: scale(1.05);
  box-shadow: var(--elevation-2);
}

.nav-item--empty {
  background: none;
  border: none;
  font: inherit;
  color: var(--text-muted);
  opacity: 0.7;
}

.nav-item--empty .nav-icon {
  color: var(--text-muted);
}

.quick-drawer__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 100;
  /* Same touch-containment as AppModal -- the backdrop must
     not be draggable/pannable, only the panel's own content scrolls. */
  touch-action: none;
  overscroll-behavior: contain;
}

.quick-drawer__panel {
  background: var(--surface);
  border-radius: 20px 20px 0 0;
  box-shadow: var(--elevation-3);
  width: 100%;
  max-width: 480px;
  max-height: 75vh;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  padding-bottom: max(20px, env(safe-area-inset-bottom));
  touch-action: pan-y;
  overscroll-behavior: contain;
}

.quick-drawer__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.quick-drawer__header h3 {
  margin: 0;
}

.quick-drawer__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -12px -12px -12px 0;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  transition: background-color 120ms ease;
}

.quick-drawer__close:hover {
  background: color-mix(in srgb, var(--text) 8%, transparent);
}

/* Modules in the FAB quick picker use a wrapping icon-tile grid, matching
   how a phone's home screen/app drawer presents app icons. */
.quick-drawer__grid {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.quick-drawer__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 76px;
  padding: 10px 4px;
  background: none;
  border: none;
  border-radius: 16px;
  color: var(--text);
  font: var(--type-body);
  text-align: center;
  cursor: pointer;
  transition: background-color 120ms ease;
}

.quick-drawer__item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--accent-container);
  color: var(--on-accent-container);
}

.quick-drawer__item-label {
  font-size: 12px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.quick-drawer__item:hover:not(:disabled) {
  background: var(--surface-variant);
}

.quick-drawer__item:disabled {
  opacity: 0.5;
  cursor: default;
}

.quick-drawer__more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  border-radius: 12px;
  background: var(--accent-container);
  color: var(--on-accent-container);
  font: var(--type-label);
  font-weight: 700;
  text-decoration: none;
}

/* Desktop shell (>=1200px -- see style.css's shared comment on this
   breakpoint choice). Placed in this component's own scoped style, not
   style.css: .app-shell's base rule just above is scoped here too (Vue
   compiles it to an [data-v-xxx] attribute selector), so an unscoped
   override in the global sheet would lose that specificity fight
   regardless of source order. Being in the same scope sidesteps it. */
@media (min-width: 1200px) {
  /* The rotate-lock is orientation-only (no width check) because the app
     was portrait-only until this breakpoint existed -- a maximized desktop
     window is "landscape" by that rule and would otherwise be blocked
     entirely. Explicitly disabled here rather than relying on incidental
     non-overlap between the two media queries. !important because
     style.css's landscape rule targets .rotate-lock directly (not via
     .app-shell), so it's an unscoped same-specificity sibling this scoped
     block can't out-specificity any other way. */
  .rotate-lock {
    display: none !important;
  }

  .app-shell {
    height: 100vh;
    display: grid;
    grid-template-columns: 1fr 3fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      'topbar topbar'
      'nav    content';
  }

  /* style.css's landscape rule (.app-shell > .topbar/.content/.bottom-nav
     { display: none }) is unscoped but targets a two-class compound
     selector -- higher specificity than a plain .topbar/.content override
     would have. Being scoped here (an implicit specificity bump on every
     selector in this block) is what lets these three plain-class rules
     still win despite that. */
  .topbar {
    display: flex;
    grid-area: topbar;
    position: static;
    /* Slim bar: the mobile topbar's two-line identity block (brand + who)
       is fine at 64px tall on a phone; on desktop it sits over a much wider
       bar and reads better trimmed down. */
    padding: 8px 20px;
  }

  .content {
    display: block;
    grid-area: content;
    position: static;
    max-width: none;
    margin: 0;
    padding: 24px 32px;
    -webkit-mask-image: none;
    mask-image: none;
  }

  .bottom-nav {
    display: none;
  }

  .desktop-rail {
    grid-area: nav;
    border-right: 1px solid var(--border);
    background: var(--surface);
    overflow-y: auto;
  }
}
/* The logo is the same on every screen size: white on the orange top bar, the same width everywhere. */
.topbar__logo {
  flex: none;
  width: 64px;
  color: var(--accent-contrast);
}
</style>
