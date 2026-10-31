// Autoridade da sala. Roda no navegador do host e não conhece WebRTC:
// recebe mensagens e devolve mensagens, o que permite testá-la sem rede.
import {
  LIMITS,
  emptyVoice,
  type Attachment,
  type Channel,
  type ClientMsg,
  type HostMsg,
  type Member,
  type Message,
  type ModAction,
  type Profile,
  type RadioCmd,
  type RadioState,
  type Track,
  type VoiceState,
} from './protocol';

const CHAT_BURST = 10;
const CHAT_REFILL_MS = 1000;
const IMAGE_AVATAR = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_CHANNELS = 24;
const MAX_QUEUE = 200;
const VIDEO_ID = /^[\w-]{11}$/;

interface Conn {
  clientId: string;
  tokens: number;
  lastRefill: number;
}

/** O que precisa sobreviver ao F5 do host. Membros voltam sozinhos, reconectando. */
export interface HostSnapshot {
  channels: Channel[];
  history: Message[];
  locked: boolean;
  banned: string[];
  known: string[];
  radio: RoomHost['radio'];
  radioStart: number;
  radioPausedAt: number;
}

const RESUME_GRACE_MS = 30_000;

export interface HostOptions {
  code: string;
  name: string;
  hostId: string;
  send: (to: string, msg: HostMsg) => void;
  drop: (id: string) => void;
  now?: () => number;
  saved?: HostSnapshot;
}

const uid = () => crypto.randomUUID().slice(0, 12);

export function cleanProfile(input: Partial<Profile> | undefined): Profile {
  const name = String(input?.name ?? '').trim().slice(0, LIMITS.name) || 'Anônimo';
  const avatar = String(input?.avatar ?? '');
  const color = String(input?.color ?? '');
  return {
    name,
    avatar: avatar.length <= LIMITS.avatar && IMAGE_AVATAR.test(avatar) ? avatar : '',
    color: HEX_COLOR.test(color) ? color : '#e8a33d',
  };
}

function cleanAttachment(input: Attachment | undefined): Attachment | undefined {
  if (!input || typeof input.data !== 'string') return undefined;
  if (!input.data.startsWith('data:') || input.data.length > LIMITS.file * 1.4) return undefined;
  // O tipo vem do remetente: SVG e HTML nunca são tratados como mídia exibível.
  const type = String(input.type ?? '').slice(0, 80);
  const safeType = /^image\/(png|jpeg|gif|webp)$/.test(type) ? type : 'application/octet-stream';
  return {
    name: String(input.name ?? 'arquivo').slice(0, 120),
    type: safeType,
    size: Math.min(Number(input.size) || 0, LIMITS.file),
    data: input.data.replace(/^data:[^;,]*/, `data:${safeType}`),
  };
}

export class RoomHost {
  channels: Channel[] = [
    { id: 'geral', name: 'geral', kind: 'text' },
    { id: 'off-topic', name: 'off-topic', kind: 'text' },
    { id: 'saguao', name: 'Saguão', kind: 'voice' },
    { id: 'jogos', name: 'Jogos', kind: 'voice' },
  ];
  members = new Map<string, Member>();
  history = new Map<string, Message[]>();
  locked = false;
  radio: Omit<RadioState, 'position' | 'needed'> | null = null;

  private radioStart = 0; // relógio do host em que a faixa atual "começou"
  private radioPausedAt = 0;
  private conns = new Map<string, Conn>();
  private banned = new Set<string>();
  private known = new Set<string>(); // clientes já aceitos: voltam mesmo com a sala trancada
  private graceUntil = 0; // enquanto os membros voltam, ninguém conta como ausente
  private now: () => number;

  constructor(private opts: HostOptions) {
    this.now = opts.now ?? Date.now;
    const saved = opts.saved;
    if (!saved) return;
    this.channels = saved.channels;
    for (const message of saved.history) {
      this.history.set(message.channel, [...(this.history.get(message.channel) ?? []), message]);
    }
    this.locked = saved.locked;
    this.banned = new Set(saved.banned);
    this.known = new Set(saved.known);
    this.radio = saved.radio;
    this.radioStart = saved.radioStart;
    this.radioPausedAt = saved.radioPausedAt;
    this.graceUntil = this.now() + RESUME_GRACE_MS;
  }

