<script lang="ts">
  import { onMount } from 'svelte';
  import { formatBytes } from '../lib/format';
  import type { PeerStats } from '../lib/media';
  import { jsHeap } from '../lib/metrics';
  import type { RoomSession } from '../lib/session.svelte';

  const SAMPLE_MS = 2000;
  const PRESSURE = {
    nominal: ['Normal', 'ok'],
    fair: ['Moderada', 'ok'],
    serious: ['Alta', 'warn'],
    critical: ['Crítica', 'bad'],
  } as const;
  const LIMITS: Record<string, string> = { cpu: 'processador', bandwidth: 'internet', other: 'navegador' };

  let { session }: { session: RoomSession } = $props();

  let heap = $state(jsHeap());
  let lag = $state(0);
  let upload = $state(0);
  let download = $state(0);
  let ping = $state<number | null>(null);
  let loss = $state(0);
  let encodeMs = $state<number | null>(null);
  let rows = $state<{ name: string; relay: boolean; sends: string[]; gets: string[]; limit: string | null; codec: string | null }[]>([]);

  const pressure = $derived(session.pressure ? PRESSURE[session.pressure] : null);
  const memory = (navigator as any).deviceMemory as number | undefined;

  onMount(() => {
    let last: Record<string, PeerStats> = {};
    let lastAt = performance.now();
    let worstLag = 0;
    let expected = performance.now() + 250;

    // Atraso da thread principal: se ela trava, interface e sinalização sentem.
    const probe = window.setInterval(() => {
      worstLag = Math.max(worstLag, performance.now() - expected);
      expected = performance.now() + 250;
    }, 250);

    async function sample() {
      const stats = await session.media.stats();
      const now = performance.now();
      const seconds = (now - lastAt) / 1000;
      const list = Object.entries(stats);
      const sum = (read: (s: PeerStats) => number) => list.reduce((total, [, s]) => total + read(s), 0);
      const prev = (id: string) => last[id];

      upload = Math.max(0, list.reduce((t, [id, s]) => t + s.outbound - (prev(id)?.outbound ?? s.outbound), 0)) * 8 / 1000 / seconds;
      download = Math.max(0, list.reduce((t, [id, s]) => t + s.inbound - (prev(id)?.inbound ?? s.inbound), 0)) * 8 / 1000 / seconds;
      const rtts = list.flatMap(([, s]) => (s.rtt === null ? [] : [s.rtt]));
      ping = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
      const received = sum((s) => s.packetsReceived);
      const lost = sum((s) => s.packetsLost);
      loss = received + lost ? (lost / (received + lost)) * 100 : 0;

      const frames = list.reduce((t, [id, s]) => t + s.framesEncoded - (prev(id)?.framesEncoded ?? s.framesEncoded), 0);
      const spent = list.reduce((t, [id, s]) => t + s.encodeSeconds - (prev(id)?.encodeSeconds ?? s.encodeSeconds), 0);
      encodeMs = frames > 0 ? (spent / frames) * 1000 : null;

      rows = list.map(([id, s]) => ({
        name: session.members.find((m) => m.id === id)?.name ?? id,
        relay: s.relay,
        sends: s.videoOut,
        gets: s.videoIn,
        limit: s.limit,
        codec: s.codec,
      }));
      heap = jsHeap();
      lag = Math.max(0, worstLag);
      worstLag = 0;
      last = stats;
      lastAt = now;
    }

    void sample();
    const timer = window.setInterval(() => void sample(), SAMPLE_MS);
    return () => {
      clearInterval(timer);
      clearInterval(probe);
    };
  });

  const rate = (kbps: number) => (kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`);
</script>

<section class="metrics" aria-label="Métricas de desempenho">
  <h3>Desempenho {#if session.lite}<em>economia</em>{/if}</h3>
  <dl>
    <dt>Pressão da CPU</dt>
    <dd class={pressure?.[1] ?? ''}>{pressure?.[0] ?? 'Indisponível'}</dd>
    <dt>Memória JS</dt>
    <dd>{heap ? formatBytes(heap.used) : 'Indisponível'}</dd>
    {#if memory}<dt>RAM do aparelho</dt><dd>~{memory} GB</dd>{/if}
    <dt>Atraso da interface</dt>
    <dd class={lag > 100 ? 'warn' : ''}>{Math.round(lag)} ms</dd>
    <dt>Ping</dt>
    <dd class={(ping ?? 0) > 200 ? 'warn' : ''}>{ping === null ? '—' : `${Math.round(ping)} ms`}</dd>
    <dt>Upload</dt>
    <dd>{rate(upload)}</dd>
    <dt>Download</dt>
    <dd>{rate(download)}</dd>
    <dt>Perda de pacotes</dt>
    <dd class={loss > 3 ? 'warn' : ''}>{loss.toFixed(1)}%</dd>
    {#if encodeMs !== null}<dt>Codificação</dt><dd>{encodeMs.toFixed(1)} ms/quadro</dd>{/if}
  </dl>

  {#each rows as row}
    <div class="peer">
      <strong>{row.name}</strong>
      <small>{row.relay ? 'via relay' : 'direto'}{row.codec ? ` · ${row.codec}` : ''}</small>
      {#each row.sends as item}<small>↑ {item}</small>{/each}
      {#each row.gets as item}<small>↓ {item}</small>{/each}
      {#if row.limit}<small class="warn">Limitado por {LIMITS[row.limit] ?? row.limit}</small>{/if}
    </div>
  {/each}
  <p>CPU e RAM exatas: <kbd>Shift</kbd>+<kbd>Esc</kbd> no Chrome ou Edge.</p>
</section>

<style>
  .metrics {
    position: fixed;
    top: 56px;
    right: 12px;
    z-index: 20;
    width: 236px;
    max-height: calc(100dvh - 72px);
    padding: 12px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-float);
    box-shadow: var(--shadow);
    font-size: 12.5px;
  }

  h3 {
    display: flex;
    justify-content: space-between;
    margin: 0 0 8px;
    font-size: 13px;
  }

  em {
    color: var(--accent);
    font-style: normal;
    font-weight: 600;
  }

  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3px 10px;
    margin: 0;
  }

  dt {
    color: var(--text-mute);
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    text-align: right;
  }

  .ok {
    color: var(--ok);
  }

  .warn {
    color: var(--accent);
  }

  .bad {
    color: var(--danger);
  }

  .peer {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }

  .peer small {
    display: block;
    color: var(--text-mute);
  }

  .peer small.warn {
    color: var(--accent);
  }

  p {
    margin: 8px 0 0;
    color: var(--text-mute);
    font-size: 11.5px;
  }

  kbd {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--bg-active);
    font: inherit;
  }
</style>
