// Áudio, vídeo e tela em malha. Cada par só existe enquanto os dois estão no mesmo canal de voz.
import { LIMITS } from './protocol';
import { MicChain, createVoiceContext, type MicOptions, type MicState } from './micChain';
import type { LinkInfo, PathState, RelayPair } from './relayPlan';
import type { Settings } from './settings';

export type ScreenQuality = 'detail' | 'motion' | 'full'; // | 'high'

export const SCREEN = {
  detail: { width: 1920, height: 1080, frameRate: 15, hint: 'detail', bitrate: 2_500_000, prefer: 'maintain-resolution' },
  motion: { width: 1280, height: 720, frameRate: 30, hint: 'motion', bitrate: 2_500_000, prefer: 'maintain-framerate' },
  full: { width: 1920, height: 1080, frameRate: 30, hint: 'motion', bitrate: 4_500_000, prefer: 'maintain-framerate' },
  // Reservado para o futuro: 1080p60 pede 6 Mbps de upload por espectador.
  // Para reativar, descomente aqui, no tipo acima e a opção em Room.svelte.
  // high: { width: 1920, height: 1080, frameRate: 60, hint: 'motion', bitrate: 6_000_000, prefer: 'maintain-framerate' },
} as const;

const MIC_RETRY_MS = 600;
const MUSIC_BITRATE = 128_000;
/** Sem conectar nesse tempo, o caminho direto é dado como bloqueado e o host procura um repetidor. */
const DIRECT_TIMEOUT_MS = 6_000;
const PREDICT_MS = 2_500;
// Pelo TURN cada byte gasta a cota: voz, música e tela vão mais leves só nesses pares.
const TURN_VOICE_BITRATE = 24_000;
const TURN_MUSIC_BITRATE = 64_000;
const TURN_SCREEN_BITRATE = 1_000_000;

// Upload total é N-1 × bitrate, então o vídeo perde qualidade conforme a sala cresce.
function cameraEncoding(peers: number, lite: boolean): RTCRtpEncodingParameters {
  if (lite) return { maxBitrate: 150_000, scaleResolutionDownBy: 2, maxFramerate: 15 };
  if (peers <= 2) return { maxBitrate: 500_000, scaleResolutionDownBy: 1, maxFramerate: 24 };
  if (peers <= 4) return { maxBitrate: 300_000, scaleResolutionDownBy: 1.5, maxFramerate: 24 };
  return { maxBitrate: 150_000, scaleResolutionDownBy: 2, maxFramerate: 20 };
}

// Só troca o codec padrão quando o navegador garante que há aceleração por hardware.
let hardwareH264 = false;
void navigator.mediaCapabilities
  ?.encodingInfo({ type: 'webrtc', video: { contentType: 'video/H264', width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 } })
  .then((info) => (hardwareH264 = info.supported && info.powerEfficient))
  .catch(() => {});

function preferEfficientCodec(pc: RTCPeerConnection, sender: RTCRtpSender) {
  if (!hardwareH264) return;
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs;
  const transceiver = pc.getTransceivers().find((t) => t.sender === sender);
  if (!codecs || !transceiver?.setCodecPreferences) return;
  const isH264 = (c: { mimeType: string }) => c.mimeType === 'video/H264';
  try {
    transceiver.setCodecPreferences([...codecs.filter(isH264), ...codecs.filter((c) => !isH264(c))]);
  } catch {
    // Mantém o padrão do navegador.
  }
}

/**
 * Modo jogo: o codificador lê estes ajustes da descrição recebida do outro lado.
 * DTX corta o envio no silêncio; pacotes de 40 ms somam ~20 ms de atraso e acordam menos a CPU.
 */
function tuneForGame(sdp: string) {
  const payload = sdp.match(/a=rtpmap:(\d+) opus\/48000/)?.[1];
  if (!payload) return sdp;
  return sdp.replace(new RegExp(`(a=fmtp:${payload} [^\\r\\n]*)(\\r?\\n)`), '$1;usedtx=1$2a=ptime:40$2');
}

/** Bitrate por espectador: cada um é uma cópia codificada e enviada. */
export function screenBitrate(full: number, viewers: number) {
  const share = viewers <= 2 ? 1 : viewers === 3 ? 0.8 : 0.6;
  return Math.round(full * share);
}

export interface MediaEvents {
  signal: (to: string, data: unknown) => void;
  streams: (peer: string, streams: MediaStream[]) => void;
  speaking: (on: boolean) => void;
  screenEnded: () => void;
  radioEnded: () => void;
  micChanged: () => void;
  watchRefused: (peer: string) => void;
  micLost: () => void;
  cameraLost: () => void;
  /** Alguma ligação mudou de caminho: o host precisa saber para replanejar os repetidores. */
  paths: () => void;
}

export interface PeerStats {
  state: string;
  inbound: number;
  outbound: number;
  relay: boolean;
  rtt: number | null;
  packetsLost: number;
  packetsReceived: number;
  videoIn: string[];
  videoOut: string[];
  limit: string | null;
  encodeSeconds: number;
  framesEncoded: number;
  codec: string | null;
  path: PathState;
  /** Quem está repassando a voz desta pessoa até aqui, quando o caminho direto não existe. */
  via: string | null;
}

/** IPs só com STUN: tentar direto não gasta cota. O TURN entra só quando o host manda. */
export function stunOnly(servers: RTCIceServer[]): RTCIceServer[] {
  const out: RTCIceServer[] = [];
  for (const server of servers) {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) => url.startsWith('stun:'));
    if (urls.length) out.push({ urls });
  }
  return out;
}

