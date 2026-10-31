// Cliente do Worker. Host mantém o socket aberto para receber novos amigos;
// convidado fecha assim que o canal P2P abre.

const BASE: string = import.meta.env.VITE_SIGNAL_URL ?? location.origin;
const KEEPALIVE_MS = 30_000;
const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

export const SIGNAL_ERRORS: Record<string, string> = {
  'not-found': 'Não existe sala com esse código.',
  'host-offline': 'O host desta sala está desconectado.',
  full: 'Muitas pessoas estão entrando agora. Tente de novo em instantes.',
  taken: 'Esse código já está em uso.',
  'bad-key': 'Não foi possível criar a sala.',
  unreachable: 'Não foi possível falar com o servidor de sinalização.',
};

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch(`${BASE}/ice`);
    if (!res.ok) return FALLBACK_ICE;
    return (await res.json()).iceServers;
  } catch {
    return FALLBACK_ICE;
  }
}

export interface SignalHandlers {
  onPeer?: (id: string) => void;
  onPeerLeft?: (id: string) => void;
  onSignal: (from: string, data: any) => void;
  onClosedRoom?: () => void;
  onDown?: () => void;
}

export class SignalClient {
  private ws: WebSocket | null = null;
  private keepalive = 0;
  private done = false;

  constructor(private handlers: SignalHandlers) {}

  /** Resolve com o id deste participante, ou rejeita com uma chave de SIGNAL_ERRORS. */
  connect(code: string, role: 'host' | 'guest', key = '', id = '') {
    return new Promise<string>((resolve, reject) => {
      const url = new URL(`${BASE.replace(/^http/, 'ws')}/ws/${code}`);
      url.searchParams.set('role', role);
      if (key) url.searchParams.set('key', key);
      if (id) url.searchParams.set('id', id);
      const ws = new WebSocket(url);
      this.ws = ws;
      let ready = false;

      ws.onmessage = (ev) => {
        if (ev.data === 'pong') return;
        const msg = JSON.parse(ev.data);
        switch (msg.t) {
          case 'ready':
            ready = true;
            this.keepalive = window.setInterval(() => ws.readyState === 1 && ws.send('ping'), KEEPALIVE_MS);
            return resolve(msg.id);
          case 'error':
            return reject(msg.code);
          case 'peer':
            return this.handlers.onPeer?.(msg.id);
          case 'peer-left':
            return this.handlers.onPeerLeft?.(msg.id);
          case 'signal':
            return this.handlers.onSignal(msg.from, msg.data);
          case 'closed':
            return this.handlers.onClosedRoom?.();
        }
      };
      ws.onclose = () => {
        clearInterval(this.keepalive);
        if (!ready) reject('unreachable');
        else if (!this.done) this.handlers.onDown?.();
      };
    });
  }

  send(to: string, data: unknown) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'signal', to, data }));
  }

  closeRoom() {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'close-room' }));
  }

  close() {
    this.done = true;
    clearInterval(this.keepalive);
    this.ws?.close();
  }
}
