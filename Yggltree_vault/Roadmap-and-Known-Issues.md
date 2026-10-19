---
title: Roadmap and known limits
tags: [roadmap, known-issues]
updated: 2026-10-18
---

# Roadmap and known limits

## Next

- **Remove one phone from the family.** Needs a family key change: a new key that
  every other phone re-joins with. Not built. Until then a lost phone keeps the key.
- **Restore with phones on the relay.** A restore on the family computer hasn't been
  tested with phones that sync through the relay. Check it before relying on it.
- **Relay setup from a fresh account.** The Deploy to Cloudflare button (in
  `relay/README.md`) hasn't been tested end to end from a fresh Cloudflare account.
- **Phone-only families.** Starting a family from a phone with no family computer
  isn't built.

## Later

- **A Windows app**, built from the same Electron code as the Mac app, so the
  family computer runs without a terminal window and starts with the computer.
- **A signed Mac app**: a Developer ID signature and notarization, which removes
  the one-time Open Anyway step.
- **Phone apps** (Capacitor), for a full offline app on iPhone and Android.
- **Photos on the relay.** Photos are stored per object in the relay's Durable
  Object storage, which has a size limit per object. Move them to R2 (free allowance)
  or shard them.
- **Relay history compaction.** The relay keeps every encrypted update; compact it
  once a room grows large.

## Known limits today

**Relay**
- Phones sync through the relay on the family's own Cloudflare account. The free
  plan's limits are in `relay/README.md`.
- Turning off the relay on one phone only affects that phone. Nothing can remove a
  phone from the family remotely yet.
- Updating the relay from the Mac needs a Cloudflare sign-in on that Mac: a
  Wrangler login, or **Connect Cloudflare** on the relay card.
- A bare relay address starts a new family key, which phones on the old key can't
  follow. The app asks first. To join an existing family, use the family link.
- Yggltree needs a browser from the last few years. A browser that refuses the
  connection shows its error code on the connecting screen instead of waiting
  silently.

**Home-screen icons (iPhone)**
- A home-screen icon keeps its own copy of the app, separate from Safari, so
  iPhone needs a second scan inside the icon. Copying the family link through
  the clipboard isn't used: iPhone's clipboard can come up empty.
- Joining the icon with no second scan is untested. It would need iOS to open the
  icon with the family link already in place.

**Backups and restores**
- A restore upload is capped at 512 MB.
- The automatic daily backup can't hold more than about 380 MB of photos.
- A restore leaves the old room's data in the data folder as a safety copy.
  Delete it by hand if you need the space.

**Other**
- A chore has to be assigned to someone before it can be completed, and there's no
  way to assign an existing chore yet. Delete it and add it again.
- Two admins who each set a balance while offline can end up with a balance neither
  intended. The changes are merged as adjustments, not replaced.
- Two family computers started at the same instant on one data folder can, very
  rarely, both believe they run. Restarting one fixes it.