/** Endereço de um candidato "srflx": é o IP público com que a operadora mostra este lado. */
export function publicAddress(candidate: string | undefined) {
  const parts = (candidate ?? '').split(' ');
  const typ = parts.indexOf('typ');
  return typ > 0 && parts[typ + 1] === 'srflx' ? parts[4] : null;
}

interface PeerEnv {
  events: MediaEvents;
  ice: () => RTCIceServer[];
  gameMode: () => boolean;
  /** Só para testes: finge que a rede bloqueia o caminho direto com esta pessoa. */
  blocked: (id: string) => boolean;
  onStable: (peer: MeshPeer) => void;
  onPath: (peer: MeshPeer) => void;
  onStreams: (peer: MeshPeer) => void;
}

class MeshPeer {
  pc: RTCPeerConnection;
  streams: MediaStream[] = [];
  /** Lado educado só publica depois da primeira negociação; veja ensurePeer. */
  open: boolean;
  /** Como esta ligação está: tentando, direta, sem caminho direto ou pelo TURN. */
  path: PathState = 'checking';
  /** O TURN foi liberado nesta ligação, porque ninguém da sala consegue repassar. */
  turn = false;
  /**
   * A tentativa direta desistiu de verdade (tempo esgotado ou falha do ICE). A previsão só
   * antecipa o repetidor, que é grátis; o TURN espera esta confirmação.
   */
  gaveUp = false;
  private makingOffer = false;
  private ignoreOffer = false;
  private applyingAnswer = false;
  private pendingIce: RTCIceCandidateInit[] = [];
  private localIps = new Set<string>();
  private remoteIps = new Set<string>();
  private timers: number[] = [];

  constructor(
    public id: string,
    private polite: boolean,
    private env: PeerEnv,
  ) {
    this.open = !polite;
    this.pc = new RTCPeerConnection({ iceServers: stunOnly(env.ice()) });
    this.pc.onicecandidate = (ev) => {
      if (!ev.candidate || env.blocked(id)) return;
      const ip = publicAddress(ev.candidate.candidate);
      if (ip) this.localIps.add(ip);
      env.events.signal(id, { ice: ev.candidate });
    };

    // Perfect Negotiation: resolve ofertas simultâneas ao ligar câmera ou tela.
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        env.events.signal(id, { sdp: this.pc.localDescription });
      } catch (err) {
        console.warn('falha ao negociar', err);
      } finally {
        this.makingOffer = false;
      }
    };
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === 'stable') env.onStable(this);
    };
    this.pc.oniceconnectionstatechange = () => this.onIceState();
    this.pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (!stream) return;
      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0) this.streams = this.streams.filter((s) => s !== stream);
        env.onStreams(this);
      };
      if (!this.streams.includes(stream)) this.streams = [...this.streams, stream];
      env.onStreams(this);
    };
    this.timers.push(
      window.setTimeout(() => this.predict(), PREDICT_MS),
      window.setTimeout(() => this.giveUp(), DIRECT_TIMEOUT_MS),
    );
  }

  private setPath(path: PathState) {
    if (this.path === path) return;
    this.path = path;
    this.env.onPath(this);
  }

  private onIceState() {
    const state = this.pc.iceConnectionState;
    if (state === 'connected' || state === 'completed') void this.settle();
    else if (state === 'failed') {
      // Com TURN liberado, tenta de novo como sempre; sem ele, é a deixa para chamar um repetidor.
      if (this.turn) this.pc.restartIce();
      else this.confirmFailure();
    }
  }

  private confirmFailure() {
    const changed = !this.gaveUp || this.path !== 'failed';
    this.gaveUp = true;
    this.path = 'failed';
    if (changed) this.env.onPath(this);
  }

  /** Conectou: direto ou pelo relay do TURN? */
  private async settle() {
    let relay = false;
    try {
      const report = await this.pc.getStats();
      report.forEach((entry: any) => {
        if (entry.type !== 'candidate-pair' || !entry.nominated || entry.state !== 'succeeded') return;
        const types = [report.get(entry.localCandidateId)?.candidateType, report.get(entry.remoteCandidateId)?.candidateType];
        relay ||= types.includes('relay');
      });
    } catch {
      // Ligação fechada no meio da leitura.
    }
    const state = this.pc.iceConnectionState;
    if (state === 'connected' || state === 'completed') this.setPath(relay ? 'turn' : 'direct');
  }

  /**
   * Mesmo IP público dos dois lados e nada conectou ainda: são duas casas atrás do mesmo
   * CGNAT, que não devolve o tráfego para dentro. Na mesma casa, o caminho local já teria ligado.
   */
  private predict() {
    if (this.path !== 'checking' || this.turn) return;
    // A operadora pode sair por IPs vizinhos: o mesmo bloco /24 também conta.
    const block = (ip: string) => (ip.includes('.') ? ip.split('.').slice(0, 3).join('.') : ip);
    const remote = new Set([...this.remoteIps].map(block));
    if ([...this.localIps].some((ip) => remote.has(block(ip)))) this.setPath('failed');
  }

  private giveUp() {
    if ((this.path === 'checking' || this.path === 'failed') && !this.turn) this.confirmFailure();
  }

  /** Último caso: ninguém da sala consegue repassar, então este par passa a usar o TURN. */
  escalate() {
    if (this.turn) return;
    this.turn = true;
    try {
      this.pc.setConfiguration({ ...this.pc.getConfiguration(), iceServers: this.env.ice() });
      this.pc.restartIce();
    } catch (err) {
      console.warn('não foi possível liberar o TURN', err);
    }
  }

  async signal(data: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }) {
    try {
      if (data.sdp) {
        // Oferta que chega enquanto a resposta anterior é aplicada não é colisão:
        // descartá-la deixaria o par mudo em um dos sentidos, sem nenhum erro.
        const ready = !this.makingOffer && (this.pc.signalingState === 'stable' || this.applyingAnswer);
        const collision = data.sdp.type === 'offer' && !ready;
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        this.applyingAnswer = data.sdp.type === 'answer';
        // Pelo TURN a voz vai mais leve, como no modo jogo: cada byte ali gasta a cota.
        const tune = (this.env.gameMode() || this.turn) && data.sdp.sdp;
        let remote = tune ? { type: data.sdp.type, sdp: tuneForGame(data.sdp.sdp!) } : data.sdp;
        // Renegociações trazem os candidatos dentro da própria descrição: o bloqueio de teste tira dali também.
        if (this.env.blocked(this.id) && remote.sdp) remote = { type: remote.type, sdp: remote.sdp.replace(/a=(candidate|end-of-candidates).*\r?\n/g, '') };
        await this.pc.setRemoteDescription(remote).finally(() => (this.applyingAnswer = false));
        await this.flushIce();
        if (data.sdp.type === 'offer') {
          await this.pc.setLocalDescription();
          this.env.events.signal(this.id, { sdp: this.pc.localDescription });
        }
      } else if (data.ice) {
        if (this.env.blocked(this.id)) return;
        const ip = publicAddress(data.ice.candidate);
        if (ip) this.remoteIps.add(ip);
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(data.ice);
        else this.pendingIce.push(data.ice);
      }
    } catch (err) {
      if (!this.ignoreOffer) console.warn('sinalização de mídia inválida', err);
    }
  }

  // Após uma colisão a fila pode ter candidatos da oferta descartada.
  // Cada um falha sozinho: um inválido não pode derrubar os válidos que vêm depois.
  private async flushIce() {
    for (const ice of this.pendingIce.splice(0)) {
      await this.pc.addIceCandidate(ice).catch(() => {});
    }
  }

  close() {
    this.timers.forEach((t) => clearTimeout(t));
    this.pc.close();
  }
}

