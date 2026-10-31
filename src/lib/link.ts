// Enlace de dados entre host e participante: uma RTCPeerConnection com um DataChannel.
import { FrameDecoder, encodeFrames } from './framing';

const HEARTBEAT_MS = 5_000;
const TIMEOUT_MS = 15_000;
const HIGH_WATER = 1024 * 1024;
const LOW_WATER = 256 * 1024;

export interface LinkHandlers {
  signal: (data: unknown) => void;
  open: () => void;
  message: (msg: any) => void;
  close: () => void;
}

export class Link {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel;
  private queue: string[] = [];
  private decoder: FrameDecoder;
  private nextId = 0;
  private lastSeen = 0;
  private beat = 0;
  private closed = false;
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(iceServers: RTCIceServer[], maxInbound: number, private on: LinkHandlers) {
    this.decoder = new FrameDecoder(maxInbound);
    this.pc = new RTCPeerConnection({ iceServers });
    // Negociado: os dois lados criam o canal, sem depender de quem chamou primeiro.
    this.dc = this.pc.createDataChannel('sala', { negotiated: true, id: 0 });
    this.dc.bufferedAmountLowThreshold = LOW_WATER;
    this.dc.onbufferedamountlow = () => this.pump();
    this.dc.onopen = () => {
      this.lastSeen = Date.now();
      this.beat = window.setInterval(() => this.heartbeat(), HEARTBEAT_MS);
      this.on.open();
    };
    this.dc.onclose = () => this.close();
    this.dc.onmessage = (ev) => this.receive(ev.data);
    this.pc.onicecandidate = (ev) => ev.candidate && this.on.signal({ ice: ev.candidate });
    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed') this.close();
    };
  }

  async call() {
    await this.pc.setLocalDescription(await this.pc.createOffer());
    this.on.signal({ sdp: this.pc.localDescription });
  }

  async signal(data: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }) {
    try {
      if (data.sdp) {
        await this.pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          this.on.signal({ sdp: this.pc.localDescription });
        }
        for (const ice of this.pendingIce.splice(0)) await this.pc.addIceCandidate(ice);
      } else if (data.ice) {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(data.ice);
        else this.pendingIce.push(data.ice);
      }
    } catch (err) {
      console.warn('sinalização inválida', err);
    }
  }

  send(msg: unknown) {
    if (this.closed) return;
    this.queue.push(...encodeFrames(JSON.stringify(msg), this.nextId++));
    this.pump();
  }

  // Respeita o buffer do canal: sem isso, um arquivo grande derruba a conexão.
  private pump() {
    while (this.queue.length && this.dc.readyState === 'open' && this.dc.bufferedAmount < HIGH_WATER) {
      this.dc.send(this.queue.shift()!);
    }
  }

  private receive(frame: unknown) {
    this.lastSeen = Date.now();
    if (typeof frame !== 'string' || frame === 'p') return;
    const json = this.decoder.push(frame);
    if (json === null) return;
    try {
      this.on.message(JSON.parse(json));
    } catch {
      // Participante mal-intencionado ou com bug: ignora a mensagem.
    }
  }

  private heartbeat() {
    if (Date.now() - this.lastSeen > TIMEOUT_MS) return this.close();
    if (this.dc.readyState === 'open' && this.queue.length === 0) this.dc.send('p');
  }

  /** Espera a fila esvaziar um instante para o último aviso chegar antes de fechar. */
  closeSoon() {
    setTimeout(() => this.close(), 150);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.beat);
    this.dc.close();
    this.pc.close();
    this.on.close();
  }
}
