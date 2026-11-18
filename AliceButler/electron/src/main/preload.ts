import { contextBridge, ipcRenderer } from 'electron';
const subscribe = (channel: string, callback: (data: unknown) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('alice', {
  ready: (kind: 'pet' | 'chat') => ipcRenderer.send(kind === 'pet' ? 'renderer-ready' : 'chat-ready'),
  onPlay: (callback: (data: unknown) => void) => subscribe('play', callback),
  onReclaim: (callback: () => void) => subscribe("reclaim", callback),
  onReclaimDone: (callback: () => void) => subscribe("reclaim-done", callback),
  reclaimed: () => ipcRenderer.send("reclaimed"),
  onProbe: (callback: (data: unknown) => void) => subscribe("probe", callback),
  probed: (day: string, clips: Record<string, string>) => ipcRenderer.send("probed", day, clips),
  onSuspend: (callback: (data: unknown) => void) => subscribe('suspend-playback', callback),
  suspended: () => ipcRenderer.send('playback-suspended'),
  onBubble: (callback: (data: unknown) => void) => subscribe('bubble', callback),
  onPose: (callback: (data: unknown) => void) => subscribe('pose', callback),
  onChat: (callback: (data: unknown) => void) => subscribe('chat-state', callback),
  hit: (value: boolean) => ipcRenderer.send('hit', value),
  pointer: (kind: string) => ipcRenderer.send('pet-pointer', kind),
  ended: (token: number) => ipcRenderer.send('ended', token),
  videoReady: (token: number, started: boolean) => ipcRenderer.send('video-ready', token, started),
  videoError: (text: string, token?: number) => ipcRenderer.send('video-error', text, token),
  frames: (count: number) => ipcRenderer.send('frame', count),
  closeChat: () => ipcRenderer.send('chat-close'),
  send: (text: string) => ipcRenderer.invoke('chat-send', text)
});
