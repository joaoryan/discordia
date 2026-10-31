// Contrato entre participantes e host. Tudo que vem da rede é tratado como não confiável.

export const LIMITS = {
  members: 20,
  voice: 10,
  screenViewers: 5,
  text: 2000,
  name: 32,
  file: 2 * 1024 * 1024,
  avatar: 48 * 1024,
  historyPerChannel: 300,
  attachmentBudget: 32 * 1024 * 1024,
} as const;

export type ChannelKind = 'text' | 'voice';

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  data: string | null; // null quando expirou do histórico
}

export interface Message {
  id: string;
  channel: string;
  author: string;
  authorName: string;
  authorAvatar: string;
  authorColor: string;
  text: string;
  ts: number;
  replyTo?: string;
  attachment?: Attachment;
  reactions: Record<string, string[]>;
  system?: boolean;
  edited?: boolean;
}

export interface VoiceState {
  channel: string | null;
  muted: boolean;
  deafened: boolean;
  camera: string | null; // id do MediaStream, usado para classificar a trilha recebida
  screen: string | null;
  screenAudio: boolean; // a transmissão veio com som
  radio: string | null; // stream de áudio de aba, quando esta pessoa é a DJ
}

export interface Profile {
  name: string;
  avatar: string;
  color: string;
}

export interface Member extends Profile {
  id: string;
  isHost: boolean;
  voice: VoiceState;
  speaking: boolean;
}

export type RadioMode = 'youtube' | 'tab';

export interface Track {
  id: string;
  videoId: string | null;
  title: string;
  addedBy: string;
  votes: string[];
}

export interface RadioState {
  channel: string;
  mode: RadioMode;
  dj: string;
  current: Track | null;
  queue: Track[];
  position: number; // segundos no momento em que o host enviou
  paused: boolean;
  shuffle: boolean;
  skipVotes: string[];
  needed: number;
}

export type RadioCmd =
  | { cmd: 'start'; mode: RadioMode; title?: string }
  | { cmd: 'add'; tracks: { videoId: string; title: string }[] }
  | { cmd: 'remove' | 'vote' | 'ended'; id: string }
  | { cmd: 'skip' | 'force-skip' | 'shuffle' | 'stop' }
  | { cmd: 'pause'; paused: boolean }
  | { cmd: 'title'; title: string };

export type ModAction =
  | { action: 'kick' | 'ban' | 'mute' | 'disconnect'; id: string }
  | { action: 'lock'; locked: boolean }
  | { action: 'add-channel'; kind: ChannelKind; name: string }
  | { action: 'remove-channel'; id: string };

export type ClientMsg =
  | { t: 'hello'; profile: Profile; clientId: string }
  | { t: 'chat'; channel: string; text: string; replyTo?: string; attachment?: Attachment }
  | { t: 'edit'; channel: string; message: string; text: string }
  | { t: 'delete'; channel: string; message: string }
  | { t: 'react'; channel: string; message: string; emoji: string }
  | { t: 'typing'; channel: string }
  | { t: 'voice'; state: VoiceState }
  | { t: 'speaking'; on: boolean }
  | { t: 'radio'; radio: RadioCmd }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'mod'; mod: ModAction };

export interface RoomSnapshot {
  code: string;
  name: string;
  channels: Channel[];
  members: Member[];
  history: Message[];
  locked: boolean;
  radio: RadioState | null;
}

export type HostMsg =
  | { t: 'welcome'; you: string; room: RoomSnapshot }
  | { t: 'refused'; reason: string }
  | { t: 'member-join'; member: Member }
  | { t: 'member-leave'; id: string }
  | { t: 'member-update'; member: Member }
  | { t: 'speaking'; id: string; on: boolean }
  | { t: 'chat'; message: Message }
  | { t: 'message-edit'; channel: string; message: string; text: string }
  | { t: 'message-delete'; channel: string; message: string }
  | { t: 'reaction'; channel: string; message: string; emoji: string; users: string[] }
  | { t: 'typing'; channel: string; id: string }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'channels'; channels: Channel[] }
  | { t: 'locked'; locked: boolean }
  | { t: 'radio'; radio: RadioState | null }
  | { t: 'force-mute' }
  | { t: 'notice'; text: string }
  | { t: 'host-reload' }
  | { t: 'kicked'; banned: boolean }
  | { t: 'closed' };

export const emptyVoice = (): VoiceState => ({
  channel: null,
  muted: false,
  deafened: false,
  camera: null,
  screen: null,
  screenAudio: false,
  radio: null,
});