export class MediaEngine {
  mic: MediaStream | null = null;
  camera: MediaStream | null = null;
  screen: MediaStream | null = null;
  radio: MediaStream | null = null;

  private peers = new Map<string, MeshPeer>();
  private senders = new Map<string, Map<MediaStreamTrack, RTCRtpSender>>();
  private watchers = new Set<string>();
  private videoPaused = new Set<string>(); // quem pediu para não receber vídeo agora
  private asked = new Map<string, boolean>(); // o que este lado já pediu a cada par
  private screenPreset: (typeof SCREEN)[ScreenQuality] = SCREEN.detail;
  private audio: AudioContext | null = null;
  /** Captura crua do dispositivo; `mic` é o que vai para a rede (tratado, se possível). */
  private micRaw: MediaStream | null = null;
  private chain: MicChain | null = null;
  /** Nível da voz antes da porta, para o medidor das configurações. */
  micLevel = 0;
  private gateOpen = false;
  private isSpeaking = false;
  private muted = false;
  private micToken = 0;
  private micQueue: Promise<unknown> = Promise.resolve();
  private lite = false;
  selfId = '';
  iceServers: RTCIceServer[] = [];
  /** Só para testes: pessoas com quem a rede "bloqueia" o caminho direto. */
  blocked: (id: string) => boolean = () => false;

  // Repetidor (docs/REPETIDOR.md).
  private plan: RelayPair[] = [];
  /** Sentidos que este lado repassa, como "origem>destino". */
  private relaying = new Set<string>();
  private forwards = new Map<string, Map<MediaStreamTrack, RTCRtpSender>>();
  private announced = new Map<string, Set<string>>();
  /** "repetidor:stream" → de quem é aquele áudio. */
  private relayedIn = new Map<string, string>();
  /** Pares pelo TURN cuja voz agora chega por um repetidor: a ligação fica de pé, mas sem mídia. */
  private silenced = new Set<string>();
  private emitted = new Map<string, MediaStream[]>();
  private peerEnv: PeerEnv;

  constructor(private events: MediaEvents, private settings: () => Settings) {
    this.peerEnv = {
      events,
      ice: () => this.iceServers,
      gameMode: () => this.settings().gameMode,
      blocked: (id) => this.blocked(id),
      onStable: (peer) => {
        if (!peer.open) {
          peer.open = true;
          this.publishAll(peer.id);
        }
        this.applyBitrates();
        this.refreshRelays();
      },
      onPath: () => {
        this.applyPlan();
        this.refreshStreams();
        this.applyBitrates();
        this.events.paths();
      },
      onStreams: () => {
        this.refreshRelays();
        this.refreshStreams();
      },
    };
  }

  private micAudio(deviceId: ConstrainDOMString | undefined): MediaStreamConstraints {
    const s = this.settings();
    return {
      audio: {
        deviceId,
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression,
        autoGainControl: s.autoGainControl,
        channelCount: 1,
        sampleRate: 48_000,
      },
    };
  }