  snapshot(): HostSnapshot {
    return structuredClone({
      channels: this.channels,
      history: [...this.history.values()].flat(),
      locked: this.locked,
      banned: [...this.banned],
      known: [...this.known],
      radio: this.radio,
      radioStart: this.radioStart,
      radioPausedAt: this.radioPausedAt,
    });
  }

  /** Mesma conexão de sempre ou id recém-chegado? Um id só volta com o cliente dono dele. */
  ownsId(id: string, clientId: string) {
    const conn = this.conns.get(id);
    return !conn || conn.clientId === clientId;
  }

  /** Fim da carência: quem não voltou agora conta como ausente. */
  endGrace() {
    this.graceUntil = 0;
    this.reviewRadio();
  }

  private broadcast(msg: HostMsg, except?: string) {
    for (const id of this.members.keys()) if (id !== except) this.opts.send(id, msg);
  }

  private publicMembers() {
    return [...this.members.values()];
  }

  admit(id: string, profile: Profile, clientId: string) {
    const isHost = id === this.opts.hostId;
    const refuse = (reason: string) => {
      this.opts.send(id, { t: 'refused', reason });
      this.opts.drop(id);
    };
    if (!isHost) {
      if (this.banned.has(clientId)) return refuse('Você foi banido desta sala.');
      if (this.locked && !this.known.has(clientId)) return refuse('O host trancou esta sala.');
      if (this.members.size >= LIMITS.members) return refuse('A sala está cheia.');
    }

    // Mesma pessoa reconectando: a conexão antiga já não serve.
    for (const [other, conn] of this.conns) {
      if (conn.clientId === clientId && other !== id) {
        this.opts.drop(other);
        this.remove(other);
      }
    }

    const returning = this.members.has(id) || this.known.has(clientId);
    this.known.add(clientId);
    const member: Member = {
      ...cleanProfile(profile),
      id,
      isHost,
      voice: emptyVoice(),
      speaking: false,
    };
    this.members.set(id, member);
    this.conns.set(id, { clientId, tokens: CHAT_BURST, lastRefill: this.now() });

    this.opts.send(id, {
      t: 'welcome',
      you: id,
      room: {
        code: this.opts.code,
        name: this.opts.name,
        channels: this.channels,
        members: this.publicMembers(),
        history: [...this.history.values()].flat(),
        locked: this.locked,
        radio: this.radioView(),
      },
    });
    this.broadcast({ t: 'member-join', member }, id);
    if (!isHost && !returning) this.post(this.channels.find((c) => c.kind === 'text')?.id, `${member.name} entrou na sala.`);
  }

  remove(id: string) {
    const member = this.members.get(id);
    if (!member) return;
    this.members.delete(id);
    this.conns.delete(id);
    this.broadcast({ t: 'member-leave', id });
    this.reviewRadio();
    this.post(this.channels.find((c) => c.kind === 'text')?.id, `${member.name} saiu da sala.`);
  }

  close() {
    this.broadcast({ t: 'closed' });
  }

  private post(channel: string | undefined, text: string) {
    if (!channel) return;
    this.store({
      id: uid(),
      channel,
      author: '',
      authorName: '',
      authorAvatar: '',
      authorColor: '',
      text,
      ts: this.now(),
      reactions: {},
      system: true,
    });
  }

  private store(message: Message) {
    const list = this.history.get(message.channel) ?? [];
    list.push(message);
    if (list.length > LIMITS.historyPerChannel) list.shift();
    this.history.set(message.channel, list);
    if (message.attachment) this.trimAttachments();
    this.broadcast({ t: 'chat', message });
  }

  // O histórico vive na RAM do host, então os arquivos mais antigos expiram primeiro.
  private trimAttachments() {
    const stored = [...this.history.values()]
      .flat()
      .filter((m) => m.attachment?.data)
      .sort((a, b) => a.ts - b.ts);
    let total = stored.reduce((sum, m) => sum + m.attachment!.data!.length, 0);
    for (const message of stored) {
      if (total <= LIMITS.attachmentBudget) break;
      total -= message.attachment!.data!.length;
      message.attachment!.data = null;
    }
  }

  private allowChat(id: string) {
    const conn = this.conns.get(id);
    if (!conn) return false;
    const now = this.now();
    const refill = Math.floor((now - conn.lastRefill) / CHAT_REFILL_MS);
    if (refill > 0) {
      conn.tokens = Math.min(CHAT_BURST, conn.tokens + refill);
      conn.lastRefill = now;
    }
    if (conn.tokens <= 0) return false;
    conn.tokens--;
    return true;
  }

