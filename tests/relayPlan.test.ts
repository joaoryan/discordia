import { describe, expect, it } from 'vitest';
import { MAX_PAIRS, planRelays, type LinkInfo, type PlanMember, type RelayPair } from '../src/lib/relayPlan';

const NOW = 10 * 60_000;
const member = (id: string, extra: Partial<PlanMember> = {}): PlanMember => ({ id, channel: 'saguao', help: true, mobile: false, since: 0, drops: 0, ...extra });

/** Monta o mapa: `ok` são pares diretos, `bad` são pares bloqueados. Tudo simétrico. */
function links(ok: string[], bad: string[], rtt: Record<string, number> = {}) {
  const out: Record<string, Record<string, LinkInfo>> = {};
  const set = (pair: string, path: LinkInfo['path']) => {
    const [x, y] = pair.split('');
    const value = { path, rtt: rtt[pair] ?? rtt[`${y}${x}`] ?? 40 };
    (out[x] ??= {})[y] = value;
    (out[y] ??= {})[x] = value;
  };
  ok.forEach((p) => set(p, 'direct'));
  bad.forEach((p) => set(p, 'failed'));
  return out;
}

const plan = (members: PlanMember[], map: ReturnType<typeof links>, previous: RelayPair[] = []) => planRelays({ members, links: map, previous, now: NOW });

describe('planRelays', () => {
  it('sem bloqueio não há plano', () => {
    expect(plan([member('a'), member('b'), member('c')], links(['ab', 'ac', 'bc'], []))).toEqual([]);
  });

  it('A e B bloqueados: C, que alcança os dois, repassa', () => {
    expect(plan([member('a'), member('b'), member('c')], links(['ac', 'bc'], ['ab']))).toEqual([{ a: 'a', b: 'b', via: 'c' }]);
  });

  it('só A e B na sala: o par vai para o TURN', () => {
    expect(plan([member('a'), member('b')], links([], ['ab']))).toEqual([{ a: 'a', b: 'b', via: null }]);
  });

  it('cada par bloqueado tem o próprio repetidor', () => {
    // A✕B via C; D, que só alcança E, fica bloqueado com C: E repassa entre os dois.
    const members = ['a', 'b', 'c', 'd', 'e'].map((id) => member(id));
    const map = links(['ac', 'ae', 'bc', 'be', 'ce', 'de'], ['ab', 'cd']);
    const result = plan(members, map);
    expect(result).toContainEqual({ a: 'c', b: 'd', via: 'e' });
    const ab = result.find((p) => p.a === 'a' && p.b === 'b')!;
    expect(['c', 'e']).toContain(ab.via);
  });

  it('prefere o caminho de menor atraso', () => {
    const members = ['a', 'b', 'c', 'd'].map((id) => member(id));
    const map = links(['ac', 'bc', 'ad', 'bd', 'cd'], ['ab'], { ac: 30, bc: 30, ad: 120, bd: 120 });
    expect(plan(members, map)[0].via).toBe('c');
  });

  it('divide a carga: um repetidor não leva todos os pares', () => {
    // Quatro pessoas bloqueadas entre si (6 pares) e dois amigos de fora que alcançam todos.
    const inside = ['a', 'b', 'c', 'd'];
    const pairs = inside.flatMap((x, i) => inside.slice(i + 1).map((y) => x + y));
    const ok = inside.flatMap((x) => [`${x}x`, `${x}y`]).concat('xy');
    const result = plan([...inside, 'x', 'y'].map((id) => member(id)), links(ok, pairs));
    const count = (id: string) => result.filter((p) => p.via === id).length;
    expect(result).toHaveLength(6);
    expect(count('x')).toBeLessThanOrEqual(MAX_PAIRS);
    expect(count('y')).toBeLessThanOrEqual(MAX_PAIRS);
    expect(count('x') + count('y')).toBe(6);
    expect(Math.abs(count('x') - count('y'))).toBeLessThanOrEqual(1);
  });

  it('acima do limite de pares, o excedente vai para o TURN', () => {
    const inside = ['a', 'b', 'c', 'd'];
    const pairs = inside.flatMap((x, i) => inside.slice(i + 1).map((y) => x + y));
    const result = plan([...inside, 'x'].map((id) => member(id)), links(inside.map((x) => `${x}x`), pairs));
    expect(result.filter((p) => p.via === 'x')).toHaveLength(MAX_PAIRS);
    expect(result.filter((p) => p.via === null)).toHaveLength(6 - MAX_PAIRS);
  });

  it('não usa quem desligou a ajuda, está em outro canal ou não alcança os dois', () => {
    const map = links(['ac', 'bc', 'ad', 'bd', 'ae'], ['ab']);
    const members = [member('a'), member('b'), member('c', { help: false }), member('d', { channel: 'jogos' }), member('e')];
    expect(plan(members, map)).toEqual([{ a: 'a', b: 'b', via: null }]);
  });

  it('evita celular e quem acabou de entrar', () => {
    const map = links(['ac', 'bc', 'ad', 'bd', 'ae', 'be'], ['ab']);
    const members = [member('a'), member('b'), member('c', { mobile: true }), member('d', { since: NOW - 1000 }), member('e')];
    expect(plan(members, map)[0].via).toBe('e');
  });

  it('mantém o repetidor atual se o novo não for bem melhor', () => {
    const members = ['a', 'b', 'c', 'd'].map((id) => member(id));
    const map = links(['ac', 'bc', 'ad', 'bd', 'cd'], ['ab'], { ac: 40, bc: 40, ad: 35, bd: 35 });
    expect(plan(members, map, [{ a: 'a', b: 'b', via: 'c' }])[0].via).toBe('c');
    const muchBetter = links(['ac', 'bc', 'ad', 'bd', 'cd'], ['ab'], { ac: 100, bc: 100, ad: 20, bd: 20 });
    expect(plan(members, muchBetter, [{ a: 'a', b: 'b', via: 'c' }])[0].via).toBe('d');
  });

  it('repetidor que saiu é trocado pela reserva', () => {
    const map = links(['ac', 'bc', 'ad', 'bd'], ['ab']);
    expect(plan([member('a'), member('b'), member('d')], map, [{ a: 'a', b: 'b', via: 'c' }])).toEqual([{ a: 'a', b: 'b', via: 'd' }]);
  });

  it('par que já está no TURN passa para um repetidor quando ele chega', () => {
    const map = links(['ac', 'bc'], []);
    map.a.b = { path: 'turn', rtt: 200 };
    map.b = { ...map.b, a: { path: 'turn', rtt: 200 } };
    expect(plan([member('a'), member('b'), member('c')], map, [{ a: 'a', b: 'b', via: null }])).toEqual([{ a: 'a', b: 'b', via: 'c' }]);
  });

  it('se um dos lados vê o caminho direto, o par não está bloqueado', () => {
    const map = links(['ac', 'bc'], []);
    map.a.b = { path: 'direct', rtt: 10 };
    map.b.a = { path: 'failed', rtt: null };
    expect(plan([member('a'), member('b'), member('c')], map)).toEqual([]);
  });
});
