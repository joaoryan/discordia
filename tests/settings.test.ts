import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, loadRecent, loadSettings, rememberRoom, saveSettings } from '../src/lib/settings';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

const saved = () => JSON.parse(store.get('discordia.settings')!);

describe('ajustes salvos', () => {
  beforeEach(() => store.clear());

  it('sem nada salvo, usa os padrões', () => {
    expect(loadSettings()).toEqual(defaultSettings);
  });

  it('ajustes antigos recebem o volume e a sensibilidade novos uma vez, e o resto fica', () => {
    store.set('discordia.settings', JSON.stringify({ micVolume: 1, sensitivity: 0.02, echoCancellation: false }));
    const s = loadSettings();
    expect(s.micVolume).toBe(0.5);
    expect(s.sensitivity).toBe(0.026);
    expect(s.echoCancellation).toBe(false);
    expect(saved().version).toBe(1);
  });

  it('depois da migração, o que a pessoa escolher é respeitado', () => {
    saveSettings({ ...defaultSettings, micVolume: 1.4, sensitivity: 0.05 });
    const s = loadSettings();
    expect(s.micVolume).toBe(1.4);
    expect(s.sensitivity).toBe(0.05);
    expect('version' in s).toBe(false);
  });
});

describe('salas recentes', () => {
  beforeEach(() => store.clear());

  it('guarda a chave de quem criou e não a perde ao entrar de novo', () => {
    rememberRoom('ABCDEF', 'Sala de Ana', 'chave-de-dono');
    rememberRoom('GHJKLM', 'Sala de Bia');
    rememberRoom('ABCDEF', 'Sala de Ana'); // welcome do próprio host, sem chave
    const [first, second] = loadRecent();
    expect(first).toMatchObject({ code: 'ABCDEF', key: 'chave-de-dono' });
    expect(second.code).toBe('GHJKLM');
    expect(second).not.toHaveProperty('key');
  });
});
