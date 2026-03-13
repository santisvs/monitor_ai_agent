import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Installer
  getInstallerSetup: () =>
    ipcRenderer.invoke('installer:get-setup'),
  validateToken: (token: string, serverUrl: string) =>
    ipcRenderer.invoke('installer:validate-token', token, serverUrl),
  saveConfig: (token: string, serverUrl: string) =>
    ipcRenderer.invoke('installer:save-config', token, serverUrl),
  installService: () =>
    ipcRenderer.invoke('installer:install-service'),
  registerSetup: (collectors: string[]) =>
    ipcRenderer.invoke('installer:register-setup', collectors),
  runFirstCollection: () =>
    ipcRenderer.invoke('installer:run-first-collection'),
  createShortcut: () =>
    ipcRenderer.invoke('installer:create-shortcut'),
  finishInstall: () =>
    ipcRenderer.invoke('installer:finish'),
  cancelInstall: () =>
    ipcRenderer.invoke('installer:cancel'),
  getServerUrl: () =>
    ipcRenderer.invoke('installer:get-server-url'),

  // Shared
  getAppVersion: () =>
    ipcRenderer.invoke('app:get-version'),

  // App window
  getStatus: () =>
    ipcRenderer.invoke('app:get-status'),
  revealApiKey: () =>
    ipcRenderer.invoke('app:reveal-apikey'),
  uninstall: () =>
    ipcRenderer.invoke('app:uninstall'),
  closeWindow: () =>
    ipcRenderer.invoke('app:close-window'),
  openDownloadPage: (version: string) =>
    ipcRenderer.invoke('app:open-download', version),
})
