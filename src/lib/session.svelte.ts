// Estado reativo da sala para a interface. O host é um participante comum
// que fala com a própria RoomHost por um atalho local, sem passar pela rede.
import { generateCode } from './code';
import { RoomHost, type HostSnapshot } from './host';
import { Link } from './link';
import { watchPressure, type Pressure } from './metrics';
import { MediaEngine, type ScreenQuality } from './media';
import { LIMITS, emptyVoice, type Attachment, type Channel, type ClientMsg, type HostMsg, type Member, type Message, type ModAction, type Profile, type RadioCmd, type RadioState, type VoiceState } from './protocol';
import { clearRoom, saveRoom, type SavedRoom } from './roomStore';
import { clientId, defaultUserAudio, loadSettings, rememberRoom, saveSettings, type Settings, type UserAudio } from './settings';
import { SIGNAL_ERRORS, SignalClient, fetchIceServers } from './signaling';
import { setSoundOutput, sounds } from './sounds';
import { applyTheme } from './theme';

const CONNECT_TIMEOUT_MS = 20_000;
const RECONNECT_WINDOW_MS = 45_000; // cobre a carência de 30 s do Worker
const RECONNECT_DELAY_MS = 2_000;
const MESH_GRACE_MS = 15_000; // tempo para os outros convidados voltarem à sala
const RESUME_GRACE_MS = 30_000;
const TYPING_MS = 3_000;
const HOST_INBOUND = 4 * 1024 * 1024;
const GUEST_INBOUND = 128 * 1024 * 1024;

export type Phase = 'connecting' | 'open' | 'reconnecting' | 'ended';

export interface Toast {
  id: number;
  text: string;
}

let toastId = 0;

export class RoomSession {
  phase = $state<Phase>('connecting');
  endReason = $state('');
  isHost = $state(false);
  selfId = $state('');
  code = $state('');
  name = $state('');
  locked = $state(false);
  channels = $state<Channel[]>([]);
  members = $state<Member[]>([]);
  messages = $state<Record<string, Message[]>>({});
  active = $state('geral');
  voiceView = $state(false);
  unread = $state<Record<string, number>>({});
  typing = $state<Record<string, Record<string, number>>>({});
  remote = $state.raw<Record<string, MediaStream[]>>({});
  localCamera = $state.raw<MediaStream | null>(null);
  localScreen = $state.raw<MediaStream | null>(null);
  watching = $state<string[]>([]);
  toasts = $state<Toast[]>([]);
  settings = $state<Settings>(loadSettings());
  hasMic = $state(true);
  menu = $state<{ id: string; x: number; y: number } | null>(null);
  radio = $state<RadioState | null>(null);
  radioReceivedAt = $state(0);
  devices = $state.raw<MediaDeviceInfo[]>([]);
  micVersion = $state(0);
  focus = $state<string | null>(null); // quadro em destaque na chamada
  pressure = $state<Pressure | null>(null);
  hostReloading = $state(false);
  audioBlocked = $state(false);
  private meshGraceUntil = 0;
  private hostKey = '';
  private talkHeld = false;
  private joining = false;
  private mutedBeforeDeafen = false;
  private stopPressure = () => {};

  private host: RoomHost | null = null;
  private signal: SignalClient | null = null;
  private links = new Map<string, Link>();
  private pendingLinks = new Map<Link, string>();
  private hubLink: Link | null = null;
  private iceServers: RTCIceServer[] = [];
  private profile: Profile;
  private leaving = false;
  private lastTyping = 0;
  private settle: { resolve: () => void; reject: (reason: string) => void } | null = null;

  media = new MediaEngine(
    {
      signal: (to, data) => this.send({ t: 'rtc', to, data }),
      streams: (peer, streams) => {
        this.remote = { ...this.remote, [peer]: streams };
      },
      speaking: (on) => {
        this.send({ t: 'speaking', on });
        this.patchMember(this.selfId, { speaking: on });
      },
      screenEnded: () => void this.stopScreen(),
      radioEnded: () => this.radioCmd({ cmd: 'stop' }),
      micChanged: () => this.micVersion++,
      watchRefused: (peer) => {
        this.watching = this.watching.filter((id) => id !== peer);
        if (this.focus === `screen:${peer}`) this.focus = null;
        this.toast(`A transmissão já tem ${LIMITS.screenViewers} espectadores.`);
      },
      micLost: () => {
        this.hasMic = false;
        this.toast('Microfone desconectado. Conecte outro e ative o microfone.');
        this.pushVoice({ muted: true });
      },
      cameraLost: () => void this.toggleCamera(),
    },
    () => this.settings,
  );

