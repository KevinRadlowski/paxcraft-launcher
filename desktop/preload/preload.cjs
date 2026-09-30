/**

 * Preload bridge — contextIsolation + contextBridge only.

 * Unwraps IpcResult envelopes; never exposes ipcRenderer.

 * Auth/install events: explicit listeners only (no arbitrary channel subscription).

 */

const { contextBridge, ipcRenderer } = require("electron");



const IpcChannels = {

  APP_GET_INFO: "sc:app:getInfo",

  APP_MINIMIZE: "sc:app:minimize",

  APP_MAXIMIZE: "sc:app:maximize",

  APP_CLOSE: "sc:app:close",

  LAUNCHER_GET_STATUS: "sc:launcher:getStatus",

  INSTALL_GET_STATUS: "sc:install:getStatus",

  INSTALL_INSTALL: "sc:install:install",

  INSTALL_UPDATE: "sc:install:update",

  INSTALL_REPAIR: "sc:install:repair",

  INSTALL_UNINSTALL: "sc:install:uninstall",

  ACCOUNTS_LIST: "sc:accounts:list",

  ACCOUNTS_SELECT: "sc:accounts:select",

  SETTINGS_GET: "sc:settings:get",

  SETTINGS_UPDATE: "sc:settings:update",

  DIAGNOSTICS_GET: "sc:diagnostics:get",

  DIAGNOSTICS_COPY: "sc:diagnostics:copy",

  SERVER_GET_STATUS: "sc:server:getStatus",

  SYSTEM_GET_INFO: "sc:system:getInfo",

  SYSTEM_GET_FIXED_DISKS: "sc:system:getFixedDisks",

  STORAGE_GET_SUMMARY: "sc:storage:getSummary",

  STORAGE_OPEN_INSTANCE: "sc:storage:openInstance",

  STORAGE_OPEN_LOGS: "sc:storage:openLogs",

  INSTANCE_CHOOSE_LOCATION: "sc:instance:chooseLocation",

  INSTANCE_SET_LOCATION: "sc:instance:setLocation",

  INSTANCE_MOVE: "sc:instance:move",

  AUTH_GET_STATE: "sc:auth:getState",

  AUTH_RESTORE: "sc:auth:restore",

  AUTH_LOGIN: "sc:auth:login",

  AUTH_LOGOUT: "sc:auth:logout",

  DEV_AUTH_SET_FIXTURE: "sc:dev:auth:setFixture",

  DEV_INSTALL_SET_FIXTURE: "sc:dev:install:setFixture",

  PLAY_GET_STATUS: "sc:play:getStatus",

  PLAY_START: "sc:play:start",

  DEV_PLAY_SET_FIXTURE: "sc:dev:play:setFixture",

  DEV_PLAY_SIMULATE_EXIT: "sc:dev:play:simulateExit"

};



const IpcEventChannels = {

  LAUNCHER_STATUS_CHANGED: "sc:event:launcherStatusChanged",

  INSTALL_PROGRESS: "sc:event:installProgress",

  AUTH_STATE_CHANGED: "sc:event:authStateChanged",

  AUTH_PROGRESS: "sc:event:authProgress",

  PLAY_STATUS_CHANGED: "sc:event:playStatusChanged",

  NOTIFICATION: "sc:event:notification"

};



function unwrap(raw) {

  if (!raw || typeof raw !== "object" || typeof raw.ok !== "boolean") {

    const err = { code: "IPC_INVALID_RESPONSE", messageKey: "errors.ipc.invalid_response" };

    return Promise.reject(err);

  }

  if (!raw.ok) {

    const err =

      raw.error && typeof raw.error === "object"

        ? {

            code: String(raw.error.code || "INTERNAL_ERROR").slice(0, 128),

            messageKey: String(raw.error.messageKey || "errors.internal").slice(0, 128)

          }

        : { code: "INTERNAL_ERROR", messageKey: "errors.internal" };

    return Promise.reject(err);

  }

  return Promise.resolve(raw.value);

}



function invoke(channel, payload) {

  if (arguments.length === 1) {

    return ipcRenderer.invoke(channel).then(unwrap);

  }

  return ipcRenderer.invoke(channel, payload).then(unwrap);

}



function subscribe(channel, listener) {

  const handler = (_e, payload) => {

    try {

      listener(payload);

    } catch {

      // ignore

    }

  };

  ipcRenderer.on(channel, handler);

  return () => {

    ipcRenderer.removeListener(channel, handler);

  };

}



