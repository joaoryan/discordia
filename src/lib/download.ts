// Instaladores do app de computador, publicados pelo GitHub Actions a cada tag v*.
const RELEASES = 'https://github.com/joaoryan/discordia/releases/latest';

export interface DesktopDownload {
  os: string;
  url: string;
}

const FILES: Record<string, DesktopDownload> = {
  windows: { os: 'Windows', url: `${RELEASES}/download/Discordia-Windows.exe` },
  linux: { os: 'Linux', url: `${RELEASES}/download/Discordia-Linux.AppImage` },
};

export const allDownloads = RELEASES;

const LATEST_API = 'https://api.github.com/repos/joaoryan/discordia/releases/latest';
const VERSION_KEY = 'discordia.latestVersion';
// Curto: o sessionStorage sobrevive ao F5, e uma versão nova tem de aparecer sem fechar a aba.
const VERSION_TTL_MS = 10 * 60 * 1000;

/** "v1.2.0" → "1.2.0"; qualquer outra coisa vira null. */
export function parseVersion(tag: unknown): string | null {
  const match = typeof tag === 'string' ? /^v?(\d+\.\d+\.\d+)$/.exec(tag.trim()) : null;
  return match ? match[1] : null;
}

/** Versão do último Release, para o botão dizer o que vai baixar. Guarda na aba por 10 min para não repetir a consulta. */
export async function latestVersion(): Promise<string | null> {
  try {
    const cached = JSON.parse(sessionStorage.getItem(VERSION_KEY) ?? 'null') as { version?: string; at?: number } | null;
    if (cached?.version && Date.now() - (cached.at ?? 0) < VERSION_TTL_MS) return cached.version;
  } catch {}
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const version = parseVersion(((await res.json()) as { tag_name?: unknown }).tag_name);
    try {
      if (version) sessionStorage.setItem(VERSION_KEY, JSON.stringify({ version, at: Date.now() }));
    } catch {}
    return version;
  } catch {
    return null;
  }
}

/** O instalador para o sistema de quem está vendo; nada em celular nem no Mac, que não têm app. */
export function downloadFor(userAgent: string, platform = ''): DesktopDownload | null {
  const ua = `${platform} ${userAgent}`.toLowerCase();
  if (/android|iphone|ipad|ipod|mobile/.test(ua)) return null;
  if (ua.includes('mac')) return null;
  if (ua.includes('win')) return FILES.windows;
  if (ua.includes('linux') || ua.includes('x11')) return FILES.linux;
  return null;
}
