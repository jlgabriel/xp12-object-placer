/**
 * The only privileged bridge.
 *
 * contextIsolation is on, so everything goes through contextBridge — `window` is never touched
 * directly. Adding a method here means adding its handler in main/ipc.ts under the same channel,
 * and nothing else in the renderer may reach Electron.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { XopApi, ScanProgress } from '../shared/api.js';

const SCAN_PROGRESS = 'xop:scanProgress';
const SAVE_BEFORE_CLOSE = 'xop:saveBeforeClose';

const api: XopApi = {
  getVersion: () => ipcRenderer.invoke('xop:getVersion'),
  openLog: () => ipcRenderer.invoke('xop:openLog'),

  listInstallations: () => ipcRenderer.invoke('xop:listInstallations'),
  currentInstallation: () => ipcRenderer.invoke('xop:currentInstallation'),
  selectInstallation: (path) => ipcRenderer.invoke('xop:selectInstallation', path),
  browseForInstallation: () => ipcRenderer.invoke('xop:browseForInstallation'),

  getCatalog: () => ipcRenderer.invoke('xop:getCatalog'),
  rescanCatalog: () => ipcRenderer.invoke('xop:rescanCatalog'),

  exportPack: (request) => ipcRenderer.invoke('xop:exportPack', request),
  listInstalledPacks: () => ipcRenderer.invoke('xop:listInstalledPacks'),
  uninstallPack: (packName) => ipcRenderer.invoke('xop:uninstallPack', packName),

  newProject: () => ipcRenderer.invoke('xop:newProject'),
  openProject: () => ipcRenderer.invoke('xop:openProject'),
  saveProject: (project) => ipcRenderer.invoke('xop:saveProject', project),
  saveProjectAs: (project) => ipcRenderer.invoke('xop:saveProjectAs', project),
  markDirty: (dirty) => ipcRenderer.invoke('xop:markDirty', dirty),

  getThumbnail: (virtualPath) => ipcRenderer.invoke('xop:getThumbnail', virtualPath),
  getObjectGeometry: (virtualPath) => ipcRenderer.invoke('xop:getObjectGeometry', virtualPath),
  putThumbnail: (virtualPath, png) => ipcRenderer.invoke('xop:putThumbnail', virtualPath, png),
  closeWindow: () => ipcRenderer.invoke('xop:closeWindow'),

  onSaveBeforeClose: (listener: () => void) => {
    const handler = (): void => listener();
    ipcRenderer.on(SAVE_BEFORE_CLOSE, handler);
    return () => ipcRenderer.removeListener(SAVE_BEFORE_CLOSE, handler);
  },

  onScanProgress: (listener: (progress: ScanProgress) => void) => {
    // The payload is re-read off the event rather than forwarded blind, so the renderer only ever
    // sees the shape it declared. Returning the unsubscribe keeps React effects honest.
    const handler = (_event: unknown, progress: ScanProgress): void => listener(progress);
    ipcRenderer.on(SCAN_PROGRESS, handler);
    return () => ipcRenderer.removeListener(SCAN_PROGRESS, handler);
  },
};

contextBridge.exposeInMainWorld('xop', api);
