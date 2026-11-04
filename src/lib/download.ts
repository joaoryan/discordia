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

/** O instalador para o sistema de quem está vendo; nada em celular nem no Mac, que não têm app. */
export function downloadFor(userAgent: string, platform = ''): DesktopDownload | null {
  const ua = `${platform} ${userAgent}`.toLowerCase();
  if (/android|iphone|ipad|ipod|mobile/.test(ua)) return null;
  if (ua.includes('mac')) return null;
  if (ua.includes('win')) return FILES.windows;
  if (ua.includes('linux') || ua.includes('x11')) return FILES.linux;
  return null;
}