  private micOptions(): MicOptions {
    const s = this.settings();
    return { voiceIsolation: s.voiceIsolation, noiseGate: s.noiseGate, threshold: s.sensitivity, volume: s.micVolume };
  }

  /** Volume, porta e sensibilidade valem na hora, sem reabrir o microfone. */
  updateMicOptions() {
    this.chain?.update(this.micOptions());
  }

  /** `exact`: com `ideal` o navegador pode ignorar a escolha e seguir no dispositivo antigo. */
  private async openMicOnce() {
    const { micId } = this.settings();
    try {
      return await navigator.mediaDevices.getUserMedia(this.micAudio(micId ? { exact: micId } : undefined));
    } catch (err) {
      // O dispositivo salvo foi desconectado: usa o padrão em vez de ficar sem voz.
      if (micId && ['OverconstrainedError', 'NotFoundError'].includes((err as Error).name)) {
        return navigator.mediaDevices.getUserMedia(this.micAudio(undefined));
      }
      throw err;
    }
  }

  async openMic() {
    try {
      return await this.openMicOnce();
    } catch (err) {
      if ((err as Error).name !== 'NotReadableError') throw err;
      // O dispositivo pode ter acabado de ser liberado, como ao sair e voltar para a voz.
      await new Promise((r) => setTimeout(r, MIC_RETRY_MS));
      return this.openMicOnce();
    }
  }

  private async buildChain(raw: MediaStream) {
    if (!this.audio) {
      this.audio = createVoiceContext();
      this.audio.onstatechange = () => this.syncMicOutput();
    }
    void this.audio.resume();
    try {
      return await MicChain.create(this.audio, raw, this.micOptions(), (s) => this.onMicState(s));
    } catch (err) {
      // Navegador sem AudioWorklet ou taxa de amostragem incompatível: envia sem tratamento.
      console.warn('tratamento de voz indisponível', err);
      return null;
    }
  }

  /** Depois do F5 o AudioContext pode nascer suspenso: até liberar, envia o som sem tratamento. */
  private micOutput() {
    return this.chain && this.audio?.state === 'running' ? this.chain.output : this.micRaw;
  }

  private attachMic(raw: MediaStream, chain: MicChain | null) {
    const track = raw.getAudioTracks()[0];
    // Fone desconectado encerra a trilha em silêncio: sem isto a pessoa some sem saber.
    track.onended = () => {
      if (this.micRaw?.getAudioTracks()[0] === track) void this.switchMic(true);
    };
    this.micRaw = raw;
    this.chain = chain;
    this.mic = this.micOutput();
    this.applyMuted();
    this.events.micChanged();
  }

  private syncMicOutput() {
    const next = this.micOutput();
    const current = this.mic;
    if (!next || !current || next === current) return;
    void this.swapMicTrack(current.getAudioTracks()[0], next.getAudioTracks()[0]);
    this.mic = next;
    this.applyMuted();
    this.events.micChanged();
  }

  private swapMicTrack(previous: MediaStreamTrack, track: MediaStreamTrack | null) {
    const pending: Promise<void>[] = [];
    for (const [id, map] of this.senders) {
      const sender = map.get(previous);
      if (!sender) continue;
      pending.push(sender.replaceTrack(track && this.outgoing(id, track)));
      map.delete(previous);
      if (track) map.set(track, sender);
    }
    return Promise.all(pending);
  }

  async startMic() {
    const token = ++this.micToken;
    const raw = await this.openMic();
    const chain = await this.buildChain(raw);
    // A pessoa saiu da voz enquanto o navegador abria o microfone.
    if (token !== this.micToken) {
      chain?.close();
      return raw.getTracks().forEach((t) => t.stop());
    }
    this.attachMic(raw, chain);
    for (const id of this.peers.keys()) this.publish(id, this.mic!);
  }

  /** Troca o microfone em uso sem derrubar as conexões. Trocas rápidas entram em fila. */
  switchMic(lost = false) {
    const run = () => this.replaceMic(lost);
    const result = this.micQueue.then(run, run);
    this.micQueue = result.catch(() => {});
    return result;
  }

  private async replaceMic(lost: boolean) {
    const old = this.mic;
    const oldRaw = this.micRaw;
    const oldChain = this.chain;
    if (!old || !oldRaw) return;
    const previous = old.getAudioTracks()[0];
    const token = this.micToken;
    let next: MediaStream;
    try {
      next = await this.openMic();
    } catch (err) {
      // Alguns headsets USB só abrem uma vez: solta o antigo e tenta de novo.
      oldRaw.getTracks().forEach((t) => t.stop());
      try {
        next = await this.openMic();
      } catch {
        if (token !== this.micToken) return;
        oldChain?.close();
        this.mic = this.micRaw = this.chain = null;
        this.gateOpen = false;
        this.updateSpeaking();
        await this.swapMicTrack(previous, null);
        this.events.micLost();
        if (lost) return;
        throw err;
      }
    }
    const chain = await this.buildChain(next);
    if (token !== this.micToken) {
      chain?.close();
      return next.getTracks().forEach((t) => t.stop());
    }
    oldRaw.getAudioTracks()[0].onended = null;
    this.attachMic(next, chain);
    await this.swapMicTrack(previous, this.mic!.getAudioTracks()[0]);
    oldChain?.close();
    oldRaw.getTracks().forEach((t) => t.stop());
  }

  /** Grupo do microfone em uso, para notar quando o padrão do sistema mudar. */
  get micGroup() {
    return this.micRaw?.getAudioTracks()[0]?.getSettings().groupId ?? null;
  }

