import { describe, expect, it } from 'vitest';
import { codeFromArgs, keyName } from '../desktop/src/keys';

describe('app de computador', () => {
  it('traduz a tecla de apertar para falar para o hook global', () => {
    expect(keyName('KeyV')).toBe('V');
    expect(keyName('Digit4')).toBe('4');
    expect(keyName('Numpad0')).toBe('Numpad0');
    expect(keyName('F13')).toBe('F13');
    expect(keyName('CapsLock')).toBe('CapsLock');
    expect(keyName('AltLeft')).toBe('Alt');
    expect(keyName('ControlRight')).toBe('CtrlRight');
    expect(keyName('MediaPlayPause')).toBeNull();
  });

  it('lê o código da sala de um link discordia://', () => {
    expect(codeFromArgs(['/opt/Discordia/discordia', 'discordia://AB7-K2Q'])).toBe('AB7K2Q');
    expect(codeFromArgs(['discordia://join/ab7k2q/'])).toBe('AB7K2Q');
    expect(codeFromArgs(['--hidden'])).toBeNull();
    expect(codeFromArgs(['discordia://AB7-K2Q/../../etc'])).toBeNull();
  });
});
