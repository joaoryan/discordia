// Sons sintetizados: nenhum arquivo para baixar e nada copiado de outro app.
let ctx: AudioContext | null = null;

export function setSoundOutput(deviceId: string) {
  if (ctx && 'setSinkId' in ctx) void (ctx as any).setSinkId(deviceId).catch(() => {});
}

function tone(freqs: number[], step = 0.09) {
  ctx ??= new AudioContext();
  const start = ctx.currentTime + 0.01;
  freqs.forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    const at = start + i * step;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.08, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + step * 1.6);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(at);
    osc.stop(at + step * 1.7);
  });
}

export const sounds = {
  join: () => tone([523, 784]),
  leave: () => tone([659, 440]),
  mute: () => tone([392], 0.07),
  unmute: () => tone([587], 0.07),
  message: () => tone([880], 0.06),
  mention: () => tone([784, 1047], 0.07),
};
