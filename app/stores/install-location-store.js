
let walk = require('walk')
let electron = require('electron')
let uuid = require('node-uuid')

let db = require('../util/db')
let explorer = require('../util/explorer')
let log = require('../util/log')('install-location-store')
let opts = { logger: new log.Logger() }

let deep = require('deep-diff')

let AppDispatcher = require('../dispatcher/app-dispatcher')
let AppConstants = require('../constants/app-constants')
let AppActions = require('../actions/app-actions')
let Store = require('./store')
let PreferencesStore = require('./preferences-store')
let WindowStore = require('./window-store')
let I18nStore = require('./i18n-store')
let SetupStore = require('./setup-store')

let appdata_location = null
let computations_to_cancel = {}
let location_sizes = {}
let location_computing_size = {}
let location_item_counts = {}

let state = {}

let InstallLocationStore = Object.assign(new Store('install-location-store'), {
  get_state: () => {
    return state
  },

  get_location: (name) => {
    if (name === 'appdata') {
      return appdata_location
    } else {
      let locs = PreferencesStore.get_state().install_locations || {}
      return locs[name]
    }
  }
})

function compute_state () {
  let prefs = PreferencesStore.get_state()
  let raw_locations = Object.assign({}, prefs.install_locations || {}, {appdata: appdata_location})
  let locations = {}

  for (let loc_name of Object.keys(raw_locations)) {
    let raw_loc = raw_locations[loc_name]

    let size = location_sizes[loc_name]
    if (typeof size === 'undefined') { size = -1 }

    let computing_size = !!location_computing_size[loc_name]
    let item_count = location_item_counts[loc_name] || 0

    let loc = Object.assign({}, raw_loc, {
      size,
      computing_size,
      item_count
    })

    locations[loc_name] = loc
  }

  let aliases = [
    [process.env.HOME, '~']
  ]

  return {
    locations,
    aliases,
    default: prefs.default_install_location || 'appdata'
  }
}

function recompute_state () {
  let old_state = state
  let new_state = compute_state()
  let state_diff = deep.diff(old_state, new_state)

  if (!state_diff) return
  AppActions.install_location_store_diff(state_diff)

  InstallLocationStore.emit_change()
}

async function reload () {
  appdata_location = {
    name: 'appdata',
    path: db.library_dir
  }

  location_item_counts = {}

  let caves = await db.find({_table: 'caves'})
  for (let cave of caves) {
    let loc_name = cave.install_location || 'appdata'
    if (typeof location_item_counts[loc_name] === 'undefined') {
      location_item_counts[loc_name] = 0
    }
    location_item_counts[loc_name]++
  }

  recompute_state()
}

let timeout = null
let throttle = 500

function throttled_reload () {
  if (timeout) return

  timeout = setTimeout(() => {
    timeout = null
    reload()
  }, throttle)
}

function install_location_compute_size (payload) {
  let name = payload.name
  log(opts, `Computing location of ${name}`)

  delete computations_to_cancel[name]

  let loc = InstallLocationStore.get_location(name)
  if (!loc) {
    log(opts, `Unknown location, bailing out: ${loc}`)
  }

  let total_size = 0
  location_sizes[name] = 0
  location_computing_size[name] = true
  let walker = walk.walk(loc.path)

  walker.on('file', (root, fileStats, next) => {
    total_size += fileStats.size
    location_sizes[name] = total_size
    recompute_state()
    if (computations_to_cancel[name]) {
      delete computations_to_cancel[name]
      // location size will be inaccurate but, eh, user cancelled.
      // it might also be inaccurate because files were added since
      // last computed. it's not an exact science.
      location_computing_size[name] = false
      recompute_state()

      // not calling 'next' here will stop file walk
    } else {
      next()
    }
  })

  walker.on('end', () => {
    log(opts, `Total size of ${name}: ${total_size}`)
    location_sizes[name] = total_size
    location_computing_size[name] = false
    recompute_state()
  })
}

function install_location_cancel_size_computation (payload) {
  computations_to_cancel[payload.name] = true
}

async function install_location_add_request () {
  let i18n = I18nStore.get_state()

  let dialog_opts = {
    title: i18n.t('prompt.install_location_add.title'),
    properties: ['openDirectory']
  }
  let window
  WindowStore.with(w => window = w)

  let callback = (response) => {
    if (!response) {
      log(opts, `Install location addition was cancelled`)
      return
    }

    let loc_name = uuid.v4()
    let loc_path = response[0]
    AppActions.install_location_add(loc_name, loc_path)
    log(opts, `Adding install location at ${loc_path} with name ${loc_name}`)
  }
  electron.dialog.showOpenDialog(window, dialog_opts, callback)
}

async function install_location_remove_request (payload) {
  let name = payload.name
  let loc = InstallLocationStore.get_location(name)
  if (!loc) {
    log(opts, `Cannot remove unknown location ${loc}`)
    return
  }

  let i18n = I18nStore.get_state()

  let buttons = [
    i18n.t('prompt.action.confirm_removal'),
    i18n.t('prompt.action.cancel')
  ]

  let dialog_opts = {
    title: i18n.t('prompt.install_location_remove.title'),
    message: i18n.t('prompt.install_location_remove.message'),
    detail: i18n.t('prompt.install_location_remove.detail', {location: loc.path}),
    buttons
  }

  let callback = (response) => {
    if (response === 0) {
      AppActions.install_location_remove(payload.name)
    }
  }
  electron.dialog.showMessageBox(dialog_opts, callback)
}

async function install_location_browse (payload) {
  let name = payload.name
  let loc = InstallLocationStore.get_location(name)
  if (!loc) {
    log(opts, `Cannot browse unknown location ${loc}`)
    return
  }

  log(opts, `Browsing location ${loc}`)
  explorer.open(loc.path)
}

async function logout () {
  delete location_sizes['appdata']
  delete location_item_counts['appdata']
}

AppDispatcher.register('install-location-store', Store.action_listeners(on => {
  on(AppConstants.READY_TO_ROLL, reload)
  on(AppConstants.CAVE_PROGRESS, throttled_reload)
  on(AppConstants.CAVE_THROWN_INTO_BIT_BUCKET, reload)
  on(AppConstants.LOGOUT, logout)
  on(AppConstants.INSTALL_LOCATION_COMPUTE_SIZE, install_location_compute_size)
  on(AppConstants.INSTALL_LOCATION_CANCEL_SIZE_COMPUTATION, install_location_cancel_size_computation)
  on(AppConstants.INSTALL_LOCATION_BROWSE, install_location_browse)
  on(AppConstants.INSTALL_LOCATION_ADD_REQUEST, install_location_add_request)
  on(AppConstants.INSTALL_LOCATION_ADDED, reload)
  on(AppConstants.INSTALL_LOCATION_REMOVE_REQUEST, install_location_remove_request)
  on(AppConstants.INSTALL_LOCATION_REMOVED, reload)
}))

PreferencesStore.add_change_listener('install-location-store', () => {
  if (!SetupStore.is_ready()) return
  reload()
})

module.exports = InstallLocationStore
