// Perfil e preferências ficam só neste navegador.
import type { Profile } from './protocol';
import type { SoundId } from './sounds';

const KEYS = { profile: 'discordia.profile', settings: 'discordia.settings', client: 'discordia.client', recent: 'discordia.recent', tab: 'discordia.tab' };

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
  /** Supressão de ruído por IA (RNNoise): deixa passar só a voz. */
  voiceIsolation: boolean;
  /** Corta o envio enquanto a pessoa não fala, usando `sensitivity` como limite. */
  noiseGate: boolean;
  micVolume: number;
  sensitivity: number;
  sounds: boolean;
  soundVolume: number;
  /** Sons que a pessoa desligou um a um. */
  mutedSounds: SoundId[];
  notifications: boolean;
  pushToTalk: boolean;
  pushToTalkKey: string;
  userAudio: Record<string, Partial<UserAudio>>; // por nome: o id muda a cada conexão
  radioVolume: number;
  radioMuted: boolean;
  lite: boolean;
  gameMode: boolean;
  metrics: boolean;
  /** App de computador: mini janela por cima dos outros programas durante a chamada. */
  miniWindow: boolean;
  /** Repassar a voz entre duas pessoas do canal que não se alcançam (docs/REPETIDOR.md). */
  helpRelay: boolean;
}

export const defaultSettings: Settings = {
  micId: '',
  camId: '',
  speakerId: '',
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: true,
  noiseGate: true,
  micVolume: 0.5,
  sensitivity: 0.026,
  sounds: true,
  soundVolume: 0.8,
  mutedSounds: [],
  notifications: false,
  pushToTalk: false,
  pushToTalkKey: 'KeyV',
  userAudio: {},
  radioVolume: 0.5,
  radioMuted: false,
  lite: false,
  gameMode: false,
  metrics: false,
  miniWindow: true,
  helpRelay: true,
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
/** Sobe quando um padrão novo precisa valer também para quem já tinha ajustes salvos. */
const SETTINGS_VERSION = 1;

type StoredSettings = Partial<Settings> & { version?: number };

export function loadSettings(): Settings {
  const stored = read<StoredSettings>(KEYS.settings);
  if (!stored) return { ...defaultSettings };
  const { version = 0, ...saved } = stored;
  // v1: volume do microfone 50% e sensibilidade 0.026 (os antigos 100% e 0.02 deixavam a voz alta demais).
  if (version < 1) {
    saved.micVolume = defaultSettings.micVolume;
    saved.sensitivity = defaultSettings.sensitivity;
  }
  const settings = { ...defaultSettings, ...saved };
  if (version < SETTINGS_VERSION) saveSettings(settings);
  return settings;
}
export const saveSettings = (settings: Settings) => write(KEYS.settings, { ...settings, version: SETTINGS_VERSION });

export function clientId() {
  let id = read<string>(KEYS.client);
  if (!id) {
    id = crypto.randomUUID();
    write(KEYS.client, id);
  }
  return id;
}

/** Cada aba é uma pessoa na sala; sessionStorage sobrevive ao F5, mas não é dividido entre abas. */
export function tabId() {
  try {
    let id = sessionStorage.getItem(KEYS.tab);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(KEYS.tab, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export interface RecentRoom {
  code: string;
  name: string;
  at: number;
  /** Chave de dono, só nas salas que este navegador criou: deixa reabrir com o mesmo código. */
  key?: string;
}

export const loadRecent = () => read<RecentRoom[]>(KEYS.recent) ?? [];

export function rememberRoom(code: string, name: string, key?: string) {
  const list = loadRecent();
  // Entrar de novo (até como host, pelo welcome) não pode apagar a chave guardada na criação.
  const owned = key ?? list.find((r) => r.code === code)?.key;
  const entry: RecentRoom = { code, name, at: Date.now(), ...(owned ? { key: owned } : {}) };
  write(KEYS.recent, [entry, ...list.filter((r) => r.code !== code)].slice(0, 5));
}
