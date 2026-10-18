# Family relay

The family relay is a small free service on your own Cloudflare account. Phones use it to
sync the family's data when they can't reach each other directly, on any network. It also
serves your Yggltree app.

What the relay can see: the encrypted data, and when devices connect. It can't read the data.
Each family's data is encrypted on the phones with a key that never leaves the phones.

## Set up (one time, for a family)

The easiest way is from the Yggltree app on the family computer:

1. Create a free Cloudflare account at cloudflare.com and confirm your email address.
2. In Yggltree, open **Settings → Sync**, type a name for the relay, such as
   `family-relay`, and click **Set up my relay**. The name becomes the start of the
   relay's address, for example `family-relay.your-account.workers.dev`. The first time,
   your browser opens a Cloudflare page: sign in, click **Allow**, and come back to
   Yggltree. Yggltree then sets up the relay on your account. This takes a few minutes.
3. Each phone joins with the family QR code shown on that same screen. See
   GETTING_STARTED.md, section 6.

If the browser login doesn't work for you, open **Use a Cloudflare API token instead** on
the same screen and paste a Cloudflare API token.

To replace or erase a relay later, open **Manage the relay** on the same screen. Replacing deletes the old
relay and everything it stored. Erasing deletes the relay's stored data. Each phone
keeps its own copy of the family's data either way.

**Other ways to set up the relay**

- **The Deploy to Cloudflare button**, below. It creates the relay on your account.
  Cloudflare then shows the relay's address. In **Settings → Sync**, open **Join a family that
  already syncs, or use a relay address**, paste the address, and click **Connect this computer**.
  Confirm when Yggltree asks: a new address starts a new family key, so do this before any phone
  uses the relay.
- **The command line**, for someone comfortable with a terminal. After `npx wrangler login`:

      cd relay
      npm run build:app
      npx wrangler deploy --name family-relay

A relay's name can't be changed once it's deployed. To rename it, create a new relay
and then replace the old one from Settings.

Keep the family link, not just the address: it carries the family's key. Copy it from
**Settings → Sync → Add a device** on the family computer. You'll need it again if the
browser's data on the family computer is cleared, or after a restore (GETTING_STARTED.md, section 10).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cored3sign/yggltree/tree/main/relay)

The family link carries the family's key. Keep it private, like a house key. Anyone who has the
link can join your family.

## Limits on the free plan

- 100,000 requests a day, which a family won't come close to.
- 5 GB of storage for the whole account. Photos use most of it, so the relay keeps them in a
  separate place with a large free allowance.
- When a limit is reached, sync waits until the next day. Nothing is charged.

## For developers

    npm install                      # from the repository root, then here
    npm run build:app                # builds the app into public/
    npx wrangler dev --local         # runs the relay on your computer (needs .dev.vars)
    RELAY_EXTERNAL=1 node test/run.mjs

`.dev.vars` holds `TEST_DUMP_TOKEN` for the test suite. It is never committed, and a real
deployment doesn't have it, so the test route is off there.
