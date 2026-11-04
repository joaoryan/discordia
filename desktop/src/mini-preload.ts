// Ponte da mini janela: recebe o estado da chamada e devolve cliques e o tamanho do conteúdo.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mini', {
  onCall: (listener: (call: unknown) => void) => ipcRenderer.on('call', (_e, call) => listener(call)),
  action: (action: 'mute' | 'deafen' | 'leave' | 'open') => ipcRenderer.send('mini-action', action),
  resize: (width: number, height: number) => ipcRenderer.send('mini-size', { width, height }),
});
