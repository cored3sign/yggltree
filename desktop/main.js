// The Yggltree desktop app: one window, a leaf in the menu bar, and the family's hub running inside
// the app. Closing the window keeps Yggltree running in the menu bar, so phones keep syncing.
//
// From source:   npm install (in desktop/), then npx electron .
// Packaged:      the app's own copy of the hub, relay and frontend lives in Resources/app-hub.

import electron from 'electron'
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell, powerSaveBlocker, session } = electron
import { createWriteStream, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HubProcess, HUB_PORT } from './hubProcess.js'
import { externalLinkOf } from './links.js'
import { buildMenu, needsAttention } from './trayMenu.js'
import { DOWNLOAD_PAGE, checkForUpdate, dailyCheckDue } from './updates.js'

app.setName('Yggltree')

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = app.isPackaged ? join(process.resourcesPath, 'app-hub') : join(here, '..')
const appVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version
const dataDir = join(app.getPath('userData'))
const logDir = app.getPath('logs')
const prefsPath = join(app.getPath('userData'), 'desktop-settings.json')
const DEFAULT_PREFS = { welcomed: false, startAtLogin: true, keepAwake: true, dailyUpdateCheck: true, lastUpdateCheck: 0 }

let prefs = { ...DEFAULT_PREFS }
let win = null
let tray = null
let pendingRoute = '/'
let updateAvailable = null
let sleepBlocker = null
let quitting = false
const state = { hub: 'stopped', devices: null, relayOutdated: false, updateAvailable: null, prefs, appVersion }

// --- The hub -----------------------------------------------------------------------------------

const hubLog = { write: () => {} }
const hub = new HubProcess({
  command: process.execPath,
  args: [join(repoRoot, 'hub', 'src', 'cli.js'), '--no-open', '--port', String(HUB_PORT), '--data', dataDir, '--dist', join(repoRoot, 'frontend', 'dist')],
  cwd: repoRoot,
  env: {
    ELECTRON_RUN_AS_NODE: '1',
    YGGLTREE_APP_VERSION: appVersion,
    YGGLTREE_NODE_BIN: process.execPath,
    YGGLTREE_WRANGLER_BIN: join(repoRoot, 'relay', 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    YGGLTREE_RELAY_DIR: join(repoRoot, 'relay'),
    YGGLTREE_RELAY_PREBUILT: '1',
    YGGLTREE_NO_OPEN: '1',
  },
  log: hubLog,
})

async function openHubLog() {
  await mkdir(logDir, { recursive: true })
  const stream = createWriteStream(join(logDir, 'hub.log'), { flags: 'a' })
  hubLog.write = (text) => stream.write(text)
}

// --- Preferences -------------------------------------------------------------------------------

async function loadPrefs() {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(await readFile(prefsPath, 'utf8')) }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

async function savePrefs() {
  await mkdir(dirname(prefsPath), { recursive: true })
  await writeFile(prefsPath, JSON.stringify(prefs, null, 2))
}

// macOS can refuse a login item for an app it doesn't recognize; the menu still shows the choice.
function applyLoginItem() {
  try {
    app.setLoginItemSettings({ openAtLogin: prefs.startAtLogin, openAsHidden: true })
  } catch {
    // Not fatal: Yggltree still runs, and the family can add it to Login Items by hand.
  }
}

function applyKeepAwake() {
  if (prefs.keepAwake && sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-app-suspension')
  if (!prefs.keepAwake && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker)
    sleepBlocker = null
  }
}

// --- The window --------------------------------------------------------------------------------

function isLocal(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && (Number(u.port) || 80) === HUB_PORT
  } catch {
    return false
  }
}

// Hands a link to the family's browser or mail app, but only for the kinds of link externalLinkOf allows.
function openExternal(url) {
  const link = externalLinkOf(url)
  if (link) shell.openExternal(link)
}

function openWindow(route = '/') {
  pendingRoute = route
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      width: 1200,
      height: 820,
      minWidth: 420,
      minHeight: 600,
      title: 'Yggltree',
      show: false,
      webPreferences: {
        preload: join(here, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      win = null
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (!isLocal(url)) {
        event.preventDefault()
        openExternal(url)
      }
    })
  }
  if (hub.status === 'running') win.loadURL(hub.url + route)
  else win.loadFile(join(here, 'loading.html'))
  win.show()
  win.focus()
}

// Once the hub answers, the window moves from the loading page to the family's app.
function showHub() {
  if (win && !win.isDestroyed() && hub.status === 'running') win.loadURL(hub.url + pendingRoute)
}

// --- The menu bar ------------------------------------------------------------------------------

