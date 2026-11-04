// Amigos recentes: quem esteve numa sala com você. Guarda as conversas diretas neste navegador
// e mantém a caixa de entrada conectada ao Worker, para convites e mensagens chegarem a qualquer hora.
import { ADDRESS, PUB_KEY, addressOf, createIdentity, seal, unseal, type Envelope, type Identity } from './identity';
import { signalSocketUrl } from './signaling';

const KEYS = { identity: 'discordia.identity', people: 'discordia.friends', threads: 'discordia.dms', unread: 'discordia.dms.unread' };
const MAX_PEOPLE = 40;
const MAX_THREAD = 150;
export const MAX_DM = 1_000;
const PRESENCE_MS = 45_000;
const KEEPALIVE_MS = 30_000;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000];

export interface Friend {
  address: string;
  pub: string;
  name: string;
  color: string;
  avatar: string;
  /** Última vez que estiveram numa sala juntos. */
  seen: number;
  room: string;
}

/** O que vai cifrado entre amigos. */
export type DirectPayload =
  | { kind: 'text'; id: string; text: string; name: string; color: string; at: number }
  | { kind: 'invite'; id: string; code: string; room: string; name: string; color: string; at: number };

export type DirectMessage = DirectPayload & { mine: boolean; status?: 'sending' | 'delivered' | 'queued' | 'failed' };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cota cheia: o histórico mais antigo some na próxima gravação, que já corta o excesso.
  }
}

class Friends {
  identity: Identity | null = null;
  people = $state<Friend[]>(read(KEYS.people, []));
  threads = $state<Record<string, DirectMessage[]>>(read(KEYS.threads, {}));
  unread = $state<Record<string, number>>(read(KEYS.unread, {}));
  online = $state<Record<string, boolean>>({});
  connected = $state(false);
  /** Painel de amigos aberto, e a conversa aberta nele (que não conta como não lida). */
  panel = $state(false);
  open = $state<string | null>(null);
  /** Avisos que chegaram e ainda não foram vistos (convites e mensagens). */
  incoming = $state<{ address: string; message: DirectMessage }[]>([]);
  /** Quem quer saber quando chega algo (som, notificação). */
  onIncoming: ((friend: Friend | undefined, message: DirectMessage) => void) | null = null;

  private ws: WebSocket | null = null;
  private addresses = new Map<string, Promise<string>>();
  private retry = 0;
  private timers: number[] = [];
  private started = false;

  get totalUnread() {
    return Object.values(this.unread).reduce((sum, n) => sum + n, 0);
  }

  get sorted() {
    return [...this.people].sort((a, b) => Number(!!this.online[b.address]) - Number(!!this.online[a.address]) || b.seen - a.seen);
  }

  find(address: string) {
    return this.people.find((p) => p.address === address);
  }

  /** Chave pública que vai junto do perfil nas salas. */
  async publicKey() {
    return (await this.ensureIdentity()).pub;
  }

  /** A mesma chave, sem esperar, quando ela já foi criada antes (o caso normal). */
  get storedKey(): string | undefined {
    const pub = this.identity?.pub ?? read<Identity | null>(KEYS.identity, null)?.pub;
    return pub && PUB_KEY.test(pub) ? pub : undefined;
  }

  private async ensureIdentity() {
    if (this.identity) return this.identity;
    let identity = read<Identity | null>(KEYS.identity, null);
    if (!identity || !PUB_KEY.test(identity.pub)) {
      identity = await createIdentity();
      write(KEYS.identity, identity);
    }
    this.identity = identity;
    return identity;
  }

  start() {
    if (this.started) return;
    this.started = true;
    // Outra aba gravou: recarrega para as duas mostrarem o mesmo.
    addEventListener('storage', (e) => {
      if (e.key === KEYS.people) this.people = read(KEYS.people, []);
      if (e.key === KEYS.threads) this.threads = read(KEYS.threads, {});
      if (e.key === KEYS.unread) this.unread = read(KEYS.unread, {});
    });
    void this.connect();
  }