  handle(from: string, msg: ClientMsg) {
    const member = this.members.get(from);
    if (!member) return;
    switch (msg.t) {
      case 'chat':
        return this.onChat(member, msg);
      case 'edit': {
        const target = this.history.get(msg.channel)?.find((m) => m.id === msg.message);
        const text = String(msg.text ?? '').trim().slice(0, LIMITS.text);
        if (!target || target.author !== from || !text) return;
        target.text = text;
        target.edited = true;
        return this.broadcast({ t: 'message-edit', channel: msg.channel, message: target.id, text });
      }
      case 'delete': {
        const list = this.history.get(msg.channel);
        const target = list?.find((m) => m.id === msg.message);
        if (!list || !target || target.system || !(target.author === from || member.isHost)) return;
        list.splice(list.indexOf(target), 1);
        return this.broadcast({ t: 'message-delete', channel: msg.channel, message: target.id });
      }
      case 'react':
        return this.onReact(member, msg);
      case 'typing':
        return this.broadcast({ t: 'typing', channel: String(msg.channel), id: from }, from);
      case 'voice':
        return this.onVoice(member, msg.state);
      case 'speaking':
        member.speaking = Boolean(msg.on);
        return this.broadcast({ t: 'speaking', id: from, on: member.speaking }, from);
      case 'radio':
        return this.onRadio(member, msg.radio);
      case 'rtc': {
        // Sinalização da malha só entre quem está no mesmo canal de voz: expulso não reconecta.
        const target = this.members.get(msg.to);
        if (target && member.voice.channel && target.voice.channel === member.voice.channel) {
          this.opts.send(msg.to, { t: 'rtc', from, data: msg.data });
        }
        return;
      }
      case 'mod':
        if (from === this.opts.hostId) this.onMod(msg.mod);
        return;
    }
  }

  private onChat(member: Member, msg: Extract<ClientMsg, { t: 'chat' }>) {
    const channel = this.channels.find((c) => c.id === msg.channel && c.kind === 'text');
    if (!channel) return;
    const text = String(msg.text ?? '').trim().slice(0, LIMITS.text);
    const attachment = cleanAttachment(msg.attachment);
    if (!text && !attachment) return;
    if (!this.allowChat(member.id)) {
      this.opts.send(member.id, { t: 'notice', text: 'Devagar: você está enviando mensagens rápido demais.' });
      return;
    }
    const replyTo = this.history.get(channel.id)?.some((m) => m.id === msg.replyTo) ? msg.replyTo : undefined;
    this.store({
      id: uid(),
      channel: channel.id,
      author: member.id,
      authorName: member.name,
      authorAvatar: member.avatar,
      authorColor: member.color,
      text,
      ts: this.now(),
      reactions: {},
      replyTo,
      attachment,
    });
  }

  private onReact(member: Member, msg: Extract<ClientMsg, { t: 'react' }>) {
    const emoji = String(msg.emoji ?? '');
    if (!emoji || emoji.length > 8) return;
    const message = this.history.get(msg.channel)?.find((m) => m.id === msg.message);
    if (!message || message.system) return;
    const users = message.reactions[emoji] ?? [];
    message.reactions[emoji] = users.includes(member.id)
      ? users.filter((id) => id !== member.id)
      : [...users, member.id];
    if (message.reactions[emoji].length === 0) delete message.reactions[emoji];
    this.broadcast({
      t: 'reaction',
      channel: message.channel,
      message: message.id,
      emoji,
      users: message.reactions[emoji] ?? [],
    });
  }

  private onVoice(member: Member, state: VoiceState) {
    const channel = this.channels.find((c) => c.id === state?.channel && c.kind === 'voice');
    if (state?.channel && !channel) return;
    if (channel && member.voice.channel !== channel.id) {
      const inside = this.publicMembers().filter((m) => m.voice.channel === channel.id).length;
      if (inside >= LIMITS.voice) {
        this.opts.send(member.id, { t: 'notice', text: `O canal ${channel.name} está cheio.` });
        // Devolve o estado real para o cliente desligar o microfone que já abriu.
        this.opts.send(member.id, { t: 'member-update', member });
        return;
      }
    }
    member.voice = {
      channel: channel?.id ?? null,
      muted: Boolean(state?.muted),
      deafened: Boolean(state?.deafened),
      camera: typeof state?.camera === 'string' ? state.camera.slice(0, 64) : null,
      screen: typeof state?.screen === 'string' ? state.screen.slice(0, 64) : null,
      screenAudio: Boolean(state?.screenAudio),
      radio: typeof state?.radio === 'string' ? state.radio.slice(0, 64) : null,
    };
    if (!channel) member.speaking = false;
    this.broadcast({ t: 'member-update', member });
    this.reviewRadio();
  }

