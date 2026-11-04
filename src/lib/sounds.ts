// Sons sintetizados: nenhum arquivo para baixar e nada copiado de outro app.
// Identidade sonora: notas da escala pentatônica de Mi, timbre de sino suave (seno + harmônico)
// com um eco curto. Subir = algo começou ou chegou; descer = algo terminou ou saiu.

export type SoundId =
  | 'join'
  | 'leave'
  | 'userJoin'
  | 'userLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'pttOn'
  | 'pttOff'
  | 'message'
  | 'mention'
  | 'invite'
  | 'direct'
  | 'streamStart'
  | 'streamStop'
  | 'streamOther'
  | 'memberEnter'
  | 'disconnect'
  | 'reconnect'
  | 'alert';

export const SOUND_GROUPS: { title: string; sounds: { id: SoundId; label: string }[] }[] = [
  {
    title: 'Voz',
    sounds: [
      { id: 'join', label: 'Você entra na voz' },
      { id: 'leave', label: 'Você sai da voz' },
      { id: 'userJoin', label: 'Alguém entra no seu canal' },
      { id: 'userLeave', label: 'Alguém sai do seu canal' },
      { id: 'mute', label: 'Silenciar microfone' },
      { id: 'unmute', label: 'Ativar microfone' },
      { id: 'deafen', label: 'Ensurdecer' },
      { id: 'undeafen', label: 'Voltar a ouvir' },
      { id: 'pttOn', label: 'Apertar para falar: abriu' },
      { id: 'pttOff', label: 'Apertar para falar: fechou' },
    ],
  },
  {
    title: 'Mensagens',
    sounds: [
      { id: 'message', label: 'Nova mensagem' },
      { id: 'mention', label: 'Menção a você' },
      { id: 'direct', label: 'Mensagem de um amigo' },
      { id: 'invite', label: 'Convite de um amigo para uma sala' },
    ],
  },
  {
    title: 'Transmissão',
    sounds: [
      { id: 'streamStart', label: 'Você começa a transmitir' },
      { id: 'streamStop', label: 'Sua transmissão termina' },
      { id: 'streamOther', label: 'Alguém começa a transmitir no seu canal' },
    ],
  },
  {
    title: 'Sala e conexão',
    sounds: [
      { id: 'memberEnter', label: 'Alguém entra na sala' },
      { id: 'disconnect', label: 'Conexão caiu' },
      { id: 'reconnect', label: 'Conexão voltou' },
      { id: 'alert', label: 'Aviso do host (silenciado, expulso, sala encerrada)' },
    ],
  },
];

interface Note {
  /** Frequência em Hz; `to` faz um deslize até outra frequência. */
  f: number;
  to?: number;
  /** Início e duração, em segundos. */
  at: number;
  dur: number;
  gain?: number;
  wave?: OscillatorType;
}

// Pentatônica de Mi: E G# B C# E — soa agradável em qualquer combinação.
const E4 = 329.63, Gs4 = 415.3, B4 = 493.88, Cs5 = 554.37;
const E5 = 659.25, Gs5 = 830.61, B5 = 987.77, Cs6 = 1108.73, E6 = 1318.51;

const seq = (freqs: number[], step: number, dur = step * 1.8, gain = 1, wave: OscillatorType = 'sine'): Note[] =>
  freqs.map((f, i) => ({ f, at: i * step, dur, gain, wave }));

