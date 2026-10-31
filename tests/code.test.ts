import { describe, expect, it } from 'vitest';
import { ALPHABET, formatCode, generateCode, normalizeCode } from '../src/lib/code';

describe('código de sala', () => {
  it('gera 6 símbolos do alfabeto sem ambíguos', () => {
    expect(ALPHABET).toHaveLength(31);
    for (let i = 0; i < 500; i++) expect(generateCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
  });

  it('aceita digitação com hífen, espaço e minúsculas', () => {
    expect(normalizeCode('ab7-k2q')).toBe('AB7K2Q');
    expect(normalizeCode(' AB7 K2Q ')).toBe('AB7K2Q');
  });

  it('recusa tamanho errado e símbolos ambíguos', () => {
    expect(normalizeCode('AB7K2')).toBeNull();
    expect(normalizeCode('AB7K2O')).toBeNull();
    expect(normalizeCode('AB7K21')).toBeNull();
  });

  it('formata com hífen', () => expect(formatCode('AB7K2Q')).toBe('AB7-K2Q'));
});
