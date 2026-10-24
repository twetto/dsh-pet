const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('avatarBridge', {
  configuration: () => ipcRenderer.invoke('avatar:configuration'),
  onChange: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('avatar:changed', listener);
    return () => ipcRenderer.removeListener('avatar:changed', listener);
  },
  onPointer: (callback) => ipcRenderer.on('avatar:pointer', (_event, point) => callback(point)),
  hit: (value) => ipcRenderer.send('avatar:hit', value === true),
  beginDrag: () => ipcRenderer.send('avatar:drag', 'begin'),
  endDrag: () => ipcRenderer.send('avatar:drag', 'end'),
  menu: () => ipcRenderer.send('avatar:menu'),
  openChat: () => ipcRenderer.send('avatar:chat'),
});
