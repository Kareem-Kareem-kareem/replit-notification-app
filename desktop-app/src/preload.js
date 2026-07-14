'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voicecast', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveAndConnect: (data) => ipcRenderer.invoke('save-and-connect', data),
  getStatus: () => ipcRenderer.invoke('get-status'),
  onWsStatus: (callback) => {
    ipcRenderer.on('ws-status', (_event, data) => callback(data));
  },
});