  constructor(profile: Profile) {
    this.profile = profile;
    navigator.mediaDevices?.addEventListener('devicechange', this.onDeviceChange);
    void this.refreshDevices();
    this.stopPressure = watchPressure((state) => {
      const before = this.lite;
      this.pressure = state;
      if (this.lite && !before) this.toast('Computador sobrecarregado: modo economia ativado.');
    });
  }

  /** Economia manual ou automática, quando o computador está sob pressão. */
  get lite() {
    return this.settings.lite || this.settings.gameMode || this.pressure === 'serious' || this.pressure === 'critical';
  }

  async refreshDevices() {
    this.devices = (await navigator.mediaDevices?.enumerateDevices().catch(() => [])) ?? [];
  }

  private onDeviceChange = async () => {
    await this.refreshDevices();
    const inputs = this.devices.filter((d) => d.kind === 'audioinput');
    const { micId } = this.settings;
    if (!this.media.mic) return;
    // Fone novo virou o padrão do sistema: acompanha, como o Discord faz.
    const wanted = micId ? inputs.find((d) => d.deviceId === micId) : (inputs.find((d) => d.deviceId === 'default') ?? inputs[0]);
    if (!wanted?.groupId || wanted.groupId === this.media.micGroup) return;
    await this.media.switchMic().catch(() => {});
  };

  get me() {
    return this.members.find((m) => m.id === this.selfId);
  }

  get voice(): VoiceState {
    return this.me?.voice ?? emptyVoice();
  }

  // --- Conexão ---

  /** Host: registra o código no Worker e passa a aceitar amigos. */
  async create() {
    this.isHost = true;
    this.iceServers = await fetchIceServers();
    this.media.iceServers = this.iceServers;
    const key = crypto.randomUUID() + crypto.randomUUID();
    this.hostKey = key;
    let code = '';

    for (let attempt = 0; ; attempt++) {
      code = generateCode();
      try {
        await this.connectHostSignal(code, key);
        break;
      } catch (reason) {
        if (reason !== 'taken' || attempt >= 3) return this.end(SIGNAL_ERRORS[String(reason)] ?? 'Erro ao criar a sala.');
      }
    }

    this.code = code;
    this.startHost(code, `Sala de ${this.profile.name}`);
    rememberRoom(code, this.name);
    window.addEventListener('pagehide', this.onPageHide);
  }

  /** Host depois do F5: mesmo código, mesma chave, e os convidados voltam sozinhos. */
  async resume(saved: SavedRoom) {
    this.isHost = true;
    this.iceServers = await fetchIceServers();
    this.media.iceServers = this.iceServers;
    this.hostKey = saved.key;
    this.code = saved.code;
    try {
      await this.connectHostSignal(saved.code, saved.key);
    } catch (reason) {
      clearRoom();
      return this.end(SIGNAL_ERRORS[String(reason)] ?? 'Não foi possível retomar a sala.');
    }
    this.startHost(saved.code, saved.name, saved.host);
    this.active = saved.active;
    window.addEventListener('pagehide', this.onPageHide);
    setTimeout(() => this.host?.endGrace(), RESUME_GRACE_MS);

    if (saved.voice) {
      await this.joinVoice(saved.voice.channel);
      if (saved.voice.deafened) this.toggleDeafen();
      else if (saved.voice.muted) void this.setMuted(true);
    }
  }

  private connectHostSignal(code: string, key: string) {
    const signal = new SignalClient({
      onPeer: (id) => this.acceptGuest(id),
      onPeerLeft: () => {
        // Só importa antes do canal P2P abrir; depois o convidado fecha o socket de propósito.
      },
      onSignal: (from, data) => {
        // Mesmo id pode estar voltando: a sinalização é da tentativa mais nova.
        const link = [...this.pendingLinks].reverse().find(([, id]) => id === from)?.[0] ?? this.links.get(from);
        void link?.signal(data);
      },
      onDown: () => void this.reconnectHostSignal(code, key),
    });
    this.signal = signal;
    return signal.connect(code, 'host', key);
  }