const api = {

  app: {

    getInfo: () => invoke(IpcChannels.APP_GET_INFO),

    minimize: () => invoke(IpcChannels.APP_MINIMIZE).then(() => undefined),

    maximize: () => invoke(IpcChannels.APP_MAXIMIZE).then(() => undefined),

    close: () => invoke(IpcChannels.APP_CLOSE).then(() => undefined)

  },

  launcher: {

    getStatus: () => invoke(IpcChannels.LAUNCHER_GET_STATUS)

  },

  install: {

    getStatus: () => invoke(IpcChannels.INSTALL_GET_STATUS),

    install: () => invoke(IpcChannels.INSTALL_INSTALL),

    update: () => invoke(IpcChannels.INSTALL_UPDATE),

    repair: () => invoke(IpcChannels.INSTALL_REPAIR),

    uninstall: (mode) => invoke(IpcChannels.INSTALL_UNINSTALL, { mode })

  },

  play: {

    getStatus: () => invoke(IpcChannels.PLAY_GET_STATUS),

    start: () => invoke(IpcChannels.PLAY_START)

  },

  accounts: {

    list: () => invoke(IpcChannels.ACCOUNTS_LIST),

    select: (accountId) => invoke(IpcChannels.ACCOUNTS_SELECT, { accountId })

  },

  auth: {

    getState: () => invoke(IpcChannels.AUTH_GET_STATE),

    restore: (accountId) =>

      accountId

        ? invoke(IpcChannels.AUTH_RESTORE, { accountId })

        : invoke(IpcChannels.AUTH_RESTORE),

    login: () => invoke(IpcChannels.AUTH_LOGIN),

    logout: (accountId) => invoke(IpcChannels.AUTH_LOGOUT, { accountId })

  },

  /** Main rejects when harness inactive; channels may be unregistered in production. */

  dev: {

    setAuthFixture: (fixture) => invoke(IpcChannels.DEV_AUTH_SET_FIXTURE, { fixture }),

    setInstallFixture: (fixture) => invoke(IpcChannels.DEV_INSTALL_SET_FIXTURE, { fixture }),

    setPlayFixture: (fixture) => invoke(IpcChannels.DEV_PLAY_SET_FIXTURE, { fixture }),

    simulatePlayExit: (opts) => invoke(IpcChannels.DEV_PLAY_SIMULATE_EXIT, opts ?? {})

  },

  settings: {

    get: () => invoke(IpcChannels.SETTINGS_GET),

    update: (patch) => invoke(IpcChannels.SETTINGS_UPDATE, patch)

  },

  diagnostics: {

    get: () => invoke(IpcChannels.DIAGNOSTICS_GET),

    copy: () => invoke(IpcChannels.DIAGNOSTICS_COPY)

  },

  server: {

    getStatus: () => invoke(IpcChannels.SERVER_GET_STATUS)

  },

  system: {

    getInfo: () => invoke(IpcChannels.SYSTEM_GET_INFO),

    getFixedDisks: () => invoke(IpcChannels.SYSTEM_GET_FIXED_DISKS)

  },

  storage: {

    getSummary: () => invoke(IpcChannels.STORAGE_GET_SUMMARY),

    openInstance: () => invoke(IpcChannels.STORAGE_OPEN_INSTANCE),

    openLogs: () => invoke(IpcChannels.STORAGE_OPEN_LOGS)

  },

  instance: {

    chooseLocation: () => invoke(IpcChannels.INSTANCE_CHOOSE_LOCATION),

    setLocation: (path) => invoke(IpcChannels.INSTANCE_SET_LOCATION, { path }),

    move: (destinationPath) => invoke(IpcChannels.INSTANCE_MOVE, { path: destinationPath })

  },

  events: {

    onAuthStateChanged: (listener) =>

      subscribe(IpcEventChannels.AUTH_STATE_CHANGED, listener),

    onAuthProgress: (listener) => subscribe(IpcEventChannels.AUTH_PROGRESS, listener),

    onInstallProgress: (listener) =>

      subscribe(IpcEventChannels.INSTALL_PROGRESS, listener),

    onLauncherStatusChanged: (listener) =>

      subscribe(IpcEventChannels.LAUNCHER_STATUS_CHANGED, listener),

    onPlayStatusChanged: (listener) =>

      subscribe(IpcEventChannels.PLAY_STATUS_CHANGED, listener),

    onNotification: (listener) => subscribe(IpcEventChannels.NOTIFICATION, listener)

  }

};



contextBridge.exposeInMainWorld("sweetcraft", Object.freeze(api));


