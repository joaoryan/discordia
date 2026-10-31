// Fragmenta JSON para o DataChannel: 16 KB é o tamanho seguro entre navegadores.
const CHUNK = 16_000;

export function encodeFrames(json: string, id: number) {
  if (json.length <= CHUNK) return ['m' + json];
  const total = Math.ceil(json.length / CHUNK);
  const frames: string[] = [];
  for (let i = 0; i < total; i++) {
    frames.push(`c${id}:${i}:${total}:${json.slice(i * CHUNK, (i + 1) * CHUNK)}`);
  }
  return frames;
}

export class FrameDecoder {
  private parts = new Map<string, { got: string[]; count: number }>();
  private size = 0;

  constructor(private maxBytes: number) {}

  /** Devolve o JSON completo, ou null enquanto faltam pedaços ou o quadro é inválido. */
  push(frame: string): string | null {
    if (frame[0] === 'm') return frame.slice(1);
    if (frame[0] !== 'c') return null;

    const head = frame.match(/^c(\d+):(\d+):(\d+):/);
    if (!head) return null;
    const [prefix, id, index, totalText] = head;
    const total = Number(totalText);
    const i = Number(index);
    if (i >= total || total * CHUNK > this.maxBytes) return null;

    const body = frame.slice(prefix.length);
    this.size += body.length;
    if (this.size > this.maxBytes) {
      this.parts.clear();
      this.size = 0;
      return null;
    }
    let entry = this.parts.get(id);
    if (!entry) this.parts.set(id, (entry = { got: new Array(total), count: 0 }));
    if (entry.got[i] === undefined) entry.count++;
    entry.got[i] = body;
    if (entry.count < total) return null;

    this.parts.delete(id);
    this.size -= entry.got.reduce((sum, part) => sum + part.length, 0);
    return entry.got.join('');
  }
}
