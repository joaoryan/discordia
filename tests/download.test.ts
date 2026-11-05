import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFor, latestVersion, parseVersion } from '../src/lib/download';

describe('botão de baixar', () => {
  it('escolhe o instalador do sistema', () => {
    expect(downloadFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')?.url).toMatch(/Discordia-Windows\.exe$/);
    expect(downloadFor('Mozilla/5.0 (X11; Linux x86_64) Firefox/132')?.url).toMatch(/Discordia-Linux\.AppImage$/);
    expect(downloadFor('', 'Windows')?.os).toBe('Windows');
  });

  it('não aparece no celular nem no Mac', () => {
    expect(downloadFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605')).toBeNull();
    expect(downloadFor('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537')).toBeNull();
    expect(downloadFor('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBeNull();
    expect(downloadFor('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBeNull();
  });

  it('lê a versão da tag do Release', () => {
    expect(parseVersion('v1.1.0')).toBe('1.1.0');
    expect(parseVersion('2.0.10')).toBe('2.0.10');
    expect(parseVersion('nightly')).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe('versão do último Release', () => {
  const store = new Map<string, string>();
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    store.clear();
  });

  function stub(tags: string[]) {
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: tags.shift() }) }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('lembra por 10 minutos e depois consulta de novo', async () => {
    vi.useFakeTimers();
    const fetch = stub(['v1.1.0', 'v1.1.1']);
    expect(await latestVersion()).toBe('1.1.0');
    vi.advanceTimersByTime(9 * 60 * 1000);
    expect(await latestVersion()).toBe('1.1.0');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(await latestVersion()).toBe('1.1.1');
  });

  it('ignora o formato antigo, guardado sem data', async () => {
    stub(['v1.1.1']);
    store.set('discordia.latestVersion', '1.1.0');
    expect(await latestVersion()).toBe('1.1.1');
  });
});
