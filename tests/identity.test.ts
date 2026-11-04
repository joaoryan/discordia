import { describe, expect, it } from 'vitest';
import { ADDRESS, PUB_KEY, addressOf, createIdentity, seal, unseal } from '../src/lib/identity';

describe('mensagens entre amigos', () => {
  it('só o destinatário abre, e sabe quem mandou', async () => {
    const [ana, bia, caio] = await Promise.all([createIdentity(), createIdentity(), createIdentity()]);
    expect(ana.pub).toMatch(PUB_KEY);
    expect(ana.address).toMatch(ADDRESS);
    expect(await addressOf(ana.pub)).toBe(ana.address);

    const sealed = await seal(ana, bia.pub, { kind: 'text', text: 'bora jogar?' });
    expect(sealed.data).not.toContain('bora');
    expect(await unseal(bia, { ...sealed, from: ana.address })).toEqual({ kind: 'text', text: 'bora jogar?' });
    // Outra pessoa não abre.
    expect(await unseal(caio, { ...sealed, from: ana.address })).toBeNull();
  });

  it('recusa quem tenta se passar por outra pessoa', async () => {
    const [ana, bia, caio] = await Promise.all([createIdentity(), createIdentity(), createIdentity()]);
    const sealed = await seal(caio, bia.pub, { kind: 'text', text: 'sou a Ana' });
    // O Worker carimba o endereço real de quem enviou; a chave do Caio não bate com o da Ana.
    expect(await unseal(bia, { ...sealed, from: ana.address })).toBeNull();
    const tampered = { ...(await seal(ana, bia.pub, { kind: 'text', text: 'oi' })), from: ana.address };
    tampered.data = tampered.data.slice(0, -4) + (tampered.data.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(await unseal(bia, tampered)).toBeNull();
  });
});
