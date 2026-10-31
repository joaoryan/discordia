// Guarda a sala do host para sobreviver ao F5. sessionStorage é por aba e some ao fechá-la:
// é justamente a diferença entre recarregar e ir embora.
import type { HostSnapshot } from './host';

const KEY = 'discordia.room';
const MAX_ATTACHMENTS = 3 * 1024 * 1024; // a cota do sessionStorage é de ~5 MB

export interface SavedRoom {
  code: string;
  key: string;
  name: string;
  active: string;
  voice: { channel: string; muted: boolean; deafened: boolean } | null;
  host: HostSnapshot;
}

function dropAttachments(room: SavedRoom, keep: number) {
  let left = keep;
  const messages = room.host.history.slice().sort((a, b) => b.ts - a.ts);
  for (const message of messages) {
    const data = message.attachment?.data;
    if (!data) continue;
    if (data.length <= left) left -= data.length;
    else message.attachment = { ...message.attachment!, data: null };
  }
}

export function saveRoom(room: SavedRoom) {
  dropAttachments(room, MAX_ATTACHMENTS);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(room));
  } catch {
    try {
      dropAttachments(room, 0);
      sessionStorage.setItem(KEY, JSON.stringify(room));
    } catch {
      // Sem espaço: a sala volta sem o histórico guardado.
      sessionStorage.removeItem(KEY);
    }
  }
}

export function loadRoom(): SavedRoom | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedRoom) : null;
  } catch {
    return null;
  }
}

export function clearRoom() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Navegação privada: nada foi guardado.
  }
}
