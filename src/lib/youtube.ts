// Integração com o player oficial: cada pessoa toca o próprio, e a sala só combina o que tocar.
import type { RoomSession } from './session.svelte';

const MAX_PLAYLIST = 100;
const PLAYLIST_TIMEOUT_MS = 12_000;
const TITLE_CONCURRENCY = 6;

export function parseLink(input: string) {
  const text = input.trim();
  if (/^[\w-]{11}$/.test(text)) return { videoId: text, list: null };
  try {
    const url = new URL(text);
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(url.hostname)) return null;
    const videoId =
      url.searchParams.get('v') ??
      (url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1]);
    const list = url.searchParams.get('list');
    const valid = videoId && /^[\w-]{11}$/.test(videoId) ? videoId : null;
    return valid || list ? { videoId: valid, list } : null;
  } catch {
    return null;
  }
}

let api: Promise<any> | null = null;

export function loadYouTube() {
  api ??= new Promise((resolve, reject) => {
    const w = window as any;
    if (w.YT?.Player) return resolve(w.YT);
    w.onYouTubeIframeAPIReady = () => resolve(w.YT);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      api = null;
      reject(new Error('YouTube indisponível'));
    };
    document.head.append(script);
  });
  return api;
}

export async function fetchTitle(videoId: string) {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
    const res = await fetch(url);
    return res.ok ? String((await res.json()).title) : '';
  } catch {
    return '';
  }
}

/** Lê os ids com um player de verdade: a alternativa seria exigir uma chave da API. */
async function readPlaylist(list: string) {
  const YT = await loadYouTube();
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:70;width:200px;height:200px';
  const target = document.createElement('div');
  box.append(target);
  document.body.append(box);

  return new Promise<string[]>((resolve) => {
    const done = (ids: string[]) => {
      clearTimeout(timer);
      player?.destroy();
      box.remove();
      resolve(ids);
    };
    const timer = setTimeout(() => done([]), PLAYLIST_TIMEOUT_MS);
    const player = new YT.Player(target, {
      width: 200,
      height: 200,
      playerVars: { origin: location.origin },
      events: {
        onReady: () => player.cuePlaylist({ listType: 'playlist', list }),
        onStateChange: () => {
          const ids = player.getPlaylist?.();
          if (ids?.length) done(ids);
        },
        onError: () => done([]),
      },
    });
  });
}

async function withTitles(ids: string[]) {
  const tracks = ids.map((videoId) => ({ videoId, title: '' }));
  let next = 0;
  await Promise.all(
    Array.from({ length: TITLE_CONCURRENCY }, async () => {
      while (next < tracks.length) {
        const track = tracks[next++];
        track.title = await fetchTitle(track.videoId);
      }
    }),
  );
  return tracks;
}

export async function addFromLink(session: RoomSession, link: string) {
  const parsed = parseLink(link);
  if (!parsed) return session.toast('Cole um link de vídeo ou playlist do YouTube.');
  let ids = parsed.videoId ? [parsed.videoId] : [];
  if (parsed.list) {
    session.toast('Lendo a playlist…');
    const listed = await readPlaylist(parsed.list).catch(() => []);
    if (listed.length) ids = listed.slice(0, MAX_PLAYLIST);
    else if (!ids.length) return session.toast('Não foi possível ler essa playlist. Ela precisa ser pública.');
  }
  session.radioCmd({ cmd: 'add', tracks: await withTitles(ids) });
}
