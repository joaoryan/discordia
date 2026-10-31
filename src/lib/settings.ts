// Perfil e preferências ficam só neste navegador.
import type { Profile } from './protocol';
import type { ThemeId } from './theme';

const KEYS = { profile: 'discordia.profile', settings: 'discordia.settings', client: 'discordia.client', recent: 'discordia.recent' };

/** Ajustes que valem só para quem os fez; ninguém mais fica sabendo. */
export interface UserAudio {
  volume: number;
  screenVolume: number;
  muted: boolean;
  hideVideo: boolean;
}

export const defaultUserAudio: UserAudio = { volume: 1, screenVolume: 1, muted: false, hideVideo: false };

export interface Settings {
  micId: string;
  camId: string;
  speakerId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  sensitivity: number;
  sounds: boolean;
  notifications: boolean;
  pushToTalk: boolean;
  pushToTalkKey: string;
  userAudio: Record<string, Partial<UserAudio>>; // por nome: o id muda a cada conexão
  radioVolume: number;
  radioMuted: boolean;
  lite: boolean;
  gameMode: boolean;
  theme: ThemeId;
  metrics: boolean;
}

export const defaultSettings: Settings = {
  micId: '',
  camId: '',
  speakerId: '',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sensitivity: 0.02,
  sounds: true,
  notifications: false,
  pushToTalk: false,
  pushToTalkKey: 'KeyV',
  userAudio: {},
  radioVolume: 0.5,
  radioMuted: false,
  lite: false,
  gameMode: false,
  theme: 'discordia',
  metrics: false,
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Navegação privada ou cota cheia: o app segue funcionando sem persistir.
  }
}

export const loadProfile = () => read<Profile>(KEYS.profile);
export const saveProfile = (profile: Profile) => write(KEYS.profile, profile);
export const loadSettings = (): Settings => ({ ...defaultSettings, ...read<Partial<Settings>>(KEYS.settings) });
export const saveSettings = (settings: Settings) => write(KEYS.settings, settings);

export function clientId() {
  let id = read<string>(KEYS.client);
  if (!id) {
    id = crypto.randomUUID();
    write(KEYS.client, id);
  }
  return id;
}

export interface RecentRoom {
  code: string;
  name: string;
  at: number;
}

export const loadRecent = () => read<RecentRoom[]>(KEYS.recent) ?? [];

export function rememberRoom(code: string, name: string) {
  write(KEYS.recent, [{ code, name, at: Date.now() }, ...loadRecent().filter((r) => r.code !== code)].slice(0, 5));
}
