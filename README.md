<p align="center"><img src="docs/img/yggltree-logo.svg" width="480" alt="Yggltree" /></p>

# Yggltree

Product page: https://cored3sign.github.io/yggltree/

Yggltree is a free, open-source family organizer you run yourself. Your family's
calendar, lists and chores live on **your family's own computer and phones**, with
no company in the middle.

## Why Yggltree

Most family apps run on someone else's cloud, in a format only they can use, and
they're paid for with a subscription or with your data. Yggltree is built the
other way round:

- **Your data, your control.** It lives on your family's computer and phones.
  Back it up, open the folder, and take it with you.
- **Nobody in the middle.** No account with us, no ads, no tracking, nothing
  sold. We run no servers, so we never see your data.
- **Room for what matters.** A calendar, a shopping list and a chore chart should
  help a family spend time together, not become another feed.
- **Software you own.** Free and open source under the MIT License. Read it,
  change it, and share it.

## Who touches your data

- **Your devices:** everything.
- **Your relay, on your own Cloudflare account:** scrambled copies only, and it
  sees when devices connect. Cloudflare hosts it but can't read the content.
- **Phone push services** (Apple, Google, Mozilla, Microsoft): an encrypted
  "something changed" ping, with no content.
- **Open Library**, only if you look up a book by its ISBN: the ISBN is sent, and
  the cover loads from it.
- **GitHub**, only for the Mac app's daily check for a newer version. You can turn
  the check off in the menu bar.
- **The Yggltree maintainers:** nothing. There are no servers and no analytics.

Phones join by **scanning a QR code**, and they sync from anywhere. There's no
family account to create and no subscription.

> **On a phone right now?** Set up Yggltree on your family's Mac first, then set up
> the family relay. The full walkthrough is in
> [`GETTING_STARTED.md`](GETTING_STARTED.md).

## What's in it

Shared calendar, to-dos, shopping lists, chores and allowance funds, meal
planning and recipes, goals, wishlists, birthdays, family messages and
check-ins, a book library, and a family binder. It all lives in one app that works
offline and syncs when it can.

## Quick start

You need a Mac that stays at home and a free [Cloudflare](https://cloudflare.com)
account for the family relay. (Windows is coming next.)

1. **Download Yggltree** for your Mac:
   - **Apple silicon** (M1 and later): [Yggltree-arm64.dmg](https://github.com/cored3sign/yggltree/releases/latest/download/Yggltree-arm64.dmg)
   - **Intel:** [Yggltree-x64.dmg](https://github.com/cored3sign/yggltree/releases/latest/download/Yggltree-x64.dmg)

   Not sure which? Choose **About This Mac** from the Apple menu. "Chip: Apple M…"
   means Apple silicon; "Processor: Intel" means Intel.
2. **Drag Yggltree into Applications**, then open it from there. The first time,
   macOS may say it can't check the app. Open **System Settings → Privacy &
   Security**, scroll down, click **Open Anyway**, then open Yggltree again.
   (On macOS 14 and earlier, right-click Yggltree and choose **Open**.)
3. **Set up your family** in the window that opens. Yggltree stays in the menu bar
   while the window is closed, so phones keep syncing.
4. **Set up the family relay:** in **Settings → Sync**, connect your Cloudflare
   account and name your relay. Yggltree creates it on your account.
5. **Add devices:** in **Settings → Sync**, expand **Add a device** and scan the
   family QR code with each phone.

Everything an admin needs afterwards is in the menu bar: restart Yggltree, update
the relay, back up, and reset an admin PIN.

Your family's data is stored in `~/Library/Application Support/Yggltree`, so
updating Yggltree never touches it.

**➡️ See [`GETTING_STARTED.md`](GETTING_STARTED.md)** for the step-by-step
guide: setting up the relay, adding devices, backups, updates, and troubleshooting.
If your family already runs Yggltree from the source version, section 15 of that guide
moves it to the Mac app without losing data.

## How it works

Each device keeps a full copy of the family's data in its browser and edits
it locally, so nothing waits on the network. Devices merge their changes using
[Yjs](https://docs.yjs.dev/) CRDTs.

- **The family relay** is a small service on your own Cloudflare account. It
  holds your family's data encrypted, so phones sync with each other from
  anywhere. The relay can't read the data. See [`relay/README.md`](relay/README.md).
- **The Mac app** runs a small local server, the family's hub, and keeps the
  family's data on that computer. The hub listens on this computer only.
- Phones join with a QR code from **Settings → Sync**. No passwords.
- Phones open the app over HTTPS from the relay, so they open without a
  connection once they've been opened. Changes made without a connection sync
  when the phone reaches the relay again.
- The family computer keeps automatic daily backups, and admins can download a
  full backup any time.

Developer and design notes live in the [`Yggltree_vault/`](Yggltree_vault/Home.md)
folder, an Obsidian vault that also reads fine on GitHub.

## Running from source (developers)

You need [Node.js](https://nodejs.org) **22.12 or newer**. From a clone of this
repository:

```sh
npm start
```

The first start installs and builds the app. Then open
[http://localhost:8787](http://localhost:8787) on that computer. On a Mac or
Windows, double-click `Start Yggltree.command` or `Start Yggltree.bat` instead.
The developer notes in [`Yggltree_vault/Development.md`](Yggltree_vault/Development.md)
cover tests, builds, and the desktop app's packaging.

## Roadmap

- **Windows app**, built from the same desktop code as the Mac app.
- **A signed Mac app**, so the first open needs no extra step.
- **A hub on a cloud account you control**, for families without an always-on
  computer.
- **Removing one lost phone** from the family, which needs a family key change.
- **Store apps for phones** (Capacitor), for a full offline app that works
  away from home.

See [`Yggltree_vault/Roadmap-and-Known-Issues.md`](Yggltree_vault/Roadmap-and-Known-Issues.md)
for details and known limits.

## License

Yggltree is free software released under the [MIT License](LICENSE).
Copyright (c) 2026 Yggltree contributors.

The software is provided "as is", without warranty of any kind. See the license for the full terms.

"Yggltree" and the Yggltree logo are the names of this project. The MIT License covers the code and documentation; it does not give rights to the names or the logo. If you fork or redistribute Yggltree, please use a different name and logo for your version.

The typeface on the product page, Inter, is licensed under the SIL Open Font License; see [docs/fonts/OFL-inter.txt](docs/fonts/OFL-inter.txt).