// The Mac menu bar uses black template images that macOS tints. A Windows taskbar is often dark, so Windows
// gets a full-color leaf that doesn't depend on tinting.
const TRAY_ICONS = process.platform === 'win32'
  ? { idle: 'trayWindows.png', attention: 'trayWindows.png' }
  : { idle: 'trayTemplate.png', attention: 'trayAttentionTemplate.png' }

function trayImage(name) {
  const icon = nativeImage.createFromPath(join(here, 'assets', name))
  icon.setTemplateImage(process.platform === 'darwin')
  return icon
}

function createTray() {
  tray = new Tray(trayImage(TRAY_ICONS.idle))
  tray.setToolTip('Yggltree')
  refreshMenu()
}

function refreshMenu() {
  state.hub = hub.status
  state.prefs = prefs
  state.updateAvailable = updateAvailable?.version ?? null
  const items = buildMenu(state).map(toElectronItem)
  tray.setContextMenu(Menu.buildFromTemplate(items))
  if (tray.setImage) {
    tray.setImage(trayImage(needsAttention(state) ? TRAY_ICONS.attention : TRAY_ICONS.idle))
  }
}

function toElectronItem(item) {
  if (item.type === 'separator') return { type: 'separator' }
  if (item.submenu) return { label: item.label, submenu: item.submenu.map(toElectronItem) }
  if (!item.action) return { label: item.label, enabled: false }
  const base = { label: item.label, enabled: item.enabled !== false, click: () => runAction(item.action) }
  if (item.checked !== undefined) return { ...base, type: 'checkbox', checked: item.checked }
  return base
}

function runAction(name) {
  Promise.resolve()
    .then(() => actions[name]())
    .catch((err) => dialog.showErrorBox('Yggltree', String(err?.message ?? err)))
}

// --- Admin actions -----------------------------------------------------------------------------

