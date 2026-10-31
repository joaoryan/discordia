// Sinalização mínima: liga um código de sala ao host e repassa SDP/ICE.
// Nenhum conteúdo de conversa passa por aqui.
import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT_PER_MIN?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

const CODE = /^[A-HJKMNP-Z2-9]{6}$/;
const HOST_GRACE_MS = 30_000; // F5 ou queda rápida do host não mata a sala
const GUEST_ID = /^[0-9a-f]{8}$/;
const MAX_SIGNAL = 16_384;
const MAX_PENDING_GUESTS = 40;
const FALLBACK_ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];

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
  return allowed.length === 0 || (origin !== null && allowed.includes(origin));
}

function corsHeaders(origin: string | null): Record<string, string> {
  return { 'Access-Control-Allow-Origin': origin ?? '*', Vary: 'Origin' };
}

async function iceServers(env: Env) {
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
