# Getting Started with Yggltree

This guide walks you through installing Yggltree on your family's Mac, setting up
the family relay, and adding everyone's phones. You don't need to know how to
program, and you don't need to type anything into Terminal.

**How it works:** Yggltree runs on one Mac in your home, which we call
the **family computer**. Phones and tablets sync through the **family relay**,
a small free service on your own Cloudflare account. The relay only ever holds
your family's data in encrypted form, so phones sync from anywhere: at home, on
mobile data, or away. There are no family accounts, no subscription, and no
company server that can read your data.

> **Reading this on a phone?** Do sections 1 to 5 on your family computer
> first. Then come back to the phone for [section 6](#6-add-a-device).

---

## Contents

1. [What you need](#1-what-you-need)
2. [Install on a Mac](#2-install-on-a-mac)
3. [Windows (coming next)](#3-windows-coming-next)
4. [First-run setup](#4-first-run-setup)
5. [Set up the family relay](#5-set-up-the-family-relay)
6. [Add a device](#6-add-a-device)
7. [Keeping it running](#7-keeping-it-running)
8. [Backups](#8-backups)
9. [If a phone is lost or stolen](#9-if-a-phone-is-lost-or-stolen)
10. [Restoring a backup](#10-restoring-a-backup)
11. [Updating Yggltree](#11-updating-yggltree)
12. [Troubleshooting](#12-troubleshooting)
13. [Security notes](#13-security-notes)
14. [Using the modules](#14-using-the-modules)
15. [Moving from running Yggltree from source](#15-moving-from-running-yggltree-from-source)

---

## 1. What you need

- **A Mac that stays at home.** This is your family computer. Yggltree runs on
  it, and it uploads its changes to the relay while it's running. Any Mac from
  the last several years works. The download page lists the two kinds.
- **Internet access.** Phones reach the family relay over Wi-Fi or mobile data.
- **A free Cloudflare account**, for the family relay (section 5).
- Phones and tablets need a current web browser: Safari on iPhone and iPad,
  Chrome on Android. There's no app store download.

You don't need to install anything else. Yggltree includes everything it runs on.

---

## 2. Install on a Mac

**Step 1: Download Yggltree.**

1. Find out which kind of Mac you have: choose **About This Mac** from the Apple
   menu. **Chip: Apple M…** means Apple silicon. **Processor: Intel** means Intel.
2. Download the matching file:
   - **Apple silicon:** [Yggltree-arm64.dmg](https://github.com/cored3sign/yggltree/releases/latest/download/Yggltree-arm64.dmg)
   - **Intel:** [Yggltree-x64.dmg](https://github.com/cored3sign/yggltree/releases/latest/download/Yggltree-x64.dmg)

**Step 2: Install Yggltree.**

1. Open the downloaded file. A window opens with the Yggltree icon and an
   Applications folder.
2. Drag the **Yggltree** icon onto the **Applications** folder.
3. Open **Applications** and double-click **Yggltree**.
4. **The first time,** macOS may say it can't check the app. Open **System
   Settings → Privacy & Security**, scroll down, and click **Open Anyway**
   next to the message about Yggltree. Then open Yggltree again and choose
   **Open**.
   - On macOS 14 (Sonoma) and earlier, instead hold **Control**, click
     Yggltree, and choose **Open**.

Yggltree opens its own window and leaves a leaf icon in the menu bar at the top
of the screen. Closing the window doesn't stop Yggltree, so phones keep syncing.

**Check the download:** the release page lists a checksum for each file in
`SHA256SUMS.txt`. In Terminal, `shasum -a 256 ~/Downloads/Yggltree-arm64.dmg`
(or `x64`) should print the same value.

---

## 3. Windows (coming next)

The Windows app isn't ready yet. It will use the same desktop app as the Mac
version. Until then, Yggltree runs on a Mac.

---

## 4. First-run setup

Setup happens **only on the family computer**. Phones and tablets join later
(section 6).

The first time you open Yggltree, its window shows **Set up your family**. If
you need that page again later, open Yggltree from the leaf in the menu bar.

You have two choices:

- **Start fresh:** enter your **Family name** and **Your name**, then click
  **Create family**. You become the family's first admin.
- **Restore a backup:** if you already have a Yggltree backup file (a file
  ending in `.fhub.json` or `.yggltree.json`), click **Restore from a backup file
  instead**. Choose the file, type `REPLACE` in the box, and click **Restore**.

**Set your admin PIN next.** Admins use a six-digit PIN to open the admin
profile and to confirm changes to the family. Choose one you'll remember. If
you forget it, see [section 12](#12-troubleshooting).

**Add your family members next.** Open the menu behind your picture in the
top corner, choose **Settings**, and add each person under **Family
members**. Each phone then picks who's using it from this list. There are
no passwords or email invites.

---

## 5. Set up the family relay

The relay is a small free service on your own Cloudflare account. It keeps your
family's data in encrypted form, so every phone can sync with the others.
Set it up once, from Settings.

**Step 1: Create a free Cloudflare account** at [cloudflare.com](https://cloudflare.com),
and confirm your email address.

**Step 2: Set up the relay.** On the family computer, open **Settings → Sync**.
Type a name for the relay, such as `family-relay`, and click **Set up my relay**.
The name becomes the start of the relay's address, for example
`family-relay.your-account.workers.dev`.

The first time, your browser opens a Cloudflare page. Sign in, click **Allow**, and come
back to Yggltree. Yggltree then sets up the relay on your Cloudflare account. This takes
a few minutes. When it's done, the relay's address and the QR code for phones appear on
the same screen. Keep the address.

You can also set the relay up with the **Deploy to Cloudflare** button in the
[relay setup guide](relay/README.md). Then, on the same screen, open **Join a family that
already syncs, or use a relay address**, paste the address, and click **Connect this computer**.
Yggltree asks you to confirm, because a new address starts a new family key. Confirm only
before any phone uses the relay.

**If the browser login doesn't work for you**, open **Use a Cloudflare API token instead**
on the same screen and paste a Cloudflare API token. Make the token on Cloudflare's **API
Tokens** page (in **My Profile**), with the **Edit Cloudflare Workers** template.

### Replacing or erasing the relay

Everything here is on the same screen, under **Manage the relay**:

- **Replace the relay with a new one:** type a name, and click the button. Yggltree
  deletes the old relay, along with everything it stored, and creates the new one.
  Then each phone scans the new QR code.
- **Erase the relay:** deletes the relay and everything it stored on Cloudflare.
  Each phone keeps its own copy of the family's data.
- **Forget this token:** removes the Cloudflare token from this computer. The relay
  stays on your Cloudflare account.

The free plan's limits are in the [relay setup guide](relay/README.md#limits-on-the-free-plan).

---

## 6. Add a device

Each phone joins once. The family computer shows what it needs.

**On the family computer:** open **Settings → Sync** and expand **Add a device**. The QR code and
the family link are shown there. Only admins can see them.

**On the phone:**

1. Scan the QR code on the family computer with the phone's Camera app. It
   opens the family relay address in Safari (iPhone) or Chrome (Android).
2. **iPhone:** the page says **Step 1 of 2**. Tap **Share**, choose **Add to
   Home Screen**, and tap **Add**. **Android:** tap the **⋮** menu, then **Add to
   Home screen**.
3. Open **Yggltree** from its new icon, tap **Scan the family QR code**, allow
   the camera, and scan the code on the family computer again.
   - **iPhone:** this second scan is needed once. iPhone keeps the icon's data
     apart from Safari, and notifications only work from the icon.
   - To use Yggltree in Safari only, tap **Use in Safari instead** on the
     Step 1 page.

**Check that it joined:** on the family computer, open **Settings → Family**.
The phone is listed there once it has the family's data, with its browser and
when it was last seen.

**Notifications (optional):** In the Home Screen app, open **Settings →
Notifications on this phone**, then tap **Turn on notifications**. On iPhone,
this only works from the Home Screen app. The notification says only that
something changed. Tapping it opens the app at what changed, once the phone has
caught up with the family.

**Changes made with no connection** stay on the phone and sync the next time
it can reach the relay.

---

## 7. Keeping it running

- **Keep Yggltree running.** Closing the window doesn't stop it: Yggltree stays in
  the menu bar, so phones keep syncing. To stop it, choose **Quit Yggltree** from
  the leaf in the menu bar. Opening Yggltree again brings up its window, instead of
  starting a second copy.
- **Start it when you log in.** This is on by default. To change it, choose
  **Start Yggltree when I log in** in the menu bar.
- **Keep the Mac awake.** Also on by default: **Keep this Mac awake while Yggltree
  runs**. The family computer's own changes only reach the relay while it's awake.
  If you turn that off, check **System Settings → Energy** (or **Battery → Options**
  on a laptop) so the Mac doesn't sleep.

---

## 8. Backups

Yggltree keeps your data in three kinds of places: on every device, in the
family computer's **data folder**, and in any backup files you make. Make
backups anyway.

- **Download a backup from the app:** an admin opens **Settings → Data
  export & import → Download full backup**. This saves one `.yggltree.json` file
  with everything, photos included. Keep a copy somewhere safe, such as a USB
  stick or cloud drive.
- **Automatic daily backups:** while Yggltree runs, it saves a backup once
  a day if anything changed. It keeps the newest 14. They are in the
  `backups` folder inside the data folder, named like
  `yggltree-2026-10-08.yggltree.json`.
- **Copy the whole data folder:** stop Yggltree first, then copy the folder
  somewhere safe. The **Data folder** line in your Yggltree window shows where
  it is. By default it's:
  - **Mac:** `~/Library/Application Support/Yggltree`. In Finder, choose
    **Go → Go to Folder…** and paste that path.
  - **Windows:** `%APPDATA%\Yggltree`. Paste that into File Explorer's
    address bar.

The data folder is kept separate from your Yggltree program folder, so
updating or re-downloading Yggltree never touches it.

---

## 9. If a phone is lost or stolen

Today you can't remove one phone from the family from the family computer. What
you can do:

If you can still reach the phone, open **Settings** on it, find **This device**, and
tap **Turn off sync on this device**. Then it stops syncing and sending
notifications. Its copy of the family's data stays on it.

A lost phone keeps the family link it already has, so it can still read the
family's data and any new data it can reach through the relay. Removing one
phone for good needs a family key change, which Yggltree doesn't have yet.

---

## 10. Restoring a backup

Restoring replaces **all** of your family's data **on the family computer**
with the backup's contents.

- **Only on the family computer.** Other devices show **Restore from the
  family computer** instead of a restore button.
- An admin goes to **Settings → Data export & import → Restore from backup…**.
  Choose the backup file, a `.yggltree.json` file (an automatic one from the `backups`
  folder works too; older `.fhub.json` files still restore), type `REPLACE`, and click
  **Replace all data**.
- Close any other Yggltree tabs on the family computer first. If another tab
  or browser on the family computer was open, it shows **Not syncing** with
  "Your Yggltree was restored or reset. Reload this page." Reload it.
- **Phones that already joined keep their own copy.** A restore on the family
  computer hasn't been tested with phones on the relay yet, so check the phones
  after a restore.
- If you're setting up a new family computer, restore from the first-run setup
  page instead ([section 4](#4-first-run-setup)).

### After a restore

1. On the family computer, open **Settings → Sync**. If the relay shows as running, go on to
   step 2. If the relay is missing, open **Join a family that already syncs, or use a relay
   address**, paste the family link you copied from **Add a device** before the restore, and
   click **Connect this computer**. The phones keep the same key, so they stay connected.
2. If you only have the relay's address and not the family link, connecting it starts a new
   family key. Then every phone has to join again: each phone scans the new QR code on the same
   screen, as in [section 6](#6-add-a-device).

---

## 11. Updating Yggltree

1. **Check for a new version.** Yggltree checks once a day. When a newer version
   exists, the leaf in the menu bar shows a dot and **Version … is available**. To
   check now, choose **Check for updates** from the menu.
2. **Download it.** Choose the **Version … is available** item, and download the
   file for your Mac (section 2).
3. **Replace the app.** Quit Yggltree from the menu bar, drag the new Yggltree into
   Applications, and replace the old one. Then open Yggltree.

Your family's data lives in `~/Library/Application Support/Yggltree`, not in the
app, so it stays put. Phones keep their family and don't need to join again.

After an update, open **Settings → Sync**. If it says the relay serves an older
version, choose **Update the relay**, enter your PIN, and wait a few minutes.
Phones get the new version the next time they open Yggltree.

To turn off the daily check, choose **Check for updates every day** in the menu bar.

---

## 12. Troubleshooting

| Problem | What to do |
| --- | --- |
| The menu bar shows **Not running**, with **Port 8787 is being used by another program** | Close the other program, then choose **Start Yggltree** from the leaf in the menu bar. |
| The window says **Another program appears to be using Yggltree's data folder** | Usually left over after a crash. If Yggltree really isn't running, delete the `hub.lock` file the message names and start again. |
| The family computer shows **Yggltree isn't running** | Open Yggltree from Applications, or choose **Start Yggltree** from the leaf in the menu bar. |
| The relay field says to paste a family link or a relay address | Paste the whole family link from **Add a device**. For a relay with no phones on it yet, paste the address Cloudflare gave you, which starts with `https://`. |
| There's no QR code in **Settings → Sync** | Only admins see it. Expand **Add a device** to show it. Ask an admin to open the page on the family computer. |
| Scanning the QR code doesn't work | Make sure you allowed the camera when the phone asked. Or tap **Or paste the family link** and paste the link from the family computer. |
| The phone shows **Join your family** after you've joined | Scan the family QR code again from **Settings → Sync**. |
| The phone shows **Not syncing** | Check the phone has a connection (Wi-Fi or mobile data). Open the icon again. If it still says **Not syncing**, scan the family QR code again. |
| A device shows **Your Yggltree was restored or reset. Reload this page.** | Reload the page on the family computer ([section 10](#10-restoring-a-backup)). |
| **Settings → Sync** has no relay | This happens after the browser's data is cleared, or after a restore. Open **Join a family that already syncs, or use a relay address**, paste the family link from **Add a device**, and click **Connect this computer**. If you only have the address, the phones have to join again, because a new family key starts ([section 10](#10-restoring-a-backup)). |
| You can't find the relay address | It's the address Cloudflare gave you when you deployed the relay. In the Cloudflare dashboard, open **Workers & Pages** and choose the relay; its address is shown on its page. |
| A notification never arrives | Turn notifications on from the Home Screen app ([section 6](#6-add-a-device)). On iPhone, notifications only work from the Home Screen app. |
| An admin forgot their PIN | Choose **Reset admin PIN…** from the leaf in the menu bar, and confirm. Each admin sets a new PIN the next time they open Yggltree. |
| A phone doesn't appear under **Settings → Family** | It hasn't received the family's data yet. Scan the family QR code again ([section 6](#6-add-a-device)). |
| The leaf in the menu bar has a dot | Something needs attention: the relay serves an older version, a new version is available, or Yggltree isn't running. Open the menu to see which. |
| **Settings → Sync** says the relay serves an older version | Choose **Update the relay**, enter your PIN, and wait a few minutes. Phones get the new version the next time they open Yggltree. |
| macOS says it can't check Yggltree when you open it | Follow the **Open Anyway** step in [section 2](#2-install-on-a-mac). |

---

## 13. Security notes

- **The relay only ever sees encrypted data.** It can see when devices connect,
  but it can't read your family's data. The key to read it lives on your phones
  and computer, and in the family link.
- **The family link is a key.** Anyone with the link can join your family, so
  don't post a photo of the QR code or the link. Keep it private, like a house
  key.
- **Backups aren't encrypted.** A `.yggltree.json` backup and the data folder hold
  your family's data in readable form. Keep them private.
- **Paired devices keep a full copy** of your family's data, including photos.
- **The admin PIN keeps other members out of admin settings on a shared
  device.** Each admin has a six-digit PIN. Opening an admin profile asks for
  it, and so do changes to the family: roles, backups and exports, restores,
  and the relay. A PIN is not a password for the family's data. Anyone who can
  open the family computer's account or hold the family QR code can get past
  it. Lock the family computer when you step away from it.
- **The PIN is stored as a hash** on the admin's member record, and a backup
  file includes that hash. Keep backup files as private as the family's data.

## 14. Using the modules

Every module is open to everyone in the family. There is nothing to switch on.

**Your bottom menu.** On a phone, the four slots at the bottom are yours to choose. Open **Modules**, pin the ones you use most, and move them up or down to set their order. Pins belong to you, not to the family, so they follow you to every device. On a computer, every module is in the left-hand menu, so pins don't apply there.

**Birthdays.** Enter a name and the month and day. The year born is optional. An age works out the year, so you can enter either. If the person is in the family, choose them, and they won't get a reminder about their own birthday. Everyone else gets a reminder on the day. If nobody had Yggltree open that day, the reminder comes the next time someone opens it, for up to six days.

**1:1 time.** To ask for a 1:1, open **Speak**, choose **Ask for 1:1**, and pick a person and a proposed date. They get a notification. Tapping it opens a screen where they accept on a date or say they can't make it. You're told either way. An accepted 1:1 goes on the calendar and under **Upcoming** in Speak.

**Calendar events.** Add a location and notes to an event. The location shows in that day's list, and the notes show when you open the event.

**Notifications.** Tapping a notification opens the page it's about, with that item highlighted. On a phone, tapping a family update opens the newest change from another family member.

---

## 15. Moving from running Yggltree from source

Before the Mac app, Yggltree ran from its source folder, with `npm start` or **Start Yggltree.command**, and you opened it in a browser at `http://localhost:8787`. The Mac app uses the same data folder and the same port, so your family's data is already there. Only the relay connection needs moving over. Your phones keep their copy of the family's data, and they stay connected as long as the family key is the same.

1. **Copy the family link.** In the browser on the family computer, open **Settings → Sync**, expand **Add a device**, and copy the whole link. Keep it private.
2. **Save a backup.** Choose **Settings → Data export & import → Download full backup**, and keep the file somewhere safe.
3. **Stop the old copy.** Close the Terminal window that's running Yggltree, or press Control-C in it. Close the old browser tab too.
4. **Install the Mac app** from [section 2](#2-install-on-a-mac), and open it. Your family is already set up, so Yggltree opens your data. Open your admin profile with your PIN, as before.
5. **Reconnect the relay.** In **Settings → Sync**, open **Join a family that already syncs, or use a relay address**, paste the family link from step 1, and click **Connect this computer**.
6. **Check a phone.** Open Yggltree on a phone. It should show your family as before. If it says **Not syncing**, follow [section 12](#12-troubleshooting).