const SOUNDS: Record<SoundId, Note[]> = {
  join: seq([E5, Gs5, B5], 0.07, 0.22),
  leave: seq([B5, Gs5, E5], 0.07, 0.22),
  userJoin: seq([Gs5, B5], 0.08, 0.2, 0.75),
  userLeave: seq([B5, Gs5], 0.08, 0.2, 0.75),
  mute: [{ f: B4, to: E4, at: 0, dur: 0.12, gain: 0.9, wave: 'triangle' }],
  unmute: [{ f: E5, to: B5, at: 0, dur: 0.12, gain: 0.9, wave: 'triangle' }],
  deafen: seq([Gs4, E4], 0.06, 0.16, 0.9, 'triangle'),
  undeafen: seq([E4, Gs4, B4], 0.05, 0.14, 0.9, 'triangle'),
  pttOn: [{ f: Cs6, at: 0, dur: 0.035, gain: 0.35 }],
  pttOff: [{ f: Gs5, at: 0, dur: 0.035, gain: 0.3 }],
  message: [{ f: B5, to: E6, at: 0, dur: 0.09, gain: 0.7 }],
  mention: [...seq([E6, B5, E6], 0.075, 0.16, 0.9), { f: E5, at: 0, dur: 0.3, gain: 0.25 }],
  direct: seq([Gs5, Cs6], 0.07, 0.14, 0.75),
  // Convite: chamado ascendente e um eco grave, para se destacar de uma mensagem comum.
  invite: [...seq([E5, B5, E6, B5, E6], 0.08, 0.2, 0.85), { f: E4, at: 0, dur: 0.5, gain: 0.25 }],
  streamStart: seq([E5, Gs5, B5, E6], 0.06, 0.24),
  streamStop: seq([E6, B5, E5], 0.06, 0.2),
  streamOther: [...seq([B5, Cs6], 0.09, 0.22, 0.7), { f: E5, at: 0.09, dur: 0.3, gain: 0.2 }],
  memberEnter: [{ f: Cs6, at: 0, dur: 0.18, gain: 0.45 }],
  disconnect: seq([Cs5, B4, Gs4, E4], 0.09, 0.26, 0.9, 'triangle'),
  reconnect: seq([E4, B4, E5], 0.07, 0.2, 0.9),
  alert: seq([B4, B4], 0.14, 0.12, 0.9, 'square'),
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sinkId = '';

function context() {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    // Eco curto e baixo: dá corpo sem virar reverb.
    const echo = ctx.createDelay(0.5);
    echo.delayTime.value = 0.11;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.22;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    master.connect(ctx.destination);
    master.connect(echo).connect(tone).connect(feedback).connect(echo);
    tone.connect(ctx.destination);
    if (sinkId) setSoundOutput(sinkId);
  }
  return ctx;
}

/**
 * O navegador só deixa tocar som depois de um clique ou tecla. Liga o áudio no primeiro gesto,
 * para os avisos funcionarem depois com a aba em segundo plano.
 */
export function unlockSounds() {
  const unlock = () => {
    void context().resume();
    removeEventListener('pointerdown', unlock, true);
    removeEventListener('keydown', unlock, true);
  };
  addEventListener('pointerdown', unlock, true);
  addEventListener('keydown', unlock, true);
}

export function setSoundOutput(deviceId: string) {
  sinkId = deviceId;
  if (ctx && 'setSinkId' in ctx) void (ctx as any).setSinkId(deviceId).catch(() => {});
}

export function playSound(id: SoundId, volume = 1) {
  const audio = context();
  if (audio.state !== 'running') void audio.resume();
  const start = audio.currentTime + 0.01;
  const level = 0.09 * volume;
  for (const note of SOUNDS[id]) {
    const at = start + note.at;
    const end = at + note.dur;
    const peak = level * (note.gain ?? 1) * (note.wave === 'square' ? 0.35 : note.wave === 'triangle' ? 0.8 : 1);
    const env = audio.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(master!);

    // Fundamental + uma oitava acima bem baixa: timbre de sino, não de bipe.
    for (const [mult, share] of [[1, 1], [2, 0.18]] as const) {
      const osc = audio.createOscillator();
      osc.type = note.wave ?? 'sine';
      osc.frequency.setValueAtTime(note.f * mult, at);
      if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to * mult, at + note.dur * 0.7);
      const mix = audio.createGain();
      mix.gain.value = share;
      osc.connect(mix).connect(env);
      osc.start(at);
      osc.stop(end + 0.02);
    }
  }
}