  private async connect() {
    const me = await this.ensureIdentity();
    const url = new URL(signalSocketUrl(`/inbox/${me.address}`));
    url.searchParams.set('key', me.inboxKey);
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return this.reconnect();
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      const msg = JSON.parse(ev.data);
      if (msg.t === 'ready') {
        this.connected = true;
        this.retry = 0;
        this.refreshPresence();
        this.timers.push(
          window.setInterval(() => ws.readyState === 1 && ws.send('ping'), KEEPALIVE_MS),
          window.setInterval(() => this.refreshPresence(), PRESENCE_MS),
        );
      } else if (msg.t === 'messages') void this.receive(msg.envelopes as Envelope[]);
      else if (msg.t === 'presence') this.online = { ...this.online, ...msg.online };
      else if (msg.t === 'sent') this.setStatus(msg.ref, msg.status === 'delivered' ? 'delivered' : msg.status === 'queued' ? 'queued' : 'failed');
    };
    ws.onclose = () => {
      this.connected = false;
      this.timers.forEach(clearInterval);
      this.timers = [];
      this.reconnect();
    };
  }

  private reconnect() {
    const wait = RETRY_MS[Math.min(this.retry++, RETRY_MS.length - 1)];
    window.setTimeout(() => void this.connect(), wait);
  }

  refreshPresence() {
    if (this.ws?.readyState !== 1 || !this.people.length) return;
    this.ws.send(JSON.stringify({ t: 'presence', ids: this.sorted.slice(0, 30).map((p) => p.address) }));
  }

  /** Quem esteve numa sala com você vira amigo recente (ou é atualizado). */
  async remember(member: { name: string; color: string; avatar: string; friend?: string }, room: string) {
    if (!member.friend || !PUB_KEY.test(member.friend)) return;
    const me = await this.ensureIdentity();
    if (member.friend === me.pub) return;
    // A sala muda várias vezes por segundo (quem fala): o hash de cada chave é feito uma vez só.
    let pending = this.addresses.get(member.friend);
    if (!pending) this.addresses.set(member.friend, (pending = addressOf(member.friend)));
    const address = await pending;
    const existing = this.find(address);
    const next: Friend = { address, pub: member.friend, name: member.name, color: member.color, avatar: member.avatar, seen: Date.now(), room };
    // Atualizar a cada mudança da sala gravaria o tempo todo: só quando algo mudou ou passou um minuto.
    if (existing && existing.name === next.name && existing.avatar === next.avatar && existing.room === room && next.seen - existing.seen < 60_000) return;
    this.people = [next, ...this.people.filter((p) => p.address !== address)].slice(0, MAX_PEOPLE);
    write(KEYS.people, $state.snapshot(this.people));
    if (!existing) this.refreshPresence();
  }

  forget(address: string) {
    this.people = this.people.filter((p) => p.address !== address);
    delete this.threads[address];
    delete this.unread[address];
    this.save();
    write(KEYS.people, $state.snapshot(this.people));
  }

  /** Bloquear: o Worker passa a descartar o que essa pessoa mandar, sem avisá-la. */
  block(address: string) {
    this.ws?.send(JSON.stringify({ t: 'block', id: address, on: true }));
    this.forget(address);
  }

  markRead(address: string) {
    if (!this.unread[address]) return;
    delete this.unread[address];
    write(KEYS.unread, $state.snapshot(this.unread));
  }

  /** Abre o painel já na conversa com alguém (ou na lista, sem endereço). */
  show(address: string | null = null) {
    this.panel = true;
    this.open = address;
    if (address) {
      this.markRead(address);
      this.incoming = this.incoming.filter((i) => i.address !== address);
    }
  }

  dismiss(id: string) {
    this.incoming = this.incoming.filter((i) => i.message.id !== id);
  }

  async sendText(address: string, text: string, me: { name: string; color: string }) {
    const clean = text.trim().slice(0, MAX_DM);
    if (!clean) return;
    await this.send(address, { kind: 'text', id: crypto.randomUUID(), text: clean, name: me.name, color: me.color, at: Date.now() });
  }

  async invite(addresses: string[], code: string, room: string, me: { name: string; color: string }) {
    for (const address of addresses) {
      await this.send(address, { kind: 'invite', id: crypto.randomUUID(), code, room, name: me.name, color: me.color, at: Date.now() });
    }
  }

  private async send(address: string, payload: DirectPayload) {
    const friend = this.find(address);
    const me = await this.ensureIdentity();
    const message: DirectMessage = { ...payload, mine: true, status: 'sending' };
    this.push(address, message);
    if (!friend || this.ws?.readyState !== 1) return this.setStatus(payload.id, 'failed');
    const sealed = await seal(me, friend.pub, payload);
    this.ws.send(JSON.stringify({ t: 'send', ref: payload.id, to: address, ...sealed }));
  }

  private async receive(envelopes: Envelope[]) {
    const me = await this.ensureIdentity();
    for (const envelope of envelopes) {
      if (!ADDRESS.test(envelope.from)) continue;
      const payload = await unseal<DirectPayload>(me, envelope);
      if (!payload || (payload.kind !== 'text' && payload.kind !== 'invite') || typeof payload.id !== 'string') continue;
      if (this.threads[envelope.from]?.some((m) => m.id === payload.id)) continue;
      const message: DirectMessage = {
        ...payload,
        text: payload.kind === 'text' ? String(payload.text).slice(0, MAX_DM) : undefined,
        name: String(payload.name).slice(0, 32),
        mine: false,
      } as DirectMessage;
      // Alguém que esteve com você mas ainda não estava na lista (outra aba, outro aparelho): entra agora.
      if (!this.find(envelope.from)) {
        this.people = [{ address: envelope.from, pub: envelope.pub, name: message.name, color: /^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color : '#a48cf5', avatar: '', seen: Date.now(), room: '' }, ...this.people].slice(0, MAX_PEOPLE);
        write(KEYS.people, $state.snapshot(this.people));
      }
      this.push(envelope.from, message);
      if (this.open !== envelope.from || document.visibilityState !== 'visible') {
        this.unread[envelope.from] = (this.unread[envelope.from] ?? 0) + 1;
        write(KEYS.unread, $state.snapshot(this.unread));
        this.incoming = [...this.incoming.filter((i) => i.address !== envelope.from || i.message.kind !== message.kind), { address: envelope.from, message }];
      }
      this.online = { ...this.online, [envelope.from]: true };
      this.onIncoming?.(this.find(envelope.from), message);
    }
  }

  private push(address: string, message: DirectMessage) {
    const thread = this.threads[address] ?? [];
    this.threads[address] = [...thread, message].slice(-MAX_THREAD);
    this.save();
  }

  private setStatus(id: string, status: DirectMessage['status']) {
    for (const thread of Object.values(this.threads)) {
      const message = thread.find((m) => m.id === id);
      if (message) {
        message.status = status;
        this.save();
        return;
      }
    }
  }

  private save() {
    write(KEYS.threads, $state.snapshot(this.threads));
  }
}

export const friends = new Friends();
