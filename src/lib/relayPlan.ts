// Escolha do repetidor: quem alcança os dois lados de um par bloqueado repassa a voz entre eles.
// Função pura, rodada pelo host da sala; o TURN só entra quando ninguém consegue ajudar.

/** Situação de uma ligação da malha, vista por um dos lados. */
export type PathState = 'checking' | 'direct' | 'failed' | 'turn';

export interface LinkInfo {
  path: PathState;
  rtt: number | null;
}

export interface PlanMember {
  id: string;
  channel: string | null;
  /** A pessoa deixou ligada a opção de ajudar a conectar. */
  help: boolean;
  mobile: boolean;
  /** Quando entrou no canal de voz atual. */
  since: number;
  /** Saídas recentes do canal: quem cai muito é um repetidor ruim. */
  drops: number;
}

/** Par bloqueado e quem repassa entre eles; `via` nulo significa TURN. */
export interface RelayPair {
  a: string;
  b: string;
  via: string | null;
}

export interface PlanInput {
  members: PlanMember[];
  /** O que cada um reportou sobre as próprias ligações: links[quem][com quem]. */
  links: Record<string, Record<string, LinkInfo>>;
  previous: RelayPair[];
  now: number;
}

export const MAX_PAIRS = 4;
const DEFAULT_RTT = 80;
const LOAD_COST = 40;
const MOBILE_COST = 80;
const NEWCOMER_COST = 60;
const NEWCOMER_MS = 2 * 60_000;
const DROP_COST = 100;
/** Só troca de repetidor se o novo for bem melhor: o áudio não pode ficar pulando. */
const SWITCH_GAIN = 0.7;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function planRelays({ members, links, previous, now }: PlanInput): RelayPair[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const view = (from: string, to: string) => links[from]?.[to];
  const direct = (x: string, y: string) => view(x, y)?.path === 'direct' || view(y, x)?.path === 'direct';
  const blocked = (x: string, y: string) => {
    if (direct(x, y)) return false;
    const seen = [view(x, y)?.path, view(y, x)?.path];
    return seen.includes('failed') || seen.includes('turn');
  };
  const rtt = (x: string, y: string) => {
    const values = [view(x, y)?.rtt, view(y, x)?.rtt].filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((s, v) => s + v, 0) / values.length : DEFAULT_RTT;
  };

  const pairs: [string, string][] = [];
  const voice = members.filter((m) => m.channel);
  for (let i = 0; i < voice.length; i++) {
    for (let j = i + 1; j < voice.length; j++) {
      const [x, y] = [voice[i], voice[j]];
      if (x.channel !== y.channel || !blocked(x.id, y.id)) continue;
      pairs.push(x.id < y.id ? [x.id, y.id] : [y.id, x.id]);
    }
  }
  pairs.sort((p, q) => pairKey(...p).localeCompare(pairKey(...q)));

  const load = new Map<string, number>();
  const before = new Map(previous.map((p) => [pairKey(p.a, p.b), p.via]));
  const score = (r: PlanMember, a: string, b: string) =>
    rtt(a, r.id) +
    rtt(r.id, b) +
    LOAD_COST * (load.get(r.id) ?? 0) +
    (r.mobile ? MOBILE_COST : 0) +
    (now - r.since < NEWCOMER_MS ? NEWCOMER_COST : 0) +
    DROP_COST * r.drops;
  const usable = (r: PlanMember | undefined, a: string, b: string, channel: string | null): r is PlanMember =>
    !!r && r.id !== a && r.id !== b && r.help && r.channel === channel && direct(r.id, a) && direct(r.id, b);

  // Quem já repassa conta como carga antes da escolha: assim um par novo não tira o repetidor de outro.
  for (const [a, b] of pairs) {
    const kept = before.get(pairKey(a, b));
    if (kept && usable(byId.get(kept), a, b, byId.get(a)!.channel)) load.set(kept, (load.get(kept) ?? 0) + 1);
  }

  return pairs.map(([a, b]) => {
    const channel = byId.get(a)!.channel;
    const kept = before.get(pairKey(a, b)) ?? null;
    const current = kept ? byId.get(kept) : undefined;
    const keep = usable(current, a, b, channel);
    if (keep) load.set(current.id, load.get(current.id)! - 1); // a nota do atual não conta ele mesmo duas vezes

    const candidates = voice.filter((r) => usable(r, a, b, channel) && (r.id === current?.id || (load.get(r.id) ?? 0) < MAX_PAIRS));
    let best: PlanMember | null = null;
    for (const r of candidates) if (!best || score(r, a, b) < score(best, a, b)) best = r;

    let via = best?.id ?? null;
    if (keep && best && best.id !== current.id && score(best, a, b) >= SWITCH_GAIN * score(current, a, b)) via = current.id;
    if (via) load.set(via, (load.get(via) ?? 0) + 1);
    return { a, b, via };
  });
}
