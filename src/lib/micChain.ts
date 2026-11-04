// Tratamento da voz antes de enviar: tira o ruído do ambiente e só deixa passar a fala.
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorklet from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasm from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasm from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import gateUrl from './voiceGate.worklet.js?url';

export interface MicOptions {
  /** RNNoise: rede neural treinada para separar voz de ruído (teclado, ventilador, TV, rua). */
  voiceIsolation: boolean;
  /** Corta o som enquanto a pessoa não fala. */
  noiseGate: boolean;
  /** Nível (RMS) a partir do qual o som conta como fala. */
  threshold: number;
  /** Volume do microfone, de 0 a 2. */
  volume: number;
}

export interface MicState {
  /** A porta está aberta: há fala passando. */
  open: boolean;
  /** Nível antes da porta, para o medidor das configurações. */
  level: number;
}


const modules = new WeakMap<BaseAudioContext, Promise<void>>();
let rnnoiseBinary: Promise<ArrayBuffer> | null = null;

function loadModules(ctx: AudioContext, rnnoise: boolean) {
  let ready = modules.get(ctx);
  if (!ready) {
    ready = ctx.audioWorklet.addModule(gateUrl);
    modules.set(ctx, ready);
  }
  if (!rnnoise) return ready;
  rnnoiseBinary ??= loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseSimdWasm }).catch((err) => {
    rnnoiseBinary = null; // tenta de novo na próxima vez
    throw err;
  });
  return Promise.all([ready, ctx.audioWorklet.addModule(rnnoiseWorklet), rnnoiseBinary]).then(() => {});
}

/** RNNoise só funciona a 48 kHz, a taxa nativa do Opus. */
export function createVoiceContext() {
  try {
    return new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
  } catch {
    return new AudioContext({ latencyHint: 'interactive' });
  }
}

/**
 * microfone → RNNoise → corta graves (ventilador, mesa) → volume → porta de voz → limitador → envio
 */
export class MicChain {
  readonly output: MediaStream;
  state: MicState = { open: false, level: 0 };
  private nodes: AudioNode[] = [];
  private gain: GainNode;
  private gate: AudioWorkletNode;
  private denoise: RnnoiseWorkletNode | null = null;

  private constructor(ctx: AudioContext, raw: MediaStream, opts: MicOptions, denoise: ArrayBuffer | null, onState: (s: MicState) => void) {
    const source = ctx.createMediaStreamSource(raw);
    if (denoise) this.denoise = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: denoise });

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 85; // abaixo da voz humana mais grave
    highpass.Q.value = 0.7;

    this.gain = ctx.createGain();
    this.gate = new AudioWorkletNode(ctx, 'voice-gate', { channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1] });
    this.gate.port.onmessage = (e) => {
      this.state = e.data;
      onState(this.state);
    };

    // Com volume acima de 100% a voz não pode estourar.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;

    const destination = ctx.createMediaStreamDestination();
    destination.channelCount = 1;
    this.nodes = [source, ...(this.denoise ? [this.denoise] : []), highpass, this.gain, this.gate, limiter, destination];
    for (let i = 1; i < this.nodes.length; i++) this.nodes[i - 1].connect(this.nodes[i]);
    this.output = destination.stream;
    this.update(opts);
  }

  static async create(ctx: AudioContext, raw: MediaStream, opts: MicOptions, onState: (s: MicState) => void = () => {}) {
    const rnnoise = opts.voiceIsolation && ctx.sampleRate === 48_000;
    let binary: ArrayBuffer | null = null;
    try {
      await loadModules(ctx, rnnoise);
      if (rnnoise) binary = await rnnoiseBinary;
    } catch (err) {
      // Sem RNNoise (wasm bloqueado, offline): segue com o resto do tratamento.
      console.warn('supressão de ruído por IA indisponível', err);
      await loadModules(ctx, false);
    }
    return new MicChain(ctx, raw, opts, binary, onState);
  }

  update(opts: Pick<MicOptions, 'noiseGate' | 'threshold' | 'volume'>) {
    this.gain.gain.setTargetAtTime(opts.volume, this.gain.context.currentTime, 0.02);
    this.gate.port.postMessage({ enabled: opts.noiseGate, threshold: opts.threshold });
  }

  close() {
    for (const node of this.nodes) node.disconnect();
    this.gate.port.onmessage = null;
    this.denoise?.destroy();
    this.output.getTracks().forEach((t) => t.stop());
  }
}