  // --- Rádio: a sala guarda só fila e posição; o áudio nunca passa pelo host. ---

  private inRadio() {
    return this.publicMembers().filter((m) => m.voice.channel === this.radio?.channel);
  }

  radioView(): RadioState | null {
    if (!this.radio) return null;
    const position = this.radio.paused ? this.radioPausedAt : (this.now() - this.radioStart) / 1000;
    return { ...this.radio, position, needed: Math.floor(this.inRadio().length / 2) + 1 };
  }

  private publishRadio() {
    this.broadcast({ t: 'radio', radio: this.radioView() });
  }

  private nextTrack() {
    const radio = this.radio!;
    if (radio.mode === 'tab') return;
    const { queue } = radio;
    let index = -1;
    if (queue.length) {
      // Mais votada primeiro; empate fica com quem chegou antes.
      const top = Math.max(...queue.map((t) => t.votes.length));
      const tied = queue.flatMap((t, i) => (t.votes.length === top ? [i] : []));
      index = radio.shuffle ? tied[Math.floor(Math.random() * tied.length)] : tied[0];
    }
    radio.current = index >= 0 ? queue.splice(index, 1)[0] : null;
    radio.skipVotes = [];
    radio.paused = false;
    this.radioStart = this.now();
  }

  /** Reavalia DJ, votos e fim do rádio quando alguém entra ou sai do canal. */
  private reviewRadio() {
    const radio = this.radio;
    if (!radio || this.now() < this.graceUntil) return;
    const inside = this.inRadio();
    const djHere = inside.some((m) => m.id === radio.dj);
    if (!inside.length || (radio.mode === 'tab' && !djHere)) {
      this.radio = null;
      return this.publishRadio();
    }
    if (!djHere) radio.dj = (inside.find((m) => m.isHost) ?? inside[0]).id;
    radio.skipVotes = radio.skipVotes.filter((id) => inside.some((m) => m.id === id));
    if (radio.skipVotes.length >= Math.floor(inside.length / 2) + 1) this.nextTrack();
    this.publishRadio();
  }

  private onRadio(member: Member, cmd: RadioCmd) {
    if (cmd?.cmd === 'start') return this.startRadio(member, cmd);
    const radio = this.radio;
    if (!radio || member.voice.channel !== radio.channel) return;
    const inCharge = member.id === radio.dj || member.isHost;

    switch (cmd?.cmd) {
      case 'add': {
        if (radio.mode !== 'youtube' || !Array.isArray(cmd.tracks)) return;
        for (const track of cmd.tracks) {
          if (radio.queue.length >= MAX_QUEUE) break;
          if (!VIDEO_ID.test(String(track?.videoId))) continue;
          radio.queue.push({
            id: uid(),
            videoId: track.videoId,
            title: String(track.title ?? '').trim().slice(0, 120) || 'Música do YouTube',
            addedBy: member.name,
            votes: [],
          });
        }
        if (!radio.current) this.nextTrack();
        break;
      }
      case 'vote': {
        const track = radio.queue.find((t) => t.id === cmd.id);
        if (!track) return;
        track.votes = track.votes.includes(member.id)
          ? track.votes.filter((id) => id !== member.id)
          : [...track.votes, member.id];
        break;
      }
      case 'remove': {
        const track = radio.queue.find((t) => t.id === cmd.id);
        if (!track || !(inCharge || track.addedBy === member.name)) return;
        radio.queue = radio.queue.filter((t) => t !== track);
        break;
      }
      case 'skip':
        if (!radio.current) return;
        radio.skipVotes = radio.skipVotes.includes(member.id)
          ? radio.skipVotes.filter((id) => id !== member.id)
          : [...radio.skipVotes, member.id];
        if (radio.skipVotes.length >= Math.floor(this.inRadio().length / 2) + 1) this.nextTrack();
        break;
      case 'ended':
        // Vários clientes avisam a mesma faixa; só o primeiro aviso avança.
        if (radio.current?.id !== cmd.id) return;
        this.nextTrack();
        break;
      case 'force-skip':
        if (!inCharge) return;
        this.nextTrack();
        break;
      case 'pause': {
        if (!inCharge || radio.paused === Boolean(cmd.paused)) return;
        if (cmd.paused) this.radioPausedAt = (this.now() - this.radioStart) / 1000;
        else this.radioStart = this.now() - this.radioPausedAt * 1000;
        radio.paused = Boolean(cmd.paused);
        break;
      }
      case 'shuffle':
        if (!inCharge) return;
        radio.shuffle = !radio.shuffle;
        break;
      case 'title':
        if (!inCharge || radio.mode !== 'tab' || !radio.current) return;
        radio.current.title = String(cmd.title ?? '').trim().slice(0, 120) || 'Rádio ao vivo';
        break;
      case 'stop':
        if (!inCharge) return;
        this.radio = null;
        break;
      default:
        return;
    }
    this.publishRadio();
  }

