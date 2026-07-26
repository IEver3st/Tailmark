import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppSnapshot, DownloadAutomationEvent, OperationProgress, TailmarkApi } from '@shared/models';

const api: TailmarkApi = {
  app: {
    bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
    snapshot: () => ipcRenderer.invoke('app:snapshot'),
    openAppData: () => ipcRenderer.invoke('app:open-data'),
    clearTemporaryFiles: () => ipcRenderer.invoke('app:clear-temp'),
  },
  dialogs: {
    chooseArchives: () => ipcRenderer.invoke('dialogs:archives'),
    chooseImportFolder: () => ipcRenderer.invoke('dialogs:folder'),
    chooseGameRoot: () => ipcRenderer.invoke('dialogs:game-root'),
    chooseDownloadsFolder: () => ipcRenderer.invoke('dialogs:downloads-folder'),
    exportActivity: (defaultName, content) => ipcRenderer.invoke('dialogs:export-activity', defaultName, content),
  },
  files: {
    pathsForDroppedFiles: (files) => files.flatMap((file) => {
      const path = webUtils.getPathForFile(file);
      return path ? [path] : [];
    }),
    openPath: (path) => ipcRenderer.invoke('files:open-path', path),
  },
  archives: {
    analyze: (request) => ipcRenderer.invoke('archives:analyze', request),
    cancel: (operationId) => ipcRenderer.invoke('archives:cancel', operationId),
  },
  install: { run: (request) => ipcRenderer.invoke('install:run', request) },
  library: {
    refresh: () => ipcRenderer.invoke('library:refresh'),
    removeSkin: (id) => ipcRenderer.invoke('library:remove-skin', id),
    removeSound: (id) => ipcRenderer.invoke('library:remove-sound', id),
    renameSkin: (id, name) => ipcRenderer.invoke('library:rename-skin', id, name),
    activateSound: (id) => ipcRenderer.invoke('library:activate-sound', id),
    deactivateSound: () => ipcRenderer.invoke('library:deactivate-sound'),
    createProfile: (name, packageIds) => ipcRenderer.invoke('library:create-profile', name, packageIds),
    adoptSound: (name) => ipcRenderer.invoke('library:adopt-sound', name),
    reconnectSound: () => ipcRenderer.invoke('library:reconnect-sound'),
    activateProfile: (id) => ipcRenderer.invoke('library:activate-profile', id),
    renameProfile: (id, name) => ipcRenderer.invoke('library:rename-profile', id, name),
    removeProfile: (id) => ipcRenderer.invoke('library:remove-profile', id),
    restoreBackup: (id) => ipcRenderer.invoke('library:restore-backup', id),
    createCollection: (name) => ipcRenderer.invoke('library:create-collection', name),
    setCollectionMembers: (id, skinIds) => ipcRenderer.invoke('library:set-collection-members', id, skinIds),
    activateCollection: (id) => ipcRenderer.invoke('library:activate-collection', id),
    removeCollection: (id) => ipcRenderer.invoke('library:remove-collection', id),
    importSights: (paths) => ipcRenderer.invoke('library:import-sights', paths),
    activateSight: (id) => ipcRenderer.invoke('library:activate-sight', id),
    deactivateSight: (id) => ipcRenderer.invoke('library:deactivate-sight', id),
    removeSight: (id) => ipcRenderer.invoke('library:remove-sight', id),
    importHangars: (paths) => ipcRenderer.invoke('library:import-hangars', paths),
    activateHangar: (id) => ipcRenderer.invoke('library:activate-hangar', id),
    deactivateHangar: () => ipcRenderer.invoke('library:deactivate-hangar'),
    removeHangar: (id) => ipcRenderer.invoke('library:remove-hangar', id),
  },
  safeMode: {
    enter: () => ipcRenderer.invoke('safe-mode:enter'),
    restore: () => ipcRenderer.invoke('safe-mode:restore'),
  },
  recovery: {
    resume: () => ipcRenderer.invoke('recovery:resume'),
    rollback: () => ipcRenderer.invoke('recovery:rollback'),
  },
  game: {
    detect: () => ipcRenderer.invoke('game:detect'),
    validate: (path) => ipcRenderer.invoke('game:validate', path),
    running: () => ipcRenderer.invoke('game:running'),
  },
  settings: {
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    reset: () => ipcRenderer.invoke('settings:reset'),
  },
  window: { control: (action) => ipcRenderer.invoke('window:control', action) },
  events: {
    onProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: OperationProgress) => callback(progress);
      ipcRenderer.on('events:progress', listener);
      return () => ipcRenderer.removeListener('events:progress', listener);
    },
    onSnapshot: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
      ipcRenderer.on('events:snapshot', listener);
      return () => ipcRenderer.removeListener('events:snapshot', listener);
    },
    onDownloadAutomation: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, event: DownloadAutomationEvent) => callback(event);
      ipcRenderer.on('events:download-automation', listener);
      return () => ipcRenderer.removeListener('events:download-automation', listener);
    },
  },
};

contextBridge.exposeInMainWorld('tailmark', api);
