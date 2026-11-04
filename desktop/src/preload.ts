// Ponte entre a página e o processo principal. A página só vê `window.desktop`, nunca o Node
// nem o ipcRenderer. O tipo do lado da página fica em src/lib/platform.ts.
import { contextBridge, ipcRenderer } from 'electron';

type Listener<T> = (value: T) => void;

function on<T>(channel: string, listener: Listener<T>) {
  const handler = (_e: unknown, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const info = ipcRenderer.sendSync('info') as { version: string; platform: string; systemAudio: boolean } | null;
let pickId = 0;

if (info) {
  contextBridge.exposeInMainWorld('desktop', {
    version: info.version,
    platform: info.platform,
    systemAudio: info.systemAudio,
    setPushToTalk: (code: string | null) => ipcRenderer.send('ptt-key', code),
    onPushToTalk: (listener: Listener<boolean>) => on('ptt', listener),
    onShortcut: (listener: Listener<string>) => on('shortcut', listener),
    getAutoStart: () => ipcRenderer.invoke('autostart:get') as Promise<boolean>,
    setAutoStart: (enabled: boolean) => ipcRenderer.invoke('autostart:set', enabled) as Promise<void>,
    setMiniWindow: (enabled: boolean) => ipcRenderer.send('mini', enabled),
    updateCall: (call: unknown) => ipcRenderer.send('call', call),
    onCallAction: (listener: Listener<string>) => on('call-action', listener),
    onJoin: (listener: Listener<string>) => on('join', listener),
    onPickSource: (listener: Listener<unknown[]>) =>
      on<{ id: number; sources: unknown[] }>('pick-source', (request) => {
        pickId = request.id;
        listener(request.sources);
      }),
    pickSource: (choice: string | null) => ipcRenderer.send('pick-answer', { id: pickId, choice }),
  });
}
