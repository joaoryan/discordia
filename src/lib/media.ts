// Áudio, vídeo e tela em malha. Cada par só existe enquanto os dois estão no mesmo canal de voz.
import { LIMITS } from './protocol';
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
const METER_MS = 150;

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
}

class MeshPeer {
  pc: RTCPeerConnection;
  streams: MediaStream[] = [];
  /** Lado educado só publica depois da primeira negociação; veja ensurePeer. */
  open: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private applyingAnswer = false;
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(
    private id: string,
    private polite: boolean,
    iceServers: RTCIceServer[],
    private events: MediaEvents,
    private gameMode: () => boolean,
    onStable: () => void,
  ) {
    this.open = !polite;
    this.pc = new RTCPeerConnection({ iceServers });
    this.pc.onicecandidate = (ev) => ev.candidate && events.signal(id, { ice: ev.candidate });

    // Perfect Negotiation: resolve ofertas simultâneas ao ligar câmera ou tela.
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        events.signal(id, { sdp: this.pc.localDescription });
      } catch (err) {
        console.warn('falha ao negociar', err);
      } finally {
        this.makingOffer = false;
      }
    };
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === 'stable') onStable();
    };
    this.pc.oniceconnectionstatechange = () => {
      if (this.pc.iceConnectionState === 'failed') this.pc.restartIce();
    };
    this.pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (!stream) return;
      stream.onremovetrack = () => {
        if (stream.getTracks().length === 0) this.streams = this.streams.filter((s) => s !== stream);
        events.streams(id, this.streams);
      };
      if (!this.streams.includes(stream)) this.streams = [...this.streams, stream];
      events.streams(id, this.streams);
    };
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
        const remote = this.gameMode() && data.sdp.sdp ? { type: data.sdp.type, sdp: tuneForGame(data.sdp.sdp) } : data.sdp;
        await this.pc.setRemoteDescription(remote).finally(() => (this.applyingAnswer = false));
        await this.flushIce();
        if (data.sdp.type === 'offer') {
          await this.pc.setLocalDescription();
          this.events.signal(this.id, { sdp: this.pc.localDescription });
        }
      } else if (data.ice) {
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
  private meterSource: MediaStreamAudioSourceNode | null = null;
  private meter = 0;
  private isSpeaking = false;
  private lastLoud = 0;
  private muted = false;
  private micToken = 0;
  private micQueue: Promise<unknown> = Promise.resolve();
  private lite = false;
  selfId = '';
  iceServers: RTCIceServer[] = [];

  constructor(private events: MediaEvents, private settings: () => Settings) {}

  private micAudio(deviceId: ConstrainDOMString | undefined): MediaStreamConstraints {
    const s = this.settings();
    return {
      audio: {
        deviceId,
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression,
        autoGainControl: s.autoGainControl,
      },
    };
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

  private attachMic(stream: MediaStream) {
    const track = stream.getAudioTracks()[0];
    // Fone desconectado encerra a trilha em silêncio: sem isto a pessoa some sem saber.
    track.onended = () => {
      if (this.mic?.getAudioTracks()[0] === track) void this.switchMic(true);
    };
    this.mic = stream;
    this.applyMuted();
    this.startMeter();
    this.events.micChanged();
  }

  async startMic() {
    const token = ++this.micToken;
    const stream = await this.openMic();
    // A pessoa saiu da voz enquanto o navegador abria o microfone.
    if (token !== this.micToken) return stream.getTracks().forEach((t) => t.stop());
    this.attachMic(stream);
    for (const id of this.peers.keys()) this.publish(id, stream);
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
    if (!old) return;
    const previous = old.getAudioTracks()[0];
    const token = this.micToken;
    let next: MediaStream;
    try {
      next = await this.openMic();
    } catch (err) {
      // Alguns headsets USB só abrem uma vez: solta o antigo e tenta de novo.
      old.getTracks().forEach((t) => t.stop());
      try {
        next = await this.openMic();
      } catch {
        if (token !== this.micToken) return;
        this.mic = null;
        clearInterval(this.meter);
        for (const map of this.senders.values()) {
          await map.get(previous)?.replaceTrack(null);
        }
        this.events.micLost();
        if (lost) return;
        throw err;
      }
    }
    if (token !== this.micToken) return next.getTracks().forEach((t) => t.stop());
    const track = next.getAudioTracks()[0];
    for (const map of this.senders.values()) {
      const sender = map.get(previous);
      if (!sender) continue;
      await sender.replaceTrack(track);
      map.delete(previous);
      map.set(track, sender);
    }
    previous.onended = null;
    old.getTracks().forEach((t) => t.stop());
    this.attachMic(next);
  }

  /** Grupo do microfone em uso, para notar quando o padrão do sistema mudar. */
  get micGroup() {
    return this.mic?.getAudioTracks()[0]?.getSettings().groupId ?? null;
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
  }

  // Mede o próprio microfone e avisa os outros, em vez de analisar cada áudio recebido.
  private startMeter() {
    clearInterval(this.meter);
    this.meterSource?.disconnect();
    if (!this.mic) return;
    this.audio ??= new AudioContext();
    void this.audio.resume();
    const analyser = this.audio.createAnalyser();
    analyser.fftSize = 256;
    this.meterSource = this.audio.createMediaStreamSource(this.mic);
    this.meterSource.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    this.meter = window.setInterval(() => {
      const now = performance.now();
      if (!this.muted) {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        if (Math.sqrt(sum / samples.length) > this.settings().sensitivity) this.lastLoud = now;
      }
      const speaking = now - this.lastLoud < 350;
      if (speaking !== this.isSpeaking) {
        this.isSpeaking = speaking;
        this.events.speaking(speaking);
      }
    }, METER_MS);
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
    const created: MeshPeer = new MeshPeer(id, this.selfId > id, this.iceServers, this.events, () => this.settings().gameMode, () => {
      if (!created.open) {
        created.open = true;
        this.publishAll(id);
      }
      this.applyBitrates();
    });
    this.peers.set(id, created);
    this.senders.set(id, new Map());
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
    this.peers.get(id)?.close();
    this.peers.delete(id);
    this.senders.delete(id);
    this.watchers.delete(id);
    this.videoPaused.delete(id);
    this.asked.delete(id);
    this.events.streams(id, []);
  }

  private publish(id: string, stream: MediaStream) {
    const peer = this.peers.get(id);
    const map = this.senders.get(id);
    if (!peer?.open || !map) return;
    for (const track of stream.getTracks()) {
      if (map.has(track)) continue;
      const sender = peer.pc.addTrack(track, stream);
      map.set(track, sender);
      if (track.kind !== 'video') continue;
      preferEfficientCodec(peer.pc, sender);
      if (this.videoPaused.has(id)) void sender.replaceTrack(null);
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
      if (!this.videoPaused.has(id)) await sender.replaceTrack(track);
      map.delete(previous);
      map.set(track, sender);
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
      if (track.kind === 'video') void sender.replaceTrack(want ? track : null);
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
      for (const [track, sender] of map) {
        const isCamera = track.kind === 'video' && this.camera?.getTracks().includes(track);
        const isScreen = this.screen?.getVideoTracks().includes(track);
        const isMusic = this.radio?.getTracks().includes(track) || this.screen?.getAudioTracks().includes(track);
        if (!isCamera && !isScreen && !isMusic) continue;
        const params = sender.getParameters();
        const wanted: RTCRtpEncodingParameters = isMusic
          ? { maxBitrate: MUSIC_BITRATE }
          : isCamera
            ? cameraEncoding(count, this.lite)
            : { maxBitrate: this.screenBitrate(), maxFramerate: this.screenPreset.frameRate };
        const current = params.encodings?.[0];
        if (!current || Object.entries(wanted).every(([k, v]) => current[k as keyof typeof current] === v)) continue;
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

  stopAll() {
    this.micToken++; // cancela aberturas e trocas de microfone em andamento
    clearInterval(this.meter);
    this.meterSource?.disconnect();
    this.meterSource = null;
    this.syncPeers([]);
    for (const stream of [this.mic, this.camera, this.screen, this.radio]) {
      stream?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
    }
    this.mic = this.camera = this.screen = this.radio = null;
    this.watchers.clear();
    this.isSpeaking = false;
    void this.audio?.close();
    this.audio = null;
  }
}
