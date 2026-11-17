import { contextBridge, ipcRenderer } from 'electron';
const subscribe = (channel: string, callback: (data: unknown) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('alice', {
  ready: (kind: 'pet' | 'chat') => ipcRenderer.send(kind === 'pet' ? 'renderer-ready' : 'chat-ready'),
  onPlay: (callback: (data: unknown) => void) => subscribe('play', callback),
  onSuspend: (callback: (data: unknown) => void) => subscribe('suspend-playback', callback),
  suspended: () => ipcRenderer.send('playback-suspended'),
  onPose: (callback: (data: unknown) => void) => subscribe('pose', callback),
  onChat: (callback: (data: unknown) => void) => subscribe('chat-state', callback),
  hit: (value: boolean) => ipcRenderer.send('hit', value),
  pointer: (kind: string) => ipcRenderer.send('pet-pointer', kind),
  ended: (token: number) => ipcRenderer.send('ended', token),
  videoReady: (token: number) => ipcRenderer.send('video-ready', token),
  videoError: (text: string) => ipcRenderer.send('video-error', text),
  frames: (count: number) => ipcRenderer.send('frame', count),
  closeChat: () => ipcRenderer.send('chat-close'),
  send: (text: string) => ipcRenderer.invoke('chat-send', text)
});
