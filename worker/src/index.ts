// Sinalização mínima: liga um código de sala ao host e repassa SDP/ICE.
// Também guarda a caixa de entrada de cada pessoa para convites e mensagens entre amigos,
// mas só envelopes cifrados de ponta a ponta: nenhum conteúdo de conversa é legível aqui.
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  INBOXES: DurableObjectNamespace<Inbox>;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_PER_MIN?: string;
  METERED_APP?: string;
  METERED_API_KEY?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

const CODE = /^[A-HJKMNP-Z2-9]{6}$/;
const HOST_GRACE_MS = 30_000; // F5 ou queda rápida do host não mata a sala
const GUEST_ID = /^[0-9a-f]{8}$/;
const MAX_SIGNAL = 16_384;
const METERED_CACHE_MS = 10 * 60 * 1000;
const MAX_PENDING_GUESTS = 40;
const FALLBACK_ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const ADDRESS = /^[A-Za-z0-9_-]{22}$/;
const PUB_KEY = /^[A-Za-z0-9_-]{87}$/;
const B64U = /^[A-Za-z0-9_-]+$/;
const MAX_ENVELOPE = 12_000; // texto de até ~2.000 caracteres depois de cifrado
const MAX_QUEUED = 50;
const QUEUE_TTL_MS = 7 * 24 * 3600 * 1000;
const SENDS_PER_MIN = 30;
const MAX_PRESENCE = 30; // o plano grátis permite 50 subrequisições por chamada

// Limite aproximado por IP, mantido na memória do isolate: basta para travar varredura de códigos.
const attempts = new Map<string, { n: number; reset: number }>();

function limited(ip: string, max: number) {
  const now = Date.now();
  if (attempts.size > 10_000) attempts.clear();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) {
    attempts.set(ip, { n: 1, reset: now + 60_000 });
    return false;
  }
  return ++entry.n > max;
}

function originAllowed(origin: string | null, env: Env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  return allowed.length === 0 || allowed.includes('*') || (origin !== null && allowed.includes(origin));
}

function corsHeaders(origin: string | null): Record<string, string> {
  return { 'Access-Control-Allow-Origin': origin ?? '*', Vary: 'Origin' };
}

let meteredCache: { servers: unknown; until: number } | null = null;

