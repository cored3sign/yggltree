<script setup>
import { navigableAddons } from '../addons/registry'
import {
  LayoutGrid, LayoutDashboard,
  CheckCircle2, Calendar, ShoppingCart, Coins, ChefHat,
  Megaphone, Target, Gift, Library, BookOpen, Cake,
} from 'lucide-vue-next'

// Desktop-only left rail (>=1200px, see DashboardLayout.vue's desktop-shell breakpoint). There's no slot scarcity
// in a tall left column, so every module gets a permanent link here. Pins only shape the phone's bottom menu.
const ICONS = {
  CheckCircle2, Calendar, ShoppingCart, Coins, ChefHat,
  Megaphone, Target, Gift, Library, BookOpen, Cake,
}

function iconFor(addon) {
  return ICONS[addon?.lucideIcon] || LayoutGrid
}
</script>

<template>
  <nav class="desktop-nav" aria-label="Modules">
    <router-link to="/dashboard" class="desktop-nav__item">
      <LayoutDashboard :size="20" class="desktop-nav__icon" />
      <span>Dashboard</span>
    </router-link>

    <div class="desktop-nav__divider" role="separator" />

    <router-link
      v-for="addon in navigableAddons"
      :key="addon.key"
      :to="addon.route"
      class="desktop-nav__item"
    >
      <component :is="iconFor(addon)" :size="20" class="desktop-nav__icon" />
      <span>{{ addon.label }}</span>
    </router-link>

    <div class="desktop-nav__spacer" />

    <!-- CTA, not a plain nav link: primary-accent fill sets it apart from
         the module list above, same visual language AppButton's
         primary variant uses elsewhere in the app. -->
    <router-link to="/modules" class="desktop-nav__cta">
      <LayoutGrid :size="20" />
      <span>Modules</span>
    </router-link>
  </nav>
</template>

<style scoped>
/* Hidden below the desktop breakpoint by default. DashboardLayout.vue also
   declares `.desktop-rail { display: none }` / `display: flex` at the same
   1200px boundary on the *host* class it adds to this component's root --
   but that global rule loses to this scoped rule's higher specificity
   (Vue compiles scoped selectors with a [data-v-xxx] attribute match), so
   the actual toggle must live here too or the rail stays visible on mobile. */
.desktop-nav {
  display: none;
  flex-direction: column;
  height: 100%;
  padding: 16px 12px;
  gap: 2px;
  overflow-y: auto;
}

@media (min-width: 1200px) {
  .desktop-nav {
    display: flex;
  }
}

.desktop-nav__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  color: var(--text);
  text-decoration: none;
  font: var(--type-body);
  font-weight: 600;
  transition: background-color 120ms ease, color 120ms ease;
}

.desktop-nav__item:hover {
  background: var(--surface-variant);
}

.desktop-nav__item.router-link-active {
  background: var(--accent-container);
  color: var(--on-accent-container);
}

.desktop-nav__icon {
  flex: none;
}

.desktop-nav__divider {
  height: 1px;
  margin: 8px 4px;
  background: var(--border);
}

.desktop-nav__spacer {
  flex: 1;
}

.desktop-nav__cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 12px;
  padding: 12px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--accent-soft), var(--accent));
  color: var(--accent-contrast);
  text-decoration: none;
  font: var(--type-label);
  font-weight: 700;
  box-shadow: var(--elevation-1);
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.desktop-nav__cta:hover,
.desktop-nav__cta:focus-visible {
  transform: translateY(-1px);
  box-shadow: var(--elevation-2);
}
</style>
