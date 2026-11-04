import { describe, expect, it } from 'vitest';
import { downloadFor } from '../src/lib/download';

describe('botão de baixar', () => {
  it('escolhe o instalador do sistema', () => {
    expect(downloadFor('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')?.url).toMatch(/Discordia-Windows\.exe$/);
    expect(downloadFor('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605')?.url).toMatch(/Discordia-Mac\.dmg$/);
    expect(downloadFor('Mozilla/5.0 (X11; Linux x86_64) Firefox/132')?.url).toMatch(/Discordia-Linux\.AppImage$/);
    expect(downloadFor('', 'Windows')?.os).toBe('Windows');
  });

  it('não aparece no celular', () => {
    expect(downloadFor('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537')).toBeNull();
    expect(downloadFor('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBeNull();
    expect(downloadFor('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)')).toBeNull();
  });
});
