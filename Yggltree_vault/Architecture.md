---
title: Architecture
tags: [architecture, frontend, data-layer, hub, sync]
updated: 2026-10-18
---

# Architecture

A high-level map of how Yggltree is put together: a
local-first Vue app on every device, plus a small local server on the family
computer (the **hub**) that serves the app and keeps the family's copy. Phones
sync through the **family relay** (`relay/`), a Cloudflare Worker on the
family's own account, which holds the family's data encrypted.

## Stack

- **Frontend:** Vue 3.5 (`<script setup>`), Vue Router 5, Pinia 4, built
  with Vite 8. Installable as a PWA (manifest + service worker).
- **Data:** [`yjs`](https://docs.yjs.dev/) CRDT documents, persisted to the
  browser via `y-indexeddb`, synced to the hub with `y-websocket@3`
  providers.
- **Hub (`hub/`):** one small Node.js process (Node 22.12 or newer) built
  on `ws` + `y-protocols`. It serves the built app and an authenticated
  Yjs websocket endpoint on one port (8787 by default), and keeps its own
  copy of the family on disk. No database server, no native dependencies,
  no accounts.
- **Repo layout:** npm workspaces (`frontend`, `hub`) with one root
  lockfile, so there is exactly one hoisted copy of `yjs`. `npm start` at
  the root (`scripts/start.cjs`) installs, builds and runs the hub.
- **Tests:** `vitest` in the `node` environment for both workspaces;
  `fake-indexeddb` stands in for IndexedDB in the frontend, and the hub's
  integration tests run a real in-process hub. See [[Development]].

Every read and write still happens on the device, synchronously, against
data already in memory. The network only ever *delivers* updates; the app
never waits on it to render or to save.

## The two docs

The app keeps **two separate Yjs documents**, both opened by
`src/data/family.js`'s `openFamily()` and both persisted to IndexedDB via
`IndexeddbPersistence`:

- **The main doc** (`family-hub`) — every family record: members, to-dos,
  events, shopping items, chores, funds, budgets, recipes, goals, wishlist,
  communication, library, binder, settings, notifications. See
  [[Data-Model]] for the full collection list and field shapes.
- **The asset doc** (`family-hub-assets`) — raw image bytes, keyed by id.
  Kept separate so that opening the family's data never has to load or wait
  on photo bytes; a record in the main doc holds only an asset id
  (`avatar_asset_id`, `photo_asset_id`, `image_asset_id`).

Each doc syncs to the hub over its own websocket (`main` and `assets`), so
a photo-heavy asset doc never delays the main doc's first sync.

Both docs are singletons behind `family()` (`src/data/family.js`), which
throws if read before `initFamily()` resolves. Tests swap in a disposable
pair via `setFamilyForTests()` / `openFamily({ persist: false })`.

## `src/data/` layout

Business logic lives in small, unit-tested modules under `frontend/src/data/`:

```
src/data/
  time.js          nowStamp(), stampMinutesAgo() — naive-UTC "YYYY-MM-DD HH:MM:SS"
  ids.js           newId() -- crypto.randomUUID() with a plain-http fallback
  collection.js    generic record helpers over nested Y.Maps (table/all/get/insert/patch/remove/...)
  testing.js       test-only: forkDoc(), syncDocs(), newFamilyDoc()
  family.js        openFamily/initFamily/family() -- the two docs, persisted
  vue.js           useLive(), useFamily()
  session.js       device-local "current member id" (localStorage)
  schema.js        SCHEMA_VERSION, COLLECTIONS, isSetUp(), setUpFamily()
  members.js       members, admin checks, actorFor(), nav pins
  settings.js      family settings
  notifications.js notify() + bell queries
  assets.js        image bytes in the asset doc; resizeImage(); reactive assetUrl()
  backupFormat.js  createBackup/parseBackup/hasFamily -- pure, shared with the hub
  backup.js        re-exports the format; JSON export
  markdown.js      frontmatter parsing for the Binder's Markdown import
  sync/            the sync layer (below)
  modules/
    shopping.js todos.js events.js chores.js funds.js budgets.js
    recipes.js meals.js goals.js wishlist.js communication.js
    library.js binder.js
```

One file per feature area, each small enough to review in one sitting.
Vue pages depend only on `data/vue.js` (`useLive`, `useFamily`) plus the
specific module functions they call — never on Yjs types directly. See
[[Data-Model]] for the CRDT rules every one of these files follows.

`backupFormat.js` and `sync/protocol.js` are **shared pure modules**: the
hub imports them by relative path, so they use explicit `.js` import
extensions and import nothing but `yjs`.

## The hub

`hub/src/` is one Node process, started by `npm start` (or
`node hub/src/cli.js`):

```
cli.js          flags, the startup banner, "already running" handling
server.js       one HTTP server: /api, /sync websocket upgrades, static files
api.js          the admin JSON routes (info, claim, restore)
admin.js        the localhost-only admin guard
rooms.js        Yjs sync + awareness over ws, per room and doc
persistence.js  snapshot + append-only update log per doc
hubState.js     hub.json (room, token, claim, retired rooms), hub.lock
backups.js      automatic daily backups
network.js      listen on 127.0.0.1
static.js       serves frontend/dist with SPA fallback
dataDir.js      the default data folder per platform
```

- **One room.** A hub has one active *room*: a random id (`r_` + 22
  base64url) and a 256-bit bearer token. Each room holds two docs, `main`
  and `assets`. Rooms replaced by a restore are kept on disk as *retired*
  safety copies.
- **Routes.** `GET /api/health` is open. `/api/hub/*` (info, claim, restore) is
  admin-only, and the hub listens on `127.0.0.1` only, so no other device can
  reach it. Any other
  `/api/*` is a JSON 404 and never falls through to the app. `/sync/<roomId>/<doc>`
  is the websocket endpoint. Everything else is the built app, with
  `no-cache` on `index.html`/`sw.js`/`version.json`/`manifest.json` and
  `immutable` on `/assets/*`. HTML responses carry
  `Content-Security-Policy: frame-ancestors 'none'` and
  `X-Frame-Options: DENY`, so the app can't be framed.
- **Websocket auth.** The upgrade is accepted, then the room, doc and
  token are checked **before any message is read**. Failures close with a
  shared code from `protocol.js`: `4400` bad request, `4401` bad token,
  `4404` unknown room, `4410` retired room. The client stops reconnecting
  on any of them. An upgrade that already fails the check is handled with
  a 1 KiB frame limit (accepted ones allow 512 MiB), and the socket is
  dropped if the client hasn't answered the close within a second.
- **Admin guard (`admin.js`).** A request is the desktop's own browser
  only if it comes from a loopback address, with a `Host` of `localhost`,
  `127.0.0.1` or `[::1]`, and with **no** proxy headers (`X-Forwarded-For`,
  `Forwarded`, `X-Forwarded-Host`, `X-Real-IP`, `Tailscale-User-Login`).
  All three are needed because the Vite dev proxy, and any other proxy,
  connects from `127.0.0.1`. Mutations additionally need
  `X-Family-Hub-Admin: 1`, a JSON content type (which forces a CORS
  preflight the hub never approves) and, if present, a loopback `Origin`.
  Failures are a bare 403.
- **Canonical desktop origin.** A navigation to `127.0.0.1:<port>` gets a
  308 to `localhost:<port>`, so the desktop's IndexedDB and localStorage
  never split across two origins. A request carrying any proxy header is
  never redirected (it isn't the desktop's own browser).
- **Listening.** Dual-stack `::` (falling back to `0.0.0.0`) on port 8787;
  `--local-only` binds `127.0.0.1`. `--port`, `--data`, `--dist`,
  `--public-url` and `--no-open` are the other flags.
- **Persistence.** Each doc is `<doc>.snapshot` plus `<doc>.log`
  (4-byte little-endian length + update bytes per record). A torn final
  record after a crash is truncated, not fatal; snapshots are written to a
  tmp file, fsync'd and renamed (retrying on Windows `EPERM`/`EBUSY`).
  `hub.lock` refuses a second hub on the same data folder. The data
  folder, `rooms/` and `backups/` are owner-only (`0700`); `hub.json`,
  `hub.lock` and backup files are `0600` (existing folders and `hub.json`
  are tightened at startup, best effort; no effect on Windows).
- **Data folder** (outside the repo): macOS
  `~/Library/Application Support/Yggltree`, Windows
  `%APPDATA%\Yggltree`, Linux `${XDG_DATA_HOME:-~/.local/share}/yggltree`.
  Override with `--data <dir>` or `YGGLTREE_DATA`. See [[Data-Model]]
  for the files inside.
- **Daily backups.** At startup and every 24 h, if the family changed, the
  hub writes `backups/yggltree-YYYY-MM-DD.yggltree.json` in the same format
  as an in-app backup, keeping the newest 14. Older `.fhub.json` files are
  still read, restored and pruned.

## The sync layer (`src/data/sync/`)

```
protocol.js   close codes, doc names, id/token validators (shared with the hub)
config.js     this device's hub config in localStorage (key fh.hub)
pairing.js    planPairing / applyPairing (this computer's own room)
wipe.js       deletes both IndexedDB databases, awaiting both
connection.js two y-websocket providers (main, assets) to the hub
boot.js       bootSync: the startup decisions
hubApi.js     fetch wrappers for the hub's JSON API
status.js     the five sync states and their copy
```

- **Connection config lives only in `localStorage`**: hub URL,
  room id, token and role are never written to a Y.Doc. See [[Data-Model]]
  for the keys.
- **Phones join through the relay, not the hub.** A phone scans the family QR
  code from **Settings → Sync** (or pastes the family link). The link
  carries the family key in its `#relay=1.<key>` fragment, which is never sent
  to a server. The hub issues no pairing codes. The Mac can join an existing
  family the same way, from **Settings → Sync → Join a family that already
  syncs**. A bare relay address instead starts a new family key, after a
  confirmation, since phones on the old key can't follow it.
- **Room-binding invariant.** A device's IndexedDB state belongs to
  `config.roomId`. `applyPairing()` is the only writer of `roomId`, and
  switching rooms always wipes both IndexedDB databases first
  (`confirm-replace`). The single exception is *adopt* (below).
- **Pairing plans.** `planPairing()` returns `save` (no config and no local
  family: just save), `update-token` (same room, new token: no wipe) or `confirm-replace` (anything else: the user is asked
  on `/connect`, with "Download a backup first", before the wipe).
- **Seeding invariant.** Only the hub machine ever runs `setUpFamily()`,
  and only after `POST /api/hub/claim` succeeds; two desktop browsers
  racing get exactly one claim. Every other device only pulls.
- **Adopt.** If the hub's room is empty but the desktop browser already has
  a family (from a local-only install on the same origin), confirming
  on `/connect` claims the hub and then uploads that copy, without wiping.

## Telling the hub machine from a phone

`bootSync` treats the browser as the **hub machine** whenever the page's
hostname is loopback (`localhost`, `127.0.0.1`, `[::1]`), even if the hub
isn't answering. On loopback it probes `GET /api/hub/info` (1.5 s timeout);
because that route is admin-only, the desktop gets the room id and token
straight from the hub. Any other hostname is a *device*. The hub listens on
this computer only, so the family computer is opened at
`http://localhost:8787`.

Admin-only Settings groups (Family, Sync) and Restore appear only on the hub
machine and only for admin profiles. The admin check is advisory; the hub's admin guard is
the real boundary.

## The core store and boot order

`src/main.js` must open the family doc **before** mounting the app, because
every page reads from it synchronously on first render:

0. `./pairingBoot` is the **first import**: it reads `#relay=1.<key>` and
   strips the fragment with `history.replaceState` before `router.js` (and
   `createWebHistory()`) is even evaluated, so a code never lingers in the
   address bar or history.
1. `initFamily()` opens (or creates) both IndexedDB-backed docs and waits
   for them to load from disk.
2. `useSyncStore().boot()` runs `bootSync`. The only network it awaits is the
   1.5 s loopback hub probe. It then starts the websocket providers without
   awaiting them.
3. `useCoreStore().start()` runs once, then re-derives its whole state
   (`refresh()`) on every `doc.on('afterTransaction', ...)`: local writes
   and remote sync updates alike.
4. Only then does `app.use(router).mount('#app')` run.
5. If step 1 throws (IndexedDB blocked — private window, site data
   disabled), a plain text message replaces `#app` instead of a blank page.

`stores/core.js` (Pinia) is a **read-model**, not a source of truth: its
`refresh()` pulls `isSetUp`, `getSettings`, `getMember(currentMemberId())`,
and the member's pinned modules straight from the doc on every transaction.
Actions like `createFamily`, `selectMember`, `pinModule` and
`pinModule` are thin wrappers that call into `data/schema.js`,
`data/settings.js` and `data/members.js` and let the next `refresh()` pick
up the result — there's no separate mutation path to keep in sync.

`stores/sync.js` holds the sync side: role, config, hub info, the live
status, and the hub-machine actions (claim, restore). On the hub machine it re-probes the hub
while the status is "waiting", so starting the hub later is picked up
without a reload: if nothing is connected when the hub comes back, sync
boots again. It never re-probes while a restore is under way or stuck.

A global `app.config.errorHandler` is a last-resort net: any error a component doesn't catch itself surfaces as a
plain `window.alert()` instead of failing silently.

## The router guard

`src/router.js`'s `beforeEach` calls the pure `decideRoute()` in
`src/lib/guard.js`, with `{ familyReady, memberId, canSetUp, pendingReplace,
needsAdminPin }`:

1. **A pending replace or adopt?** Everything goes to `/connect`, which
   asks the user.
2. **No family on this device yet?** `canSetUp` (hub machine, and the hub
   says no family exists) goes to `/setup`; everything else goes to
   `/connect`. A freshly paired phone has no family until sync delivers
   it, so it must land on `/connect` ("Connecting to your Yggltree…"),
   never `/setup`.
3. **Family exists:** `/setup` and `/connect` bounce to `/`.
4. **No profile chosen on this device?** (`core.memberId`, resolved
   against the current doc, so a stale id from a replaced family counts as
   none.) Everything goes to `/profiles`.
5. **Otherwise** the route opens. There is no per-module lock: every module is
   available to every family, and a member pins the ones they want to their
   bottom menu on a phone (`views/ModulesPage.vue`).

Guards only run on navigation, so `ConnectPage` and `SetupPage` each watch
`core.familyReady` / `sync.canSetUp` and `router.replace('/')` when it
flips. `/setup`, `/connect` and `/profiles` are top-level routes, not
nested under `DashboardLayout`.

## Sync status

`status.js`'s `deriveSyncStatus()` returns one of five states, shown in the
header (`SyncStatus.vue`, which links to the Help page's Sync card):

| State | Header | When |
| --- | --- | --- |
| `needs-pairing` | red, "Not syncing" | no config on a non-hub device, or the hub closed with `4401`/`4404`/`4410` (or `4400`: protocol mismatch) |
| `offline` | orange, "Offline" | `navigator.onLine === false` |
| `connected` | green, "Synced" | the **main** doc's provider reports `synced` |
| `connecting` | gray, "Connecting…" | not synced, under 4 s since boot or the last attempt |
| `waiting` | yellow, "Waiting for hub" | online, configured, not synced for 4 s or more |

A problem beats offline; offline beats everything else. "Synced" is never
just "the socket is open": the hub accepts the upgrade and only then may
close with `4401`. The asset doc isn't part of it. On the hub machine,
"waiting" says the hub isn't running, or, when the hub answers but this
browser has no live connection, that this computer's family isn't on the
hub yet; "Not syncing" there says the hub was restored or reset and asks
for a reload.

On a phone that syncs through the relay, the connecting screen names the step
it's on: opening this browser's storage, reaching the family relay, waiting for
the family's data, or synced (`data/relay/stage.js`). Opening the local outbox
gets `STORAGE_WAIT_MS` (5 s) before the connection starts anyway. When an attempt
to reach the relay ends, the screen shows the browser's close code (1006 means
the connection failed before it opened) and the number of attempts.

## Relay connection (`data/relay/`)

- **Two rooms per family.** `connection.js` opens one `provider.js` room for the
  main data, which drives the status, and one for the photos. Room ids and the
  auth token both come from the family key by HKDF (`deriveRoomId`,
  `deriveAuth`), so the key is the only secret a phone needs.
- **The handshake.** The client sends `hello {since, auth}`. The relay replies
  with the entries after `since`, then `caught-up`. Nothing is sent before
  `caught-up`. A wrong key gets `error: auth` and close 4401, and the phone
  stops retrying and shows the problem.
- **The WebSocket address.** `relaySocketUrl()` turns the relay's `https://` into
  `wss://` (and `http://` into `ws://`) for every connection. Some browsers refuse
  an `https://` address for a WebSocket.
- **Failures are reported, not swallowed.** A WebSocket the browser refuses to
  construct counts as a failed attempt, with its error name shown on the
  connecting screen.

## Secure-context notes

## The restore model

Restoring runs **on the hub, into a new room with a new token**
(`POST /api/hub/restore`, streamed, up to 512 MB): the hub validates the
file with `parseBackup`, writes the new room, swaps `hub.json`, and retires
the old room, closing its sockets with `4410`. The old room stays on disk.
The desktop browser then wipes and re-binds to the new room
(`confirm-replace`) and reloads; if that wipe is blocked (another tab),
the page offers only "Download a backup first" and Retry, and warns before
unload. Other tabs on the family computer see "Not syncing" and just
reload. Phones that sync through the relay are not covered by this swap yet:
the relay still holds their data (see GETTING_STARTED section 10).

Restoring into the *same* room would let any device that still holds the
old state merge it straight back in, undoing the restore; a new room makes
that impossible. Restore is therefore offered only on the hub machine
(Settings, or "Restore from a backup file instead" on Setup). The
in-browser `restoreBackup()` in `backup.js` is not used by the UI.

## Secure-context notes

Phones open the app at the relay's `https://…workers.dev` address, a secure
context, so:

- **The service worker registers** there, the app shell is cached, and the
  home-screen icon opens without a connection once it has run at that address.
- **`crypto.randomUUID`** is missing; `ids.js` falls back to a
  `getRandomValues`-based UUID.
- **Camera barcode scanning** (`getUserMedia`) needs a secure context: `https://`
  (the relay) or `localhost`. On a plain `http://` address, `BarcodeScanner.vue`
  checks `window.isSecureContext` and points to manual ISBN entry.
- Fine over http: IndexedDB, BroadcastChannel, `createImageBitmap`, object
  URLs.

Any new secure-context-only API must be guarded the same way, or phones
on home Wi-Fi break silently.

## The profile model and advisory roles

There are no accounts and no passwords. Each **device** picks a profile:

- `SetupPage.vue` runs once per family, **only on the hub machine** and
  only while the hub has no family. It claims the hub
  (`POST /api/hub/claim`), then calls `core.createFamily()`, which calls
  `setUpFamily(doc, ...)` to seed `meta`, `settings`, the admin member,
  and the default check-in prompts. It can instead restore a backup file
  through the hub.
- `ProfilesPage.vue` lets *this device* pick which existing member is using
  it — like a Netflix profile picker, not a login. The choice is stored
  device-locally in `localStorage` (`data/session.js`, key `fh.memberId`),
  **never** written into the shared doc — one device switching profiles
  must not affect what any other device sees.
- `members.js`'s `isAdmin()` / `requireAdmin()` checks are **advisory**:
  anyone who can write to the doc (anyone holding the room token, i.e.
  any paired device) can bypass them. They exist to keep the UI honest,
  not as a security boundary. The real boundaries are the room token and
  the hub's localhost-only admin guard; see "The hub" above.
- **Admin PINs** add a device-level gate on top. Each admin has a six-digit
  PIN, stored as an scrypt hash (`pin_salt`, `pin_hash`, `pin_set_at` on the
  member record; `setAdminPin` / `verifyAdminPin` in `members.js`). Picking an
  admin profile on `ProfilesPage.vue` asks for that admin's PIN. Sensitive
  actions (role changes, adding an admin, backups and exports, restore, relay
  setup, replace and erase, changing the PIN) confirm the current admin's PIN
  through `stores/adminLock.js`, which keeps the confirmation for five minutes
  on the device. Wrong PINs lock the device out after five tries
  (`lib/pinLockout.js`, kept in `localStorage`).
- An admin with no PIN yet is routed to `/set-pin` (`lib/guard.js`,
  `needsAdminPin` in `stores/core.js`) before anything else.
- **Reset from the family computer:** the hub writes a random token to
  `reset-token` in its data folder each time it starts (`hub/src/adminPin.js`,
  owner-only). `npm run reset-admin-pin` (`hub/src/resetAdminPin.js`) sends it
  to `POST /api/admin/reset-pin`, which clears every admin's PIN. The route
  refuses a request without the token, so a browser tab on the same computer
  can't run it.
- A family always keeps at least one admin; `updateMember()` throws rather
  than letting the last admin demote themselves.

## Notifications

In-app notifications are the lists below. The one push notification is the
family relay's generic "something changed" message to phones that turned
notifications on (see `relay/README.md`). `data/notifications.js`'s `notify()` is called by the
module that causes the event (assigning a to-do, a chore, a goal, a
wishlist item) and inserts a record addressed to the recipient's member id.
The **acting device** writes the record; the recipient sees it when sync
delivers the update to their device. `notify()` refuses to notify the
actor about their own action. `NotificationBell.vue` reads
`listNotifications()` live via `useLive()`.

**Where a notification takes you.** `lib/notificationTargets.js` maps each type to
its page and the record as `?item=<id>`; the page scrolls to and flashes that row
(`lib/highlight.js`, rows marked with `data-item-id`). The bell uses it for every
type. A 1:1 request opens its answer screen (`views/OneOnOnePage.vue`).

**A tap on a phone's push.** The push text is encrypted and generic, so the
phone works out the change itself. `data/recentChanges.js` records the records
that arrive from another device (origins: the relay's and the hub's sync). A tap
opens the newest such change that has a page (`lib/pushOpen.js`), else the newest
unread notification from the last two hours. The service worker passes the tap
on: an open app is told, and a closed one opens `/dashboard?from=push`, which waits
up to eight seconds for the first change to sync in.

## Assets

Photos are **resized on the device** before they ever touch a doc:
`assets.js`'s `resizeImage()` downscales to at most 1600px on the long
edge, re-encodes as JPEG at quality 0.82, and flattens transparency onto a
white background — all via `createImageBitmap` + `<canvas>`, no server
round-trip. `putImageFile()` does the resize and stores the result;
`assetUrl()` returns a cached `URL.createObjectURL()` for a given asset id,
or `null` if the bytes aren't present yet. Because the asset doc syncs
separately, a record can arrive before its photo: `assetUrl()` is
reactive, so the calling component re-renders when the bytes land, and
`AssetImage.vue` shows a placeholder until then (avatars fall back to
initials). See [[Data-Model]] for which fields hold asset ids.

## Backup

Two separate export paths:

- **Full backup** (`createBackup` / `parseBackup` in `backupFormat.js`,
  shared with the hub) — the complete Yjs state (`Y.encodeStateAsUpdate`)
  of *both* docs, base64-encoded into one JSON file
  (`format: "family-hub-backup"`, saved as `.yggltree.json`; older `.fhub.json`
  files still restore). Any admin can
  download one; restoring goes through the hub (see "The restore model"
  above). The hub's automatic daily backups use the same format.
- **JSON export** (`exportJson`) — a human-readable snapshot (settings plus
  every collection from `schema.js`'s `COLLECTIONS`), for reading or
  archiving outside the app. Not restorable.

## The service worker

`frontend/public/sw.js` caches the app shell so the PWA can reload
**fully offline**. It only registers in a secure context:
`localhost` on the family computer, and on phones over the HTTPS listener. The plain-HTTP listener has no service worker (see "Secure-context notes").

- **Navigations:** network-first, so a new deploy is picked up when online;
  falls back to the last cached `/index.html` when the network fails.
- **`/assets/*`:** cache-first — Vite's content-hashed bundle filenames
  never change for a given URL, so this is always safe and makes offline
  reloads instant. Only successful (`response.ok`) responses are cached.
- Everything else (notably `/version.json`, which `UpdatePrompt.vue`
  deliberately fetches with `cache: 'no-store'`) passes straight through.
- `main.js` separately **warms** the cache after the service worker
  controls the page: it walks the module registry and calls each lazy
  route's `component()` import, so a module nobody has visited yet (e.g.
  Recipes) is still available offline. See [[Roadmap-and-Known-Issues]] for
  the known race on the very first visit.

## Related notes

- [[Data-Model]] — collections, CRDT rules, and field shapes in detail
- [[Development]] — running, testing, and extending this codebase
- [[Roadmap-and-Known-Issues]] — what's not built yet, and known gaps
