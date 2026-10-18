// Loaded with --require before Wrangler runs inside the desktop app (see wranglerInvocation in relayManager.js).
// Wrangler reads its arguments from the wrong place unless process.defaultApp is set, so this sets it.
process.defaultApp = true
