# Changelog

What changed in each version of Yggltree. Each release page on GitHub shows its section from this file as its notes.

## Unreleased

### Added

- **Join with a family link.** On a Mac that's reinstalled or moved over from the source version, paste the family link from **Add a device** into **Settings → Sync**. The Mac joins the same family room, so the phones stay connected.
- **Wishlist artwork.** The wishlist drawing is in the empty state, in every color theme, and on the product page.

### Fixed

- The Mac app uses the Cloudflare sign-in already on the computer, so updating the relay works. A relay card with no Cloudflare sign-in now shows **Connect Cloudflare**.

### Changed

- The relay setup field takes a family link or a relay address. A bare address asks for confirmation first, because it starts a new family key.
- Names in the setup form and the tests are generic examples.
- The README, the setup guide, and the product page describe the Mac app's install and the source setup for developers.

## 1.0.0 (2026-10-17)

### Added

- **The Mac app.** A window and a menu bar icon, with the family's hub built in. The app isn't signed yet, so the first time you open it, choose **Open Anyway** in System Settings → Privacy & Security.
- **Birthdays.** Enter a name and a birthday. Year born and age are optional, and an age works out the year. Everyone in the family gets a reminder on the day. If nobody had the app open that day, members get it when they next open it, for up to six days.
- **Birthdays linked to family members.** Link a birthday to a family member and that person doesn't get a reminder about their own birthday.
- **1:1 time with a yes or no.** Asking for a 1:1 notifies the other person. They open an answer screen, accept on a date, or say they can't make it. The person who asked is told either way, and an accepted 1:1 goes on the calendar.
- **Calendar events with a location and notes.** Both are optional, and the location shows in the day's list.
- **Pins for your phone's bottom menu.** Pin up to four modules, in the order you want. Your pins follow you to every device.
- **Notifications open what they're about.** Tapping one opens the page and the item, which flashes briefly. On a phone, a tap on a family update opens the newest change from another family member.

### Changed

- Every module is open to every family. The switch to turn modules on and off is gone.
- Wrangler, the tool that deploys a family's relay, no longer sends usage reports to Cloudflare.
