---
title: Data Model
tags: [architecture, data-layer, crdt]
updated: 2026-10-18
---

# Data Model

What's actually inside the two Yjs docs, the rules every
`frontend/src/data/**` module follows to keep concurrent edits from
several devices safe now that they sync through the home hub, and what
each device and the hub store *outside* the docs. See [[Architecture]] for
where these docs sit in the app.

## The collections

Every record collection in the main doc, from `schema.js`'s `COLLECTIONS`
(used for the JSON export and for the backup/restore round-trip):

```
members, todos, events, shopping_items, chores, fund_transactions, budget_items,
notifications, announcements, announcement_reads, checkin_prompts, checkin_responses,
one_on_ones, goals, recipes, meal_library, wishlist_items, books, reading_progress,
loans, binder_sections, binder_posts, binder_post_images
```

Each is a top-level `Y.Map` in the main doc, keyed by record id, holding
one nested `Y.Map` per record (see "CRDT rules" below). Three more
top-level maps aren't in `COLLECTIONS` because they aren't record lists:

- **`settings`** (`Y.Map`) — flat family-wide settings: `family_name`,
  `week_start_day` (`sunday` or `monday`), `timezone`. `color_theme` is a
  legacy key kept for backup compatibility; the app no longer reads it (each
  member's theme is `theme_preference`, below). Read/written by
  `data/settings.js`'s `getSettings()` / `saveSettings()`.
- **`modules_enabled`** (`Y.Map`, key → `true`) — retired. Modules are no longer
  switched on per family, so nothing writes this map now and nothing reads it.
  Families set up before the change keep the old entries, unused. It was a map
  of independent keys rather than one array, so two devices switching
  *different* modules on at once would both survive.
- **`meta`** (`Y.Map`) — `schema_version` and `created_at`. `isSetUp(doc)`
  is just `doc.getMap('meta').get('schema_version') != null`.

The **asset doc** is separate from all of the above — see
[[Architecture#The two docs]] — and holds one `blobs` map of
`{ mime, data, created_at }` keyed by asset id.

## Key fields per collection

Records keep the snake_case column names used since the first release (see
"Field names" below). The non-obvious or CRDT-relevant ones:

- **`members`** — `name`, `role` (`admin`/`member`), `avatar_color`,
  `avatar_asset_id`, `nav_pinned` (array, max 4, whole-value LWW),
  `theme_preference` (one of the eight themes, or `null` for the default,
  coral; each member's own choice), `todo_default_view`, `has_seen_onboarding`.
- **`todos`** — `title`, `status` (`todo`/`doing`/`done`),
  `assigned_member_id`, `assigned_by_member_id`, `deadline`,
  `completed_at`, `description`.
- **`events`** — `title`, `event_date`, `end_date`, `event_time`,
  `all_day`, `category`, `assigned_member_id`.
- **`shopping_items`** — `title`, `category`, `store`, `completed`,
  `list_type`, `sort_order`, `recipe_id` (nullable; a deleted recipe's
  items fall back to a "Deleted recipe" label rather than throwing).
- **`chores`** — `title`, `reward_amount`, `assigned_member_id`,
  `assigned_by_member_id`, `status` (`open`/`done`), `sort_order`. See
  "Funds as a transaction log" below for how completing a chore pays out.
- **`fund_transactions`** — `member_id`, `amount` (signed, cents-rounded),
  `reason`, `chore_id`, `created_by_member_id`. Append-only; see below.
- **`budget_items`** — `name`, `monthly_amount`, `sort_order`.
- **`recipes`** — `title`, `instructions`, `servings`, `prep_minutes`,
  `ingredients` (array of `{ id, name, quantity, unit, sort_order }`,
  whole-value LWW — the editor always replaces the full list),
  `photo_asset_id`, `created_by_member_id`.
- **`meal_library`** — `title`, `notes`, `recipe_id` (nullable),
  `created_by_member_id`.
- **`goals`** — `title`, `color` (hex), `assigned_member_id`,
  `assigned_by_member_id`, `progress_note`, `status` (`active`/`complete`),
  `sort_order`.
- **`wishlist_items`** — `title`, `priority`, `assigned_member_id`
  (required — every wishlist item belongs to someone), `purchased`,
  `sort_order`.
- **`announcements`** — `body`, `pinned`, `expires_at`, `author_member_id`.
- **`announcement_reads`** — `announcement_id`, `member_id`, `read_at`.
  Deterministic id (see below); deleting an announcement sweeps its reads.
- **`checkin_prompts`** — `prompt_text`, `prompt_type`
  (`scale`/`text`/`emoji`), `active`.
- **`checkin_responses`** — `prompt_id`, `member_id`, `value`,
  `visibility`.
- **`one_on_ones`** — `member_a_id` (the member who asked), `member_b_id` (the
  member asked), `status` (`requested`, then `scheduled` once accepted or
  `declined`; rows from before statuses count as `scheduled`), `scheduled_date`,
  `responded_at`, and `happened_at` (null until logged). An accepted 1:1 also
  has a calendar event with the fixed id `one-on-one-<id>`, so two devices
  answering write one entry.
- **`books`** — bibliographic fields plus `added_by_member_id`.
- **`reading_progress`** — `book_id`, `member_id`, `status`
  (`want_to_read`/`reading`/`finished`), `progress_pct`, `rating`,
  `review`, `started_at`, `finished_at`. Deterministic id (below).
- **`loans`** — book lending fields, `returned_at` (null until returned),
  `created_by_member_id`.
- **`binder_sections`** — `title`, `is_wellbeing`, `sort_order`.
- **`binder_posts`** — `section_id`, `title`, `body`, `vault_path`,
  `sort_order`, `created_by_member_id`.
- **`binder_post_images`** — `post_id`, `image_asset_id`, `sort_order`.

## The CRDT rules

These apply to every file under `src/data/`, enforced by `collection.js`'s
helpers (`table`, `all`, `get`, `insert`, `patch`, `remove`,
`removeWhere`) so individual modules rarely touch `Y.Map` directly:

- **Nested `Y.Map`s, never a plain object.** Each record is its own
  `Y.Map` (one key per field) inside its collection's top-level `Y.Map`.
  This is what lets two devices edit *different fields* of the same record
  and have both survive a merge — a whole-object write would let one
  device's write silently clobber the other's. `collection.test.js` pins
  this directly: device A renames an item's `title` while device B sets
  its `store`; after `syncDocs()`, both edits are present on both sides.
- **Validate before the first write.** Yjs has no rollback or transaction
  abort — once you've called `.set()`, that change is part of the doc's
  history. Every write function (e.g. `setUpFamily`, `saveTodo`,
  `setBalance`) validates all of its input and throws a user-facing
  `Error` *before* making any mutation, so a rejected call leaves no
  partial state behind.
- **`doc.transact()` around multi-record writes.** Anything that touches
  more than one record (e.g. completing a chore, which patches the chore
  and may insert a fund transaction and a notification) runs inside one
  `doc.transact()` call, so it's applied — and observed by `useLive()` — as
  one atomic update rather than several.
- **LWW for whole-value fields; map keys for independent adds.** A field
  the UI always replaces wholesale (`recipe.ingredients`, `member.nav_pinned`)
  is stored as one plain JSON value — last-writer-wins is fine because
  there's one "owner" of the whole value at a time. A field that different
  devices might add to *independently* (which modules are pinned, which
  announcements a member has read) gets its own map key instead, so two
  concurrent adds both survive rather than one overwriting the other.
- **Deterministic ids for side effects that must not double-apply.**
  When two devices might cause the same side effect before they've synced,
  the resulting record uses a predictable id instead of a random one, so
  both writes land on the same key and merge into one record rather than
  duplicating:
  - the chore reward transaction: `` `chore:${choreId}` `` (`chores.js`)
  - reading progress: `` `${bookId}:${memberId}` `` (`library.js`)
  - an announcement read receipt: `` `${announcementId}:${memberId}` ``
    (`communication.js`)
  - the seeded check-in prompts: `checkin-default-1`, `-2`, `-3`
    (`schema.js`) — seeding the same family twice merges instead of
    duplicating the defaults.
- **JSON copy in and out.** `collection.js`'s `get`/`all` deep-copy a
  record's `Y.Map` into a plain object via `toJSON()` + a JSON round-trip
  before handing it to a caller, and `insert`/`patch` do the same on the
  way in. This means Vue form state (and Vue's reactive proxies) can be
  freely mutated without silently touching Yjs internals, and nothing a
  caller does to a returned object can corrupt the doc.

## Funds as a transaction log

There is **no `funds_balance` field anywhere**. A mutable balance column
would let chore payouts increment it and the Funds page overwrite it outright — two devices doing either concurrently would
lose a write. Instead, `fund_transactions` is an **append-only log**, and
a member's balance is just the sum of their transactions
(`funds.js`'s `balances()` / `balanceOf()`). Appends always merge safely
under CRDT sync, so there's nothing to lose:

- Completing a chore with a reward appends one transaction with the
  deterministic id `` `chore:${choreId}` `` (see above).
- The Funds page's "set balance to X" (`setBalance()`) doesn't overwrite
  anything — it computes the delta from the current computed balance and
  appends *that* as a new transaction. See
  [[Roadmap-and-Known-Issues#Known limits today]] for what happens when two
  devices both do this concurrently against different starting balances.

## Device-local state (outside the docs)

Connection details are **never** written to a Y.Doc. Writing the
hub URL into the shared doc would make one device's address change send
every other device to that address. Each device keeps these per browser
origin:

| Where | Key / name | What it holds |
| --- | --- | --- |
| IndexedDB | `family-hub` | the main doc (y-indexeddb) |
| IndexedDB | `family-hub-assets` | the asset doc (y-indexeddb) |
| `localStorage` | `fh.hub` | `{ v: 1, hubUrl, roomId, token, role: 'device' \| 'hub-machine', pairedAt }`, the room this device's IndexedDB is bound to. Only `applyPairing()` writes `roomId`. |
| `localStorage` | `fh.sync.problem` | `{ kind: 'revoked' \| 'room-gone' \| 'protocol', roomId, at }`, set on a terminal close (`4401`/`4404`/`4410`/`4400`), cleared by the next successful connection to the room |
| `localStorage` | `fh.sync.lastSyncedAt` | `'YYYY-MM-DD HH:MM:SS'` of the last main-doc sync |
| `localStorage` | `fh.memberId` | which profile this device is using (`data/session.js`) |
| `sessionStorage` | `fh.setupClaimId` | the hub-claim id for a Setup in progress, so a retry repeats the same claim; kept until the family has synced to the hub once |

`config.js` validates `fh.hub` on every read and treats anything malformed
as "not paired". Because all of this is **per origin**, `localhost:8787` and a changed port are
separate copies of the app on the same device.

## Hub files

The hub's data folder (see [[Architecture#The hub]] for where it is):

```
hub.json     { v: 1,
               room: { id, token, createdAt, claim: null | { id, at } },
               retired: [{ id, retiredAt, reason: 'restore' }],
               }
hub.lock     { pid, startedAt }   one hub per data folder
rooms/<roomId>/main.snapshot  main.log  assets.snapshot  assets.log
backups/yggltree-YYYY-MM-DD.yggltree.json   newest 14 kept (older .fhub.json files are still read)
backups/last-backup.json                  fingerprint of the last backup
```

- `hub.json` is the only place the hub stores the room token. It's written
  to a tmp file, fsync'd and renamed.
- The folder, `rooms/` and `backups/` are `0700`; `hub.json`, `hub.lock`
  and the backup files are `0600`.
- Each `<doc>.log` is a sequence of `[uint32 LE length][Yjs update]`
  records appended since the last compaction; `<doc>.snapshot` is the
  full state as of that compaction.
- Retired rooms (replaced by a restore) stay under `rooms/` as safety
  copies; nothing deletes them automatically.
- Backup files are the same `family-hub-backup` format as Settings →
  Data export & import → Download full backup, so any of them can be
  restored.

## Field names

Records use snake_case column names (`title`, `completed`, `recipe_id`,
`assigned_member_id`, and so on), and backups keep them, so every
release reads the same names. For example, a shopping item is
`{ id, title, completed, category, store, sort_order, recipe_id, list_type,
created_at, updated_at }`. The structural rules (nested maps, one `Y.Doc`,
UUID ids) hold throughout.

## Related notes

- [[Architecture]] — where these docs sit in the app and boot order
- [[Development]] — how to add a new module following this pattern
