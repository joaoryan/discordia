export function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || '?';
}

export function formatTime(ts: number) {
  const date = new Date(ts);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date().toDateString() === date.toDateString();
  return today ? `Hoje às ${time}` : `${date.toLocaleDateString('pt-BR')} ${time}`;
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export type Segment = { kind: 'text' | 'link' | 'mention'; value: string };

/** Quebra o texto em pedaços; o Svelte renderiza cada um sem interpretar HTML. */
export function segments(text: string, names: string[]): Segment[] {
  const mentions = names
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = mentions.length ? `https?://[^\\s<]+|@(?:${mentions.join('|')})` : 'https?://[^\\s<]+';
  const result: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(pattern, 'gi'))) {
    const index = match.index;
    if (index > last) result.push({ kind: 'text', value: text.slice(last, index) });
    result.push({ kind: match[0][0] === '@' ? 'mention' : 'link', value: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) result.push({ kind: 'text', value: text.slice(last) });
  return result;
}

/** Reduz para 96×96 para o avatar caber no localStorage e nas mensagens da sala. */
export function resizeAvatar(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 96;
      const side = Math.min(img.width, img.height);
      canvas.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 96, 96);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('imagem inválida'));
    };
    img.src = url;
  });
}

export function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