  // Queda do socket de sinalização não afeta quem já está na sala; só impede novas entradas.
  private async reconnectHostSignal(code: string, key: string) {
    for (let i = 0; i < 20 && !this.leaving; i++) {
      await new Promise((r) => setTimeout(r, 3_000));
      try {
        await this.connectHostSignal(code, key);
        return;
      } catch {
        // tenta de novo dentro da carência
      }
    }
    if (!this.leaving) this.toast('Sem conexão com a sinalização: novos amigos não conseguem entrar.');
  }

  private startHost(code: string, name: string, saved?: HostSnapshot) {
    this.selfId = 'host';
    this.media.selfId = 'host';
    this.host = new RoomHost({
      code,
      name,
      hostId: 'host',
      saved,
      send: (to, msg) => {
        // Clona como a rede faria: a interface não pode dividir objetos com a autoridade.
        if (to === 'host') queueMicrotask(() => this.apply(structuredClone(msg)));
        else this.links.get(to)?.send(msg);
      },
      drop: (id) => {
        const link = this.links.get(id);
        this.links.delete(id);
        link?.closeSoon();
      },
    });
    this.host.admit('host', this.profile, clientId());
  }

  private acceptGuest(id: string) {
    const link = new Link(this.iceServers, HOST_INBOUND, {
      signal: (data) => this.signal?.send(id, data),
      open: () => {},
      message: (msg: ClientMsg) => {
        if (msg.t !== 'hello') return this.links.get(id) === link && this.host?.handle(id, msg);
        const client = String(msg.clientId);
        // Reaproveitar um id exige ser o mesmo cliente; senão alguém assumiria o lugar de outro.
        if (this.host && !this.host.ownsId(id, client)) {
          link.send({ t: 'refused', reason: 'Não foi possível entrar na sala.' } satisfies HostMsg);
          return link.closeSoon();
        }
        const old = this.links.get(id);
        this.links.set(id, link);
        if (old !== link) old?.close();
        this.host?.admit(id, msg.profile, client);
      },
      close: () => {
        pending.delete(link);
        if (this.links.get(id) === link) {
          this.links.delete(id);
          this.host?.remove(id);
        }
      },
    });
    const pending = this.pendingLinks;
    pending.set(link, id);
  }

  /** Convidado: resolve quando o host dá as boas-vindas; rejeita com texto para a pessoa. */
  async join(code: string) {
    this.code = code;
    this.iceServers = await fetchIceServers();
    this.media.iceServers = this.iceServers;
    try {
      await this.connectGuest();
    } catch (reason) {
      this.end(String(reason));
    }
  }