  private startRadio(member: Member, cmd: Extract<RadioCmd, { cmd: 'start' }>) {
    const channel = member.voice.channel;
    if (!channel) return;
    if (this.radio) {
      this.opts.send(member.id, { t: 'notice', text: 'Já existe um rádio tocando nesta sala.' });
      return;
    }
    const mode = cmd.mode === 'tab' ? 'tab' : 'youtube';
    this.radio = {
      channel,
      mode,
      dj: member.id,
      current:
        mode === 'tab'
          ? { id: uid(), videoId: null, title: String(cmd.title ?? '').trim().slice(0, 120) || 'Rádio ao vivo', addedBy: member.name, votes: [] as Track['votes'] }
          : null,
      queue: [],
      paused: false,
      shuffle: false,
      skipVotes: [],
    };
    this.radioStart = this.now();
    this.publishRadio();
  }

  private onMod(mod: ModAction) {
    switch (mod.action) {
      case 'kick':
      case 'ban': {
        if (mod.id === this.opts.hostId || !this.members.has(mod.id)) return;
        const banned = mod.action === 'ban';
        const { clientId } = this.conns.get(mod.id)!;
        this.known.delete(clientId); // expulso volta como qualquer visitante
        if (banned) this.banned.add(clientId);
        this.opts.send(mod.id, { t: 'kicked', banned });
        this.opts.drop(mod.id);
        this.remove(mod.id);
        return;
      }
      case 'mute':
        if (this.members.has(mod.id)) this.opts.send(mod.id, { t: 'force-mute' });
        return;
      case 'disconnect': {
        const member = this.members.get(mod.id);
        if (!member?.voice.channel) return;
        member.voice = emptyVoice();
        member.speaking = false;
        this.opts.send(mod.id, { t: 'notice', text: 'O host desconectou você da voz.' });
        this.broadcast({ t: 'member-update', member });
        return this.reviewRadio();
      }
      case 'lock':
        this.locked = Boolean(mod.locked);
        return this.broadcast({ t: 'locked', locked: this.locked });
      case 'add-channel': {
        const name = this.channelName(mod.name, mod.kind);
        if (!name || this.channels.length >= MAX_CHANNELS) return;
        this.channels = [...this.channels, { id: uid(), name, kind: mod.kind === 'voice' ? 'voice' : 'text' }];
        return this.broadcast({ t: 'channels', channels: this.channels });
      }
      case 'remove-channel': {
        const channel = this.channels.find((c) => c.id === mod.id);
        if (!channel) return;
        if (this.channels.filter((c) => c.kind === channel.kind).length <= 1) return;
        this.channels = this.channels.filter((c) => c.id !== mod.id);
        this.history.delete(mod.id);
        for (const member of this.members.values()) {
          if (member.voice.channel === mod.id) {
            member.voice = emptyVoice();
            member.speaking = false;
            this.broadcast({ t: 'member-update', member });
          }
        }
        this.broadcast({ t: 'channels', channels: this.channels });
        return this.reviewRadio();
      }
    }
  }

  private channelName(input: string, kind: string) {
    const name = String(input ?? '').trim().slice(0, 32);
    return kind === 'voice' ? name : name.toLowerCase().replace(/\s+/g, '-');
  }
}