async function startOrRestartHub() {
  const running = hub.status === 'running'
  if (running) {
    const choice = await dialog.showMessageBox({
      type: 'question',
      message: 'Restart Yggltree?',
      detail: 'Phones keep syncing. This takes a few seconds.',
      buttons: ['Restart', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice.response !== 0) return
  }
  refreshMenu()
  const status = running ? await hub.restart() : await hub.start()
  refreshMenu()
  if (status !== 'running') {
    dialog.showErrorBox("Yggltree couldn't start", `${hub.error ?? ''}\n\nThe log is in ${logDir}.`)
    return
  }
  showHub()
  pollHub()
}

async function resetAdminPin() {
  const sure = await dialog.showMessageBox({
    type: 'warning',
    message: 'Reset the admin PIN?',
    detail: "Every admin's PIN is cleared. Each admin sets a new one the next time they open Yggltree. Use this only when an admin has forgotten theirs.",
    buttons: ['Reset PINs', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  })
  if (sure.response !== 0) return
  if (hub.status !== 'running') {
    dialog.showErrorBox('Yggltree', "Yggltree isn't running. Start it from the menu, then try again.")
    return
  }
  const token = (await readFile(join(dataDir, 'reset-token'), 'utf8').catch(() => '')).trim()
  if (!token) {
    dialog.showErrorBox('Yggltree', "Yggltree hasn't finished starting. Try again in a moment.")
    return
  }
  const res = await fetch(`http://127.0.0.1:${HUB_PORT}/api/admin/reset-pin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-family-hub-admin': '1', 'x-family-hub-reset-token': token },
    body: '{}',
  }).catch(() => null)
  if (res?.status === 200) {
    const body = await res.json().catch(() => ({ admins: [] }))
    const names = Array.isArray(body.admins) ? body.admins : []
    await dialog.showMessageBox({
      message: 'The PIN is reset',
      detail: `Cleared the admin PIN for: ${names.join(', ') || 'no one'}. Each admin sets a new PIN the next time they open Yggltree.`,
    })
    return
  }
  dialog.showErrorBox('Yggltree', "Yggltree didn't reset the PIN. Restart it from the menu, then try again.")
}

// Asks the hub which build the family's relay serves, and sets the dot on the leaf when it's older.
async function checkRelay() {
  if (hub.status !== 'running' || !win || win.isDestroyed()) {
    state.relayOutdated = false
    return
  }
  const raw = await win.webContents.executeJavaScript("localStorage.getItem('fh.relay')").catch(() => null)
  const url = safeRelayUrl(raw)
  if (!url) {
    state.relayOutdated = false
    refreshMenu()
    return
  }
  const res = await fetch(`http://127.0.0.1:${HUB_PORT}/api/relay/version?url=${encodeURIComponent(url)}`).catch(() => null)
  const body = res?.ok ? await res.json().catch(() => null) : null
  state.relayOutdated = body?.relayBuild != null && body?.localBuild != null && !body.upToDate
  refreshMenu()
}

function safeRelayUrl(raw) {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed?.url === 'string' ? parsed.url : null
  } catch {
    return null
  }
}

// Asks the hub how many devices are connected, and the relay which build it serves.
async function pollHub() {
  if (hub.status !== 'running') {
    state.devices = null
    refreshMenu()
    return
  }
  const res = await fetch(`http://127.0.0.1:${HUB_PORT}/api/hub/info`).catch(() => null)
  const body = res?.ok ? await res.json().catch(() => null) : null
  state.devices = typeof body?.devices === 'number' ? body.devices : null
  refreshMenu()
}

async function checkUpdatesNow({ manual }) {
  const release = await checkForUpdate({ currentVersion: appVersion })
  prefs.lastUpdateCheck = Date.now()
  await savePrefs()
  updateAvailable = release
  refreshMenu()
  if (!manual) return
  if (release) {
    await dialog.showMessageBox({
      message: `Version ${release.version} is available`,
      detail: 'Quit Yggltree, then drag the new Yggltree into Applications and replace the old one. Your family\'s data stays where it is.',
    })
  } else {
    await dialog.showMessageBox({
      message: 'Yggltree is up to date, or GitHub could not be reached',
      detail: `You have version ${appVersion}.`,
    })
  }
}

const actions = {
  openWindow: () => openWindow('/'),
  addDevice: () => openWindow('/settings'),
  updateRelay: () => openWindow('/settings'),
  showBackups: () => shell.openPath(join(dataDir, 'backups')),
  restart: () => startOrRestartHub(),
  resetPin: () => resetAdminPin(),
  showData: () => shell.openPath(dataDir),
  showLog: () => shell.openPath(join(logDir, 'hub.log')),
  help: () => openWindow('/help'),
  download: () => openExternal(updateAvailable?.url ?? DOWNLOAD_PAGE),
  checkUpdates: () => checkUpdatesNow({ manual: true }),
  toggleDailyUpdates: async () => {
    prefs.dailyUpdateCheck = !prefs.dailyUpdateCheck
    await savePrefs()
    refreshMenu()
  },
  toggleStartAtLogin: async () => {
    prefs.startAtLogin = !prefs.startAtLogin
    applyLoginItem()
    await savePrefs()
    refreshMenu()
  },
  toggleKeepAwake: async () => {
    prefs.keepAwake = !prefs.keepAwake
    applyKeepAwake()
    await savePrefs()
    refreshMenu()
  },
  about: () =>
    dialog.showMessageBox({
      message: `Yggltree ${appVersion}`,
      detail: 'Free and open source (MIT). Your family\'s data stays on your computers and on your family\'s relay.',
    }),
  quit: () => app.quit(),
}

// --- Start up and shut down --------------------------------------------------------------------

async function start() {
  await openHubLog()
  prefs = await loadPrefs()
  if (!prefs.welcomed) {
    const choice = await dialog.showMessageBox({
      type: 'question',
      message: 'Start Yggltree when you log in?',
      detail: 'Yggltree keeps running in the menu bar, so phones keep syncing while this Mac is on. Closing the window doesn\'t stop it.',
      buttons: ['Start at login', 'Not now'],
      defaultId: 0,
      cancelId: 1,
    })
    prefs.startAtLogin = choice.response === 0
    prefs.welcomed = true
    await savePrefs()
  }
  applyLoginItem()
  applyKeepAwake()
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && isLocal(webContents.getURL()))
  })
  createTray()
  openWindow('/')
  await startOrRestartHub().catch(() => {})
  await checkRelay()
  setInterval(pollHub, 15_000)
  setInterval(checkRelay, 5 * 60_000)
  setInterval(() => {
    if (dailyCheckDue({ enabled: prefs.dailyUpdateCheck, lastCheckedAt: prefs.lastUpdateCheck })) checkUpdatesNow({ manual: false })
  }, 60 * 60_000)
  if (dailyCheckDue({ enabled: prefs.dailyUpdateCheck, lastCheckedAt: prefs.lastUpdateCheck })) checkUpdatesNow({ manual: false })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => openWindow('/'))
  app.on('activate', () => openWindow('/'))
  // Closing the window keeps Yggltree running in the menu bar, so phones keep syncing.
  app.on('window-all-closed', () => {})
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    hub.stop().finally(() => app.quit())
  })
  app.whenReady().then(() => start().catch((err) => dialog.showErrorBox('Yggltree', String(err?.message ?? err))))
}
