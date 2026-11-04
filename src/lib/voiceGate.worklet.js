// Porta de voz: roda na thread de áudio, então não sofre com timers lentos de abas em segundo plano.
// Arquivo à parte (e não blob:) porque a CSP de produção só aceita scripts da própria origem.
class VoiceGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = true;
    this.threshold = 0.02;
    this.env = 0;        // energia suavizada (~15 ms)
    this.gain = 0;       // ganho aplicado, com rampas para não estalar
    this.open = false;
    this.heldUntil = 0;
    this.lastReport = 0;
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    if (!input.length) return true;
    const n = input[0].length;
    let sum = 0;
    for (const ch of input) for (let i = 0; i < n; i++) sum += ch[i] * ch[i];
    const power = sum / (n * input.length);
    const alpha = 1 - Math.exp(-n / (sampleRate * 0.015));
    this.env += (power - this.env) * alpha;
    const level = Math.sqrt(this.env);

    // Histerese: fecha só bem abaixo de onde abriu, e espera um pouco no fim da frase.
    const now = currentTime;
    if (level > this.threshold) this.heldUntil = now + 0.3;
    const open = level > this.threshold || (this.open && now < this.heldUntil && level > this.threshold * 0.5);
    if (open !== this.open || now - this.lastReport > 0.08) {
      this.open = open;
      this.lastReport = now;
      this.port.postMessage({ open, level });
    }

    const target = !this.enabled || open ? 1 : 0;
    // Abre em ~5 ms para não comer o começo da palavra; fecha em ~60 ms, sem corte seco.
    const step = 1 - Math.exp(-1 / (sampleRate * (target > this.gain ? 0.005 : 0.06)));
    for (let c = 0; c < output.length; c++) {
      const src = input[c] ?? input[0], dst = output[c];
      let g = this.gain;
      for (let i = 0; i < n; i++) {
        g += (target - g) * step;
        dst[i] = src[i] * g;
      }
      if (c === output.length - 1) this.gain = g;
    }
    return true;
  }
}
registerProcessor('voice-gate', VoiceGate);
