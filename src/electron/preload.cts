import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('desktop', { platform: process.platform, chooseLibrary: () => ipcRenderer.invoke('choose-library') });