// A chave fica aqui no Worker: o navegador recebe só as credenciais de relay.
async function meteredServers(env: Env) {
  if (meteredCache && meteredCache.until > Date.now()) return meteredCache.servers;
  const url = `https://${env.METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${env.METERED_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return FALLBACK_ICE;
  const servers = await res.json();
  meteredCache = { servers, until: Date.now() + METERED_CACHE_MS };
  return servers;
}

async function iceServers(env: Env) {
  if (env.METERED_APP && env.METERED_API_KEY) return meteredServers(env);
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return FALLBACK_ICE;
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 8 * 3600 }),
    },
  );
  if (!res.ok) return FALLBACK_ICE;
  const body = (await res.json()) as { iceServers: { urls: string[] } };
  // Navegadores bloqueiam a porta 53; deixá-la só atrasaria a coleta de candidatos.
  const server = body.iceServers;
  return [{ ...server, urls: server.urls.filter((url) => !url.includes(':53')) }];
}

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    if (!originAllowed(origin, env)) return new Response('origem não permitida', { status: 403 });

    if (url.pathname === '/ice') {
      return Response.json({ iceServers: await iceServers(env) }, { headers: corsHeaders(origin) });
    }

    const inbox = url.pathname.match(/^\/inbox\/([^/]+)$/);
    if (inbox && req.headers.get('Upgrade') === 'websocket') {
      if (!ADDRESS.test(inbox[1])) return new Response('endereço inválido', { status: 400 });
      const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
      if (limited(`inbox:${ip}`, Number(env.RATE_LIMIT_PER_MIN ?? 30))) return new Response('muitas tentativas', { status: 429 });
      return env.INBOXES.get(env.INBOXES.idFromName(inbox[1])).fetch(req);
    }

    const match = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (match && req.headers.get('Upgrade') === 'websocket') {
      if (!CODE.test(match[1])) return new Response('código inválido', { status: 400 });
      const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
      if (limited(ip, Number(env.RATE_LIMIT_PER_MIN ?? 30))) {
        return new Response('muitas tentativas', { status: 429 });
      }
      return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(req);
    }
    return new Response('Discordia signal', { status: 404 });
  },
};

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Responde ao keepalive sem acordar o objeto, o que mantém o custo perto de zero.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private get host() {
    return this.ctx.getWebSockets('host')[0];
  }

  async fetch(req: Request) {
    const url = new URL(req.url);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const stored = await this.ctx.storage.get<string>('key');

    const refuse = (code: string) => {
      server.accept();
      server.send(JSON.stringify({ t: 'error', code }));
      server.close(4000, code);
      return new Response(null, { status: 101, webSocket: client });
    };

    if (url.searchParams.get('role') === 'host') {
      const key = url.searchParams.get('key') ?? '';
      if (key.length < 16) return refuse('bad-key');
      if (stored && stored !== key) return refuse('taken');
      await this.ctx.storage.put('key', key);
      await this.ctx.storage.deleteAlarm();
      for (const old of this.ctx.getWebSockets('host')) old.close(4001, 'replaced');
      this.ctx.acceptWebSocket(server, ['host']);
      server.serializeAttachment({ id: 'host' });
      server.send(JSON.stringify({ t: 'ready', id: 'host' }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (!stored) return refuse('not-found');
    const host = this.host;
    if (!host) return refuse('host-offline');
    if (this.ctx.getWebSockets('guest').length >= MAX_PENDING_GUESTS) return refuse('full');

    // Quem volta mantém o id: assim a voz direta com os outros convidados continua de pé.
    const wanted = url.searchParams.get('id') ?? '';
    const free = GUEST_ID.test(wanted) && this.ctx.getWebSockets(wanted).length === 0;
    const id = free ? wanted : crypto.randomUUID().slice(0, 8);
    this.ctx.acceptWebSocket(server, ['guest', id]);
    server.serializeAttachment({ id });
    server.send(JSON.stringify({ t: 'ready', id }));
    host.send(JSON.stringify({ t: 'peer', id }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_SIGNAL) return;
    let msg: { t?: string; to?: string; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const { id } = ws.deserializeAttachment() as { id: string };

    if (msg.t === 'close-room' && id === 'host') return this.closeRoom();
    if (msg.t !== 'signal') return;
    if (id === 'host') {
      const target = msg.to ? this.ctx.getWebSockets(msg.to)[0] : undefined;
      target?.send(JSON.stringify({ t: 'signal', from: 'host', data: msg.data }));
    } else {
      this.host?.send(JSON.stringify({ t: 'signal', from: id, data: msg.data }));
    }
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close(1000); // completa o fechamento iniciado pelo cliente
    } catch {
      // já fechado
    }
    const { id } = ws.deserializeAttachment() as { id: string };
    if (id === 'host') {
      // O próprio socket ainda aparece na lista enquanto fecha.
      const others = this.ctx.getWebSockets('host').filter((socket) => socket !== ws);
      if (!others.length) await this.ctx.storage.setAlarm(Date.now() + HOST_GRACE_MS);
    } else {
      this.host?.send(JSON.stringify({ t: 'peer-left', id }));
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    if (!this.host) await this.closeRoom();
  }

  private async closeRoom() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ t: 'closed' }));
        ws.close(1000, 'closed');
      } catch {
        // socket já fechado
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}

interface StoredEnvelope {
  from: string;
  pub: string;
  iv: string;
  data: string;
  at: number;
}

async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Caixa de entrada de uma pessoa. Só o dono conecta (com o segredo da caixa); qualquer outra caixa
 * entrega envelopes nela. Envelopes esperam até 7 dias se o dono estiver offline e somem ao serem entregues.
 */
export class Inbox extends DurableObject<Env> {
  private sends: number[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request) {
    const url = new URL(req.url);
    if (url.pathname === '/online') return Response.json({ online: this.ctx.getWebSockets('owner').length > 0 });
    if (url.pathname === '/deliver' && req.method === 'POST') return this.deliver((await req.json()) as StoredEnvelope);
    return this.openInbox(url);
  }

  private async openInbox(url: URL) {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const address = url.pathname.split('/').pop() ?? '';
    const key = url.searchParams.get('key') ?? '';
    const refuse = (code: string) => {
      server.accept();
      server.send(JSON.stringify({ t: 'error', code }));
      server.close(4000, code);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (key.length < 32) return refuse('bad-key');
    // A primeira conexão reivindica a caixa; depois só o mesmo segredo abre.
    const hash = await sha256(key);
    const stored = await this.ctx.storage.get<string>('keyHash');
    if (stored && stored !== hash) return refuse('bad-key');
    if (!stored) await this.ctx.storage.put({ keyHash: hash, address });

    this.ctx.acceptWebSocket(server, ['owner']);
    server.send(JSON.stringify({ t: 'ready' }));
    const queued = await this.ctx.storage.list<StoredEnvelope>({ prefix: 'm:' });
    if (queued.size) {
      const fresh = [...queued.values()].filter((e) => Date.now() - e.at < QUEUE_TTL_MS);
      if (fresh.length) server.send(JSON.stringify({ t: 'messages', envelopes: fresh }));
      await this.ctx.storage.delete([...queued.keys()]);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Chamado por outra caixa: entrega na hora ou guarda para quando o dono voltar. */
  private async deliver(envelope: StoredEnvelope) {
    const blocked = (await this.ctx.storage.get<string[]>('blocked')) ?? [];
    if (blocked.includes(envelope.from)) return Response.json({ status: 'blocked' });
    const item = { ...envelope, at: Date.now() };
    const owners = this.ctx.getWebSockets('owner');
    if (owners.length) {
      for (const ws of owners) ws.send(JSON.stringify({ t: 'messages', envelopes: [item] }));
      return Response.json({ status: 'delivered' });
    }
    const queued = await this.ctx.storage.list({ prefix: 'm:' });
    if (queued.size >= MAX_QUEUED) await this.ctx.storage.delete([...queued.keys()].slice(0, queued.size - MAX_QUEUED + 1));
    await this.ctx.storage.put(`m:${item.at.toString().padStart(15, '0')}:${crypto.randomUUID().slice(0, 6)}`, item);
    return Response.json({ status: 'queued' });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_ENVELOPE + 512) return;
    let msg: { t?: string; ref?: unknown; to?: unknown; pub?: unknown; iv?: unknown; data?: unknown; ids?: unknown; id?: unknown; on?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const reply = (body: object) => ws.send(JSON.stringify(body));

    if (msg.t === 'send') {
      const ref = typeof msg.ref === 'string' ? msg.ref.slice(0, 40) : '';
      const valid =
        typeof msg.to === 'string' && ADDRESS.test(msg.to) &&
        typeof msg.pub === 'string' && PUB_KEY.test(msg.pub) &&
        typeof msg.iv === 'string' && B64U.test(msg.iv) && msg.iv.length <= 24 &&
        typeof msg.data === 'string' && B64U.test(msg.data) && msg.data.length <= MAX_ENVELOPE;
      if (!valid) return reply({ t: 'sent', ref, status: 'invalid' });
      const now = Date.now();
      this.sends = this.sends.filter((at) => now - at < 60_000);
      if (this.sends.length >= SENDS_PER_MIN) return reply({ t: 'sent', ref, status: 'slow-down' });
      this.sends.push(now);
      // O remetente é carimbado aqui, pela caixa autenticada: ninguém manda em nome de outro.
      const from = await this.ctx.storage.get<string>('address');
      const target = this.env.INBOXES.get(this.env.INBOXES.idFromName(msg.to as string));
      const res = await target.fetch('https://inbox/deliver', { method: 'POST', body: JSON.stringify({ from, pub: msg.pub, iv: msg.iv, data: msg.data }) });
      const { status } = (await res.json()) as { status: string };
      return reply({ t: 'sent', ref, status: status === 'blocked' ? 'queued' : status }); // não revela o bloqueio
    }

    if (msg.t === 'presence' && Array.isArray(msg.ids)) {
      const ids = msg.ids.filter((id): id is string => typeof id === 'string' && ADDRESS.test(id)).slice(0, MAX_PRESENCE);
      const online: Record<string, boolean> = {};
      await Promise.all(
        ids.map(async (id) => {
          const res = await this.env.INBOXES.get(this.env.INBOXES.idFromName(id)).fetch('https://inbox/online');
          online[id] = ((await res.json()) as { online: boolean }).online;
        }),
      );
      return reply({ t: 'presence', online });
    }

    if (msg.t === 'block' && typeof msg.id === 'string' && ADDRESS.test(msg.id)) {
      const blocked = new Set((await this.ctx.storage.get<string[]>('blocked')) ?? []);
      if (msg.on) blocked.add(msg.id);
      else blocked.delete(msg.id);
      await this.ctx.storage.put('blocked', [...blocked].slice(-500));
    }
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close(1000);
    } catch {
      // já fechado
    }
  }
}
