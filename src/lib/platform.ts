// Ponte com o app de computador (Electron). No navegador `desktop` é undefined e tudo segue igual;
// cada recurso só aparece quando o app o oferece. A outra metade fica em desktop/src/preload.ts.

/** Atalhos globais que o app registra no sistema, funcionando com qualquer programa em foco. */
export type DesktopShortcut = 'mute' | 'deafen' | 'radio-pause' | 'radio-next' | 'radio-up' | 'radio-down';

/** Ações da mini janela e do ícone na bandeja. */
export type CallAction = 'mute' | 'deafen' | 'leave' | 'open';

/** O que a mini janela e a bandeja mostram da chamada. */
export interface CallSnapshot {
  channel: string;
  muted: boolean;
  deafened: boolean;
  people: { name: string; color: string; speaking: boolean; self: boolean }[];
}

/** Tela ou janela que o app oferece para compartilhar. */
export interface ScreenSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
}

export interface DesktopBridge {
  version: string;
  platform: 'win32' | 'darwin' | 'linux';
  /** Tecla de "apertar para falar" (`KeyboardEvent.code`), ouvida no sistema todo; null desliga. */
  setPushToTalk(code: string | null): void;
  onPushToTalk(listener: (held: boolean) => void): () => void;
  onShortcut(listener: (shortcut: DesktopShortcut) => void): () => void;
  getAutoStart(): Promise<boolean>;
  setAutoStart(on: boolean): Promise<void>;
  setMiniWindow(on: boolean): void;
  updateCall(call: CallSnapshot | null): void;
  onCallAction(listener: (action: CallAction) => void): () => void;
  /** Link `discordia://AB7-K2Q` aberto no sistema. */
  onJoin(listener: (code: string) => void): () => void;
  /** Captura de tela leva junto o áudio do sistema (só no Windows). */
  systemAudio: boolean;
  /** O app pede para a página escolher o que compartilhar; a resposta vai por `pickSource`. */
  onPickSource(listener: (sources: ScreenSource[]) => void): () => void;
  pickSource(id: string | null): void;
}

export const desktop: DesktopBridge | undefined = (globalThis as { desktop?: DesktopBridge }).desktop;