  resumeAudio() {
    void this.audio?.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyMuted();
  }

  private applyMuted() {
    // Só desabilita a trilha: é instantâneo e não exige renegociar.
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !this.muted));
    // O tratamento lê a trilha crua, que precisa seguir ligada quando não é ela que vai para a rede.
    if (this.micRaw !== this.mic) this.micRaw?.getAudioTracks().forEach((t) => (t.enabled = true));
    this.updateSpeaking();
  }

  // A porta de voz já mede o próprio microfone; os outros só recebem o aviso.
  private onMicState(state: MicState) {
    this.micLevel = state.level;
    this.gateOpen = state.open;
    this.updateSpeaking();
  }

  private updateSpeaking() {
    const speaking = this.gateOpen && !this.muted && this.mic !== null;
    if (speaking === this.isSpeaking) return;
    this.isSpeaking = speaking;
    this.events.speaking(speaking);
  }

  /** Ajusta a malha para conter exatamente estas pessoas. */
  syncPeers(ids: string[], keep = false) {
    if (!keep) for (const id of [...this.peers.keys()]) if (!ids.includes(id)) this.dropPeer(id);
    for (const id of ids) this.ensurePeer(id);
    this.applyBitrates();
  }

  private ensurePeer(id: string) {
    let peer = this.peers.get(id);
    if (peer) return peer;
    // A primeira oferta tem dono fixo. Se os dois oferecessem juntos, o lado que recua
    // às vezes para de coletar candidatos no Chromium e o par nunca conecta.
    const created = new MeshPeer(id, this.selfId > id, this.peerEnv);
    this.peers.set(id, created);
    this.senders.set(id, new Map());
    this.applyPlan();
    if (created.open) {
      this.publishAll(id);
      // Sem microfone ainda é preciso oferecer, senão quem só ouve nunca conecta.
      if (!this.mic) created.pc.addTransceiver('audio', { direction: 'recvonly' });
    }
    return created;
  }

  private publishAll(id: string) {
    if (this.mic) this.publish(id, this.mic);
    if (this.camera) this.publish(id, this.camera);
    if (this.screen && this.watchers.has(id)) this.publish(id, this.screen);
    if (this.radio) this.publish(id, this.radio);
  }

  dropPeer(id: string) {
    for (const key of [...this.relaying]) if (key.split('>').includes(id)) this.stopForward(key);
    this.peers.get(id)?.close();
    this.peers.delete(id);
    this.senders.delete(id);
    this.watchers.delete(id);
    this.videoPaused.delete(id);
    this.asked.delete(id);
    this.silenced.delete(id);
    for (const [key, origin] of [...this.relayedIn]) if (key.startsWith(`${id}:`) || origin === id) this.relayedIn.delete(key);
    this.emitted.delete(id);
    this.events.streams(id, []);
    this.refreshStreams(); // quem chegava por esta pessoa perde a voz até o próximo plano
    this.events.paths();
  }

  /** O que cada trilha deve enviar a este par agora: nada se está pausado ou com o vídeo recusado. */
  private outgoing(id: string, track: MediaStreamTrack) {
    if (this.silenced.has(id)) return null;
    if (track.kind === 'video' && this.videoPaused.has(id)) return null;
    return track;
  }

  private publish(id: string, stream: MediaStream) {
    const peer = this.peers.get(id);
    const map = this.senders.get(id);
    if (!peer?.open || !map) return;
    for (const track of stream.getTracks()) {
      if (map.has(track)) continue;
      const sender = peer.pc.addTrack(track, stream);
      map.set(track, sender);
      if (track.kind === 'video') preferEfficientCodec(peer.pc, sender);
      if (!this.outgoing(id, track)) void sender.replaceTrack(null);
    }
  }

  private unpublish(stream: MediaStream, ids: Iterable<string> = this.peers.keys()) {
    for (const id of ids) {
      const peer = this.peers.get(id);
      const map = this.senders.get(id);
      if (!peer || !map) continue;
      for (const track of stream.getTracks()) {
        const sender = map.get(track);
        if (sender && peer.pc.signalingState !== 'closed') peer.pc.removeTrack(sender);
        map.delete(track);
      }
    }
  }

  async onSignal(from: string, data: any) {
    if (data?.relayed) return this.onRelayed(from, data.relayed);
    if (data?.watchFull) return this.events.watchRefused(from);
    if (data?.watch !== undefined) return this.setWatcher(from, Boolean(data.watch));
    if (data?.video !== undefined) return this.setVideoWanted(from, Boolean(data.video));
    if (data?.sdp || data?.ice) await this.ensurePeer(from).signal(data);
  }

  private openCamera() {
    const { camId } = this.settings();
    const size = {
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 24, max: 30 },
    };
    const open = (deviceId?: ConstrainDOMString) => navigator.mediaDevices.getUserMedia({ video: { deviceId, ...size } });
    return open(camId ? { exact: camId } : undefined).catch((err) => {
      if (camId && ['OverconstrainedError', 'NotFoundError'].includes(err.name)) return open();
      throw err;
    });
  }

  private watchCameraTrack(track: MediaStreamTrack) {
    track.onended = () => {
      if (this.camera?.getVideoTracks()[0] === track) this.events.cameraLost();
    };
  }

  async toggleCamera() {
    if (this.camera) {
      this.unpublish(this.camera);
      this.camera.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      this.camera = null;
      return null;
    }
    this.camera = await this.openCamera();
    this.watchCameraTrack(this.camera.getVideoTracks()[0]);
    for (const id of this.peers.keys()) this.publish(id, this.camera);
    this.applyBitrates();
    return this.camera;
  }

  /** Mantém o mesmo stream: quem assiste só percebe a imagem mudar. */
  async switchCamera() {
    const stream = this.camera;
    if (!stream) return;
    const previous = stream.getVideoTracks()[0];
    const track = (await this.openCamera()).getVideoTracks()[0];
    for (const [id, map] of this.senders) {
      const sender = map.get(previous);
      if (!sender) continue;
      map.delete(previous);
      map.set(track, sender);
      await sender.replaceTrack(this.outgoing(id, track));
    }
    previous.onended = null;
    previous.stop();
    stream.removeTrack(previous);
    stream.addTrack(track);
    this.watchCameraTrack(track);
  }

  async startScreen(quality: ScreenQuality, withAudio: boolean) {
    const preset = SCREEN[quality];
    const stream = await navigator.mediaDevices.getDisplayMedia({
      // Abre em "Tela inteira": é onde o Chrome oferece o som do sistema, e jogos em janela costumam vir mudos.
      video: {
        displaySurface: 'monitor',
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      },
      // Filtros de voz estragam música e efeitos do que está sendo compartilhado.
      audio: withAudio && { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: withAudio ? 'include' : 'exclude',
      windowAudio: withAudio ? 'system' : 'exclude',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    } as DisplayMediaStreamOptions);
    stream.getVideoTracks()[0].contentHint = preset.hint;
    // Encerrado pela barra do próprio navegador.
    stream.getVideoTracks()[0].onended = () => this.events.screenEnded();
    this.screen = stream;
    this.screenPreset = preset;
    for (const id of this.watchers) this.publish(id, stream);
    this.applyBitrates();
    return stream;
  }

  stopScreen() {
    if (!this.screen) return;
    this.unpublish(this.screen, this.watchers);
    this.screen.getTracks().forEach((t) => t.stop());
    this.screen = null;
    this.watchers.clear(); // cada transmissão nova exige um novo "Assistir"
  }

  /**
   * Rádio de aba: só o áudio segue para a sala. O navegador exige pedir vídeo junto,
   * então a trilha de vídeo é parada na hora e não custa codificação nenhuma.
   * Sem filtros de voz: eles estragam música.
   */
  async startRadio() {
    const capture = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    capture.getVideoTracks().forEach((t) => t.stop());
    const tracks = capture.getAudioTracks();
    if (!tracks.length) throw new DOMException('sem áudio', 'NotFoundError');
    tracks[0].contentHint = 'music';
    tracks[0].onended = () => this.events.radioEnded();
    this.radio = new MediaStream(tracks);
    for (const id of this.peers.keys()) this.publish(id, this.radio);
    this.applyBitrates();
    return this.radio;
  }

  stopRadio() {
    if (!this.radio) return;
    this.unpublish(this.radio);
    this.radio.getTracks().forEach((t) => t.stop());
    this.radio = null;
  }

  /** A tela só é enviada a quem pediu para assistir: é o que mais pesa no upload. */
  requestWatch(id: string, watch: boolean) {
    this.events.signal(id, { watch });
  }

  private screenBitrate() {
    return screenBitrate(this.screenPreset.bitrate, this.watchers.size);
  }

  private setWatcher(id: string, watch: boolean) {
    if (watch) {
      if (!this.watchers.has(id) && this.watchers.size >= LIMITS.screenViewers) {
        return this.events.signal(id, { watchFull: true });
      }
      this.watchers.add(id);
      if (this.screen) {
        this.publish(id, this.screen);
        this.applyBitrates();
      }
    } else {
      if (this.screen) this.unpublish(this.screen, [id]);
      this.watchers.delete(id);
      this.applyBitrates();
    }
  }

  /** Vídeo que ninguém está vendo não precisa ser codificado nem enviado. */
  requestVideo(id: string, want: boolean) {
    if ((this.asked.get(id) ?? true) === want) return;
    this.asked.set(id, want);
    this.events.signal(id, { video: want });
  }

  private setVideoWanted(id: string, want: boolean) {
    if (want) this.videoPaused.delete(id);
    else this.videoPaused.add(id);
    for (const [track, sender] of this.senders.get(id) ?? []) {
      if (track.kind === 'video') void sender.replaceTrack(this.outgoing(id, track));
    }
  }

  setLite(lite: boolean) {
    if (this.lite === lite) return;
    this.lite = lite;
    this.applyBitrates();
  }

  private applyBitrates() {
    const count = this.peers.size;
    for (const [id, map] of this.senders) {
      // Durante a negociação o navegador rejeita setParameters; reaplica ao estabilizar.
      if (this.peers.get(id)?.pc.signalingState !== 'stable') continue;
      const turn = this.peers.get(id)?.path === 'turn';
      for (const [track, sender] of map) {
        const isCamera = track.kind === 'video' && this.camera?.getTracks().includes(track);
        const isScreen = this.screen?.getVideoTracks().includes(track);
        const isMusic = this.radio?.getTracks().includes(track) || this.screen?.getAudioTracks().includes(track);
        const isVoice = !!this.mic?.getAudioTracks().includes(track);
        if (!isCamera && !isScreen && !isMusic && !isVoice) continue;
        const params = sender.getParameters();
        const current = params.encodings?.[0];
        if (!current) continue;
        if (isVoice) {
          // A voz só ganha teto pelo TURN; no caminho direto fica com o padrão do navegador.
          if (turn === (current.maxBitrate === TURN_VOICE_BITRATE)) continue;
          if (turn) current.maxBitrate = TURN_VOICE_BITRATE;
          else delete current.maxBitrate;
          sender.setParameters(params).catch((err) => console.warn(`bitrate de ${id}`, err));
          continue;
        }
        const wanted: RTCRtpEncodingParameters = isMusic
          ? { maxBitrate: turn ? TURN_MUSIC_BITRATE : MUSIC_BITRATE }
          : isCamera
            ? cameraEncoding(count, this.lite || turn)
            : { maxBitrate: turn ? Math.min(TURN_SCREEN_BITRATE, this.screenBitrate()) : this.screenBitrate(), maxFramerate: this.screenPreset.frameRate };
        if (Object.entries(wanted).every(([k, v]) => current[k as keyof typeof current] === v)) continue;
        Object.assign(current, wanted);
        if (isScreen) params.degradationPreference = this.screenPreset.prefer;
        sender.setParameters(params).catch((err) => console.warn(`bitrate de ${id}`, err));
      }
    }
  }

  /** Lido só com o painel de métricas aberto: getStats também custa CPU. */
  async stats() {
    const result: Record<string, PeerStats> = {};
    for (const [id, peer] of this.peers) {
      const out: PeerStats = {
        state: peer.pc.connectionState,
        inbound: 0,
        outbound: 0,
        relay: false,
        rtt: null,
        packetsLost: 0,
        packetsReceived: 0,
        videoIn: [],
        videoOut: [],
        limit: null,
        encodeSeconds: 0,
        framesEncoded: 0,
        codec: null,
        path: peer.path,
        via: this.viaFor(id),
      };
      const report = await peer.pc.getStats();
      const describe = (e: any) => `${e.frameWidth ?? 0}×${e.frameHeight ?? 0} ${Math.round(e.framesPerSecond ?? 0)} qps`;
      report.forEach((entry: any) => {
        if (entry.type === 'inbound-rtp') {
          out.inbound += entry.bytesReceived ?? 0;
          out.packetsLost += entry.packetsLost ?? 0;
          out.packetsReceived += entry.packetsReceived ?? 0;
          if (entry.kind === 'video' && entry.frameWidth) out.videoIn.push(describe(entry));
        }
        if (entry.type === 'outbound-rtp') {
          out.outbound += entry.bytesSent ?? 0;
          if (entry.kind === 'video' && entry.frameWidth) {
            out.videoOut.push(describe(entry));
            out.encodeSeconds += entry.totalEncodeTime ?? 0;
            out.framesEncoded += entry.framesEncoded ?? 0;
            if (entry.qualityLimitationReason !== 'none') out.limit = entry.qualityLimitationReason ?? out.limit;
            out.codec = report.get(entry.codecId)?.mimeType?.split('/')[1] ?? out.codec;
          }
        }
        if (entry.type === 'candidate-pair' && entry.nominated) {
          out.relay ||= report.get(entry.localCandidateId)?.candidateType === 'relay';
          if (entry.currentRoundTripTime !== undefined) out.rtt = entry.currentRoundTripTime * 1000;
        }
      });
      result[id] = out;
    }
    return result;
  }

  // --- Repetidor: quem alcança os dois lados de um par bloqueado repassa a voz entre eles. ---

  /** Plano do host da sala (src/lib/relayPlan.ts). */
  setRelayPlan(pairs: RelayPair[]) {
    this.plan = Array.isArray(pairs) ? pairs : [];
    this.applyPlan();
    this.refreshStreams();
    this.applyBitrates();
  }

  private entryWith(id: string) {
    const me = this.selfId;
    return this.plan.find((p) => (p.a === me && p.b === id) || (p.b === me && p.a === id));
  }

  private applyPlan() {
    const me = this.selfId;
    for (const [id, peer] of this.peers) {
      const entry = this.entryWith(id);
      // Último caso: sem ninguém para repassar, o par libera o TURN.
      if (entry && !entry.via && peer.path !== 'direct' && peer.gaveUp) peer.escalate();
      // Se o par já estava no TURN e um repetidor assumiu, a ligação para de levar mídia.
      this.setSilenced(id, !!entry?.via && peer.path === 'turn');
    }
    const wanted = new Set<string>();
    for (const p of this.plan) {
      if (p.via !== me) continue;
      wanted.add(`${p.a}>${p.b}`);
      wanted.add(`${p.b}>${p.a}`);
    }
    for (const key of [...this.relaying]) if (!wanted.has(key)) this.stopForward(key);
    this.relaying = wanted;
    this.refreshRelays();
  }

  private setSilenced(id: string, on: boolean) {
    if (on === this.silenced.has(id)) return;
    if (on) this.silenced.add(id);
    else this.silenced.delete(id);
    for (const [track, sender] of this.senders.get(id) ?? []) void sender.replaceTrack(this.outgoing(id, track)).catch(() => {});
  }

  /** Repassa só áudio: voz e rádio. Tela e câmera ficariam pesadas demais para quem ajuda. */
  private refreshRelays() {
    for (const key of this.relaying) {
      const [origin, target] = key.split('>');
      const source = this.peers.get(origin);
      const dest = this.peers.get(target);
      if (!source || !dest?.open || dest.pc.signalingState === 'closed') continue;
      const map = this.forwards.get(key) ?? new Map<MediaStreamTrack, RTCRtpSender>();
      this.forwards.set(key, map);
      const told = this.announced.get(key) ?? new Set<string>();
      this.announced.set(key, told);
      const live = new Set<MediaStreamTrack>();
      for (const stream of source.streams) {
        // Sem vídeo e sem o que já chega repassado: nada de corrente de repetidores.
        if (stream.getVideoTracks().length || this.relayedIn.has(`${origin}:${stream.id}`)) continue;
        if (!told.has(stream.id)) {
          // O aviso vai antes da trilha: quem recebe já sabe de quem é o áudio quando ele chega.
          told.add(stream.id);
          this.events.signal(target, { relayed: { stream: stream.id, origin } });
        }
        for (const track of stream.getAudioTracks()) {
          live.add(track);
          if (!map.has(track)) map.set(track, dest.pc.addTrack(track, stream));
        }
      }
      for (const [track, sender] of map) {
        if (live.has(track)) continue;
        dest.pc.removeTrack(sender);
        map.delete(track);
      }
    }
  }

  private stopForward(key: string) {
    const [origin, target] = key.split('>');
    const dest = this.peers.get(target);
    for (const sender of this.forwards.get(key)?.values() ?? []) {
      if (dest && dest.pc.signalingState !== 'closed') dest.pc.removeTrack(sender);
    }
    for (const stream of this.announced.get(key) ?? []) {
      if (dest) this.events.signal(target, { relayed: { stream, origin, stop: true } });
    }
    this.forwards.delete(key);
    this.announced.delete(key);
    this.relaying.delete(key);
  }

  private onRelayed(from: string, data: any) {
    const stream = typeof data?.stream === 'string' ? data.stream.slice(0, 64) : '';
    const origin = typeof data?.origin === 'string' ? data.origin : '';
    if (!stream || origin === from || origin === this.selfId) return;
    const key = `${from}:${stream}`;
    // Guarda mesmo antes do plano chegar: assim o áudio nunca toca como se fosse do repetidor.
    if (data.stop) this.relayedIn.delete(key);
    else this.relayedIn.set(key, origin);
    this.refreshStreams();
  }

  /** Só vale o repasse que o plano previu: ninguém se passa por outra pessoa. */
  private planned(relay: string, origin: string) {
    const me = this.selfId;
    return this.plan.some((p) => p.via === relay && ((p.a === origin && p.b === me) || (p.b === origin && p.a === me)));
  }

  /** O caminho próprio com esta pessoa está levando mídia? */
  private carries(id: string) {
    const peer = this.peers.get(id);
    return !!peer && (peer.path === 'direct' || (peer.path === 'turn' && !this.silenced.has(id)));
  }

  /**
   * Monta o que a interface toca de cada pessoa. A cópia repassada tem o mesmo id do stream
   * original e só entra quando o caminho próprio não leva mídia: nunca há áudio em dobro.
   */
  private refreshStreams() {
    const out = new Map<string, MediaStream[]>();
    for (const [id, peer] of this.peers) out.set(id, peer.streams.filter((s) => !this.relayedIn.has(`${id}:${s.id}`)));
    for (const [relay, peer] of this.peers) {
      for (const stream of peer.streams) {
        const origin = this.relayedIn.get(`${relay}:${stream.id}`);
        const list = origin ? out.get(origin) : undefined;
        if (!origin || !list || this.carries(origin) || !this.planned(relay, origin)) continue;
        const index = list.findIndex((s) => s.id === stream.id);
        if (index >= 0) list[index] = stream;
        else list.push(stream);
      }
    }
    for (const [id, list] of out) {
      const before = this.emitted.get(id);
      if (before && before.length === list.length && before.every((s, i) => s === list[i])) continue;
      this.emitted.set(id, list);
      this.events.streams(id, list);
    }
  }

  /** Quem está entregando a voz desta pessoa por repasse, se houver. */
  viaFor(id: string) {
    if (this.carries(id)) return null;
    for (const [key, origin] of this.relayedIn) {
      const relay = key.slice(0, key.indexOf(':'));
      if (origin === id && this.planned(relay, origin)) return relay;
    }
    return null;
  }

  /** Quantos pares este lado está ajudando agora. */
  get helping() {
    return this.plan.filter((p) => p.via === this.selfId).length;
  }

  /** O que o host precisa para planejar: caminho e atraso de cada ligação. */
  async linkReport(): Promise<Record<string, LinkInfo>> {
    const out: Record<string, LinkInfo> = {};
    for (const [id, peer] of this.peers) {
      let rtt: number | null = null;
      try {
        const report = await peer.pc.getStats();
        report.forEach((entry: any) => {
          if (entry.type === 'candidate-pair' && entry.nominated && typeof entry.currentRoundTripTime === 'number') rtt = entry.currentRoundTripTime * 1000;
        });
      } catch {
        // Ligação fechada no meio da leitura.
      }
      out[id] = { path: peer.path, rtt };
    }
    return out;
  }

  stopAll() {
    this.micToken++; // cancela aberturas e trocas de microfone em andamento
    this.plan = [];
    this.relaying.clear();
    this.syncPeers([]);
    this.chain?.close();
    for (const stream of [this.micRaw, this.mic, this.camera, this.screen, this.radio]) {
      stream?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
    }
    this.mic = this.micRaw = this.chain = this.camera = this.screen = this.radio = null;
    this.watchers.clear();
    this.gateOpen = this.isSpeaking = false;
    this.micLevel = 0;
    void this.audio?.close();
    this.audio = null;
  }
}