  private connectGuest() {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => fail('Não foi possível conectar ao host. A rede de um dos lados pode estar bloqueando a conexão direta.'), CONNECT_TIMEOUT_MS);
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.close();
        // Solta o enlace antes de fechar: senão a falha dispararia outro laço de reconexão.
        if (this.hubLink === link) this.hubLink = null;
        link.close();
        reject(reason);
      };
      this.settle = {
        resolve: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.close(); // daqui em diante nada passa pelo Worker
          resolve();
        },
        reject: fail,
      };

      const signal = new SignalClient({
        onSignal: (_from, data) => void link.signal(data),
        onClosedRoom: () => fail('A sala foi encerrada.'),
      });
      const link: Link = new Link(this.iceServers, GUEST_INBOUND, {
        signal: (data) => signal.send('host', data),
        open: () => link.send({ t: 'hello', profile: this.profile, clientId: clientId() } satisfies ClientMsg),
        message: (msg: HostMsg) => this.apply(msg),
        close: () => {
          if (!settled) fail('A conexão com o host falhou.');
          else if (this.hubLink === link) void this.onHubLost();
        },
      });
      this.hubLink = link;

      signal.connect(this.code, 'guest', '', this.selfId).then(
        () => void link.call(),
        (reason) => fail(SIGNAL_ERRORS[reason] ?? 'Erro ao entrar na sala.'),
      );
    });
  }

  private async onHubLost() {
    if (this.leaving || this.phase === 'ended') return;
    this.phase = 'reconnecting';
    const voice = $state.snapshot(this.voice);
    // Só a ligação com o host caiu: a voz direta com os outros convidados segue de pé.
    this.media.dropPeer('host');
    const deadline = Date.now() + RECONNECT_WINDOW_MS;
    let roomGone = false;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
      if (this.leaving) return;
      try {
        await this.connectGuest();
        this.hostReloading = false;
        this.meshGraceUntil = Date.now() + MESH_GRACE_MS;
        setTimeout(() => this.syncMesh(), MESH_GRACE_MS + 50);
        if (voice.channel) this.send({ t: 'voice', state: { ...voice, camera: this.localCamera?.id ?? null, screen: this.localScreen?.id ?? null } });
        return;
      } catch (reason) {
        roomGone = reason === SIGNAL_ERRORS['not-found'] || reason === 'A sala foi encerrada.';
        if (roomGone) break;
        if ((this.phase as Phase) === 'ended') return;
      }
    }
    this.end(this.hostReloading || roomGone ? 'O host não voltou e a sala foi encerrada.' : 'A conexão com a sala foi perdida.');
  }

  send(msg: ClientMsg) {
    if (this.host) this.host.handle('host', msg);
    else this.hubLink?.send(msg);
  }

  // --- Mensagens do host ---

  private apply(msg: HostMsg) {
    switch (msg.t) {
      case 'welcome': {
        const { room } = msg;
        this.selfId = msg.you;
        this.media.selfId = msg.you;
        this.code = room.code;
        this.name = room.name;
        this.channels = room.channels;
        this.members = room.members;
        this.locked = room.locked;
        this.setRadio(room.radio);
        const grouped: Record<string, Message[]> = {};
        for (const message of room.history) (grouped[message.channel] ??= []).push(message);
        this.messages = grouped;
        if (!room.channels.some((c) => c.id === this.active)) this.active = room.channels[0].id;
        this.phase = 'open';
        rememberRoom(room.code, room.name);
        this.settle?.resolve();
        return;
      }
      case 'refused':
        this.settle?.reject(msg.reason);
        return this.end(msg.reason);
      case 'member-join':
        this.members = [...this.members.filter((m) => m.id !== msg.member.id), msg.member];
        return;
      case 'member-leave':
        this.members = this.members.filter((m) => m.id !== msg.id);
        return this.syncMesh();
      case 'member-update':
        return this.onMemberUpdate(msg.member);
      case 'speaking':
        return this.patchMember(msg.id, { speaking: msg.on });
      case 'chat':
        return this.onChat(msg.message);
      case 'message-edit': {
        const target = this.messages[msg.channel]?.find((m) => m.id === msg.message);
        if (target) Object.assign(target, { text: msg.text, edited: true });
        return;
      }
      case 'message-delete':
        if (this.messages[msg.channel]) this.messages[msg.channel] = this.messages[msg.channel].filter((m) => m.id !== msg.message);
        return;
      case 'reaction': {
        const message = this.messages[msg.channel]?.find((m) => m.id === msg.message);
        if (!message) return;
        if (msg.users.length) message.reactions[msg.emoji] = msg.users;
        else delete message.reactions[msg.emoji];
        return;
      }
      case 'typing': {
        this.typing[msg.channel] ??= {};
        this.typing[msg.channel][msg.id] = Date.now() + TYPING_MS;
        setTimeout(() => {
          const map = this.typing[msg.channel];
          if (map && (map[msg.id] ?? 0) <= Date.now()) delete map[msg.id];
        }, TYPING_MS + 50);
        return;
      }
      case 'rtc':
        return void this.media.onSignal(msg.from, msg.data);
      case 'channels': {
        this.channels = msg.channels;
        if (!msg.channels.some((c) => c.id === this.active)) {
          this.active = msg.channels.find((c) => c.kind === 'text')!.id;
          this.voiceView = false;
        }
        return;
      }
      case 'locked':
        this.locked = msg.locked;
        return;
      case 'radio':
        return this.setRadio(msg.radio);
      case 'host-reload':
        this.hostReloading = true;
        return;
      case 'force-mute':
        this.toast('O host silenciou seu microfone.');
        return this.setMuted(true);
      case 'notice':
        return this.toast(msg.text);
      case 'kicked':
        return this.end(msg.banned ? 'Você foi banido da sala pelo host.' : 'Você foi expulso da sala pelo host.');
      case 'closed':
        return this.end('A sala foi encerrada pelo host.');
    }
  }

  private setRadio(radio: RadioState | null) {
    this.radio = radio;
    this.radioReceivedAt = performance.now();
    // O rádio acabou para a sala: quem transmitia a aba solta a captura.
    if (!radio && this.media.radio) {
      this.media.stopRadio();
      this.pushVoice({ radio: null });
    }
  }

  /** Só escuta quem está no canal de voz do rádio. */
  get radioHere() {
    return !!this.radio && this.radio.channel === this.voice.channel;
  }

  get canControlRadio() {
    return !!this.radio && (this.isHost || this.radio.dj === this.selfId);
  }

  radioCmd(cmd: RadioCmd) {
    this.send({ t: 'radio', radio: cmd });
  }

  async startTabRadio(title: string) {
    try {
      const stream = await this.media.startRadio();
      this.pushVoice({ radio: stream.id });
      this.radioCmd({ cmd: 'start', mode: 'tab', title });
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'NotFoundError') this.toast('Marque "Compartilhar áudio" ao escolher a aba. No Firefox isso não é possível.');
      else if (name !== 'NotAllowedError') this.toast('Não foi possível capturar o áudio da aba.');
    }
  }

  private patchMember(id: string, patch: Partial<Member>) {
    const member = this.members.find((m) => m.id === id);
    if (member) Object.assign(member, patch);
  }

  private onMemberUpdate(next: Member) {
    const previous = this.members.find((m) => m.id === next.id);
    const mine = this.voice.channel;
    const wasHere = previous?.voice.channel === mine;
    const isHere = next.voice.channel === mine;
    if (previous) Object.assign(previous, next);
    else this.members = [...this.members, next];

    if (next.id === this.selfId) {
      // O host pode recusar a entrada ou apagar o canal: a verdade é o que ele devolve.
      if (!next.voice.channel && (this.media.mic || this.media.camera)) {
        this.teardownVoice();
        this.voiceView = false;
      }
    } else if (mine && wasHere !== isHere && this.settings.sounds) {
      (isHere ? sounds.join : sounds.leave)();
    }
    if (next.id !== this.selfId && !next.voice.screen) {
      this.watching = this.watching.filter((id) => id !== next.id);
    }
    this.syncMesh();
  }

  private syncMesh() {
    const channel = this.voice.channel;
    const peers = channel ? this.members.filter((m) => m.id !== this.selfId && m.voice.channel === channel).map((m) => m.id) : [];
    // Na volta, os outros ainda estão reentrando: uma ausência momentânea não derruba a voz.
    this.media.syncPeers(peers, Date.now() < this.meshGraceUntil);
  }

  private onChat(message: Message) {
    // Precisa reler a chave: `??=` devolve o array cru, não o proxy reativo do $state.
    this.messages[message.channel] ??= [];
    const list = this.messages[message.channel];
    list.push(message);
    // Quem acabou de enviar parou de digitar.
    if (this.typing[message.channel]) delete this.typing[message.channel][message.author];
    if (list.length > LIMITS.historyPerChannel) list.shift();
    if (message.system || message.author === this.selfId) return;

    const seen = message.channel === this.active && !this.voiceView && document.visibilityState === 'visible';
    if (!seen) this.unread[message.channel] = (this.unread[message.channel] ?? 0) + 1;

    const mentioned = this.mentionsMe(message.text);
    if (this.settings.sounds && !seen) (mentioned ? sounds.mention : sounds.message)();
    if (mentioned && document.hidden && this.settings.notifications && Notification.permission === 'granted') {
      new Notification(`${message.authorName} mencionou você`, { body: message.text.slice(0, 120), tag: message.id });
    }
  }

  mentionsMe(text: string) {
    const name = this.me?.name;
    return !!name && text.toLowerCase().includes(`@${name.toLowerCase()}`);
  }

  // --- Ações da interface ---

  openChannel(id: string) {
    this.active = id;
    this.voiceView = false;
    delete this.unread[id];
  }

  sendChat(channel: string, text: string, replyTo?: string, attachment?: Attachment) {
    this.send({ t: 'chat', channel, text, replyTo, attachment });
  }

  editMessage(channel: string, message: string, text: string) {
    this.send({ t: 'edit', channel, message, text });
  }

  deleteMessage(channel: string, message: string) {
    this.send({ t: 'delete', channel, message });
  }

  react(channel: string, message: string, emoji: string) {
    this.send({ t: 'react', channel, message, emoji });
  }

  notifyTyping(channel: string) {
    const now = Date.now();
    if (now - this.lastTyping < TYPING_MS - 500) return;
    this.lastTyping = now;
    this.send({ t: 'typing', channel });
  }

  moderate(mod: ModAction) {
    this.send({ t: 'mod', mod });
  }

  private pushVoice(patch: Partial<VoiceState>) {
    this.send({ t: 'voice', state: { ...$state.snapshot(this.voice), ...patch } });
  }

  async joinVoice(channel: string) {
    if (this.joining) return; // clique duplo abriria dois microfones
    this.voiceView = true;
    if (this.voice.channel === channel) return;
    if (this.voice.channel) this.leaveVoice();
    this.voiceView = true;
    this.joining = true;

    let muted = false;
    if (!this.media.mic) {
      try {
        await this.media.startMic();
        this.hasMic = true;
        void this.refreshDevices(); // a permissão libera os nomes dos dispositivos
      } catch (err) {
        console.warn('microfone indisponível', err);
        // Sem permissão ou sem microfone ainda dá para ouvir.
        this.hasMic = false;
        muted = true;
        const busy = (err as Error).name === 'NotReadableError';
        this.toast(busy ? 'Microfone em uso por outro programa: você entrou apenas ouvindo.' : 'Microfone indisponível: você entrou apenas ouvindo.');
      }
    }
    this.joining = false;
    this.applyMic(muted);
    this.pushVoice({ channel, muted, deafened: false, camera: null, screen: null, screenAudio: false, radio: null });
    if (this.settings.sounds) sounds.join();
  }

  leaveVoice() {
    if (!this.voice.channel) return;
    this.pushVoice(emptyVoice());
    this.teardownVoice();
    this.voiceView = false;
    if (this.settings.sounds) sounds.leave();
  }

  private teardownVoice() {
    this.media.stopAll();
    this.localCamera = null;
    this.localScreen = null;
    this.watching = [];
  }

  async setMuted(muted: boolean) {
    if (!muted && !this.media.mic) {
      // Quem entrou só ouvindo ou perdeu o fone pode tentar de novo ao ativar.
      try {
        await this.media.startMic();
        this.hasMic = true;
      } catch {
        return this.toast('Nenhum microfone disponível.');
      }
    }
    this.applyMic(muted);
    if (this.settings.sounds) (muted ? sounds.mute : sounds.unmute)();
    this.pushVoice({ muted, deafened: muted ? this.voice.deafened : false });
  }

  // Com push-to-talk o microfone fica fechado sem aparecer como mudo para os outros.
  private applyMic(muted: boolean) {
    this.media.setMuted(muted || (this.settings.pushToTalk && !this.talkHeld));
  }

  holdToTalk(held: boolean) {
    this.talkHeld = held;
    this.applyMic(this.voice.muted);
  }

  audioOf(name: string): UserAudio {
    return { ...defaultUserAudio, ...this.settings.userAudio[name] };
  }

  setUserAudio(name: string, patch: Partial<UserAudio>) {
    this.updateSettings({ userAudio: { ...this.settings.userAudio, [name]: { ...this.settings.userAudio[name], ...patch } } });
  }

  toggleDeafen() {
    const deafened = !this.voice.deafened;
    if (deafened) this.mutedBeforeDeafen = this.voice.muted;
    // Ao voltar a ouvir, o microfone volta ao estado de antes.
    const muted = deafened || this.mutedBeforeDeafen || !this.media.mic;
    this.applyMic(muted);
    if (this.settings.sounds) (deafened ? sounds.mute : sounds.unmute)();
    this.pushVoice({ deafened, muted });
  }

  async toggleCamera() {
    try {
      this.localCamera = await this.media.toggleCamera();
      this.pushVoice({ camera: this.localCamera?.id ?? null });
    } catch {
      this.toast('Não foi possível acessar a câmera.');
    }
  }

  async startScreen(quality: ScreenQuality, withAudio: boolean) {
    try {
      this.localScreen = await this.media.startScreen(quality, withAudio);
      const hasAudio = this.localScreen.getAudioTracks().length > 0;
      this.pushVoice({ screen: this.localScreen.id, screenAudio: hasAudio });
      this.focus = 'me-screen';
      if (withAudio && !hasAudio) {
        this.toast('Transmissão sem som: escolha "Tela inteira" e ligue "Compartilhar áudio do sistema".', 9000);
      }
    } catch (err) {
      if ((err as Error).name !== 'NotAllowedError') this.toast('Não foi possível compartilhar a tela.');
    }
  }

  stopScreen() {
    this.media.stopScreen();
    this.localScreen = null;
    if (this.focus === 'me-screen') this.focus = null;
    this.pushVoice({ screen: null, screenAudio: false });
  }

  toggleWatch(id: string) {
    const on = !this.watching.includes(id);
    this.watching = on ? [...this.watching, id] : this.watching.filter((w) => w !== id);
    this.focus = on ? `screen:${id}` : this.focus === `screen:${id}` ? null : this.focus;
    this.media.requestWatch(id, on);
  }

  updateSettings(patch: Partial<Settings>) {
    const micChanged = ['micId', 'echoCancellation', 'noiseSuppression', 'autoGainControl'].some(
      (key) => key in patch && patch[key as keyof Settings] !== this.settings[key as keyof Settings],
    );
    const cameraChanged = 'camId' in patch && patch.camId !== this.settings.camId;
    const outputChanged = 'speakerId' in patch && patch.speakerId !== this.settings.speakerId;
    Object.assign(this.settings, patch);
    if (patch.theme) applyTheme(patch.theme);
    saveSettings($state.snapshot(this.settings));
    if ('pushToTalk' in patch) this.applyMic(this.voice.muted);
    if (outputChanged) setSoundOutput(this.settings.speakerId);
    if (cameraChanged) void this.media.switchCamera().catch(() => this.toast('Não foi possível trocar a câmera.'));
    if (micChanged) void this.media.switchMic().catch(() => this.toast('Não foi possível trocar o microfone.'));
  }

  /** Depois do F5 o navegador pode exigir um clique antes de tocar áudio. */
  unblockAudio() {
    this.audioBlocked = false;
    document.querySelectorAll('audio').forEach((el) => void el.play().catch(() => {}));
    this.media.resumeAudio();
  }

  toggleGameMode() {
    const on = !this.settings.gameMode;
    this.updateSettings({ gameMode: on });
    if (this.voice.channel) this.toast(on ? 'Modo jogo ligado. O áudio mais leve vale ao reentrar na voz.' : 'Modo jogo desligado.');
  }

  toast(text: string, ms = 4000) {
    const id = ++toastId;
    this.toasts.push({ id, text });
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, ms);
  }

  // --- Saída ---

  private onPageHide = () => {
    const host = this.host;
    if (!host || this.leaving) return this.close();
    // Pode ser só um F5: guarda tudo e deixa a carência decidir se a sala acabou.
    const voice = this.voice;
    saveRoom({
      code: this.code,
      key: this.hostKey,
      name: this.name,
      active: this.active,
      voice: voice.channel ? { channel: voice.channel, muted: voice.muted, deafened: voice.deafened } : null,
      host: host.snapshot(),
    });
    for (const link of this.links.values()) link.send({ t: 'host-reload' } satisfies HostMsg);
  };

  /** Fecha para todos, se for host, ou sai da sala, se for convidado. */
  close() {
    if (this.leaving) return;
    this.leaving = true;
    clearRoom();
    window.removeEventListener('pagehide', this.onPageHide);
    navigator.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
    this.stopPressure();
    if (this.host) {
      this.host.close();
      this.signal?.closeRoom();
    }
    this.signal?.close();
    this.teardownVoice();
    if (this.host) for (const link of this.links.values()) link.closeSoon();
    else this.hubLink?.close();
  }

  private end(reason: string) {
    if (this.phase === 'ended') return;
    this.endReason = reason;
    this.phase = 'ended';
    this.close();
  }
}
