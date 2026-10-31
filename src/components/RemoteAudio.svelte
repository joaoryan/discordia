<script lang="ts">
  import type { RoomSession } from '../lib/session.svelte';

  let { session }: { session: RoomSession } = $props();

  interface Output {
    stream: MediaStream;
    volume: number;
    sink: string;
  }

  const outputs = $derived(
    Object.entries(session.remote).flatMap(([id, streams]) => {
      const member = session.members.find((m) => m.id === id);
      const audio = session.audioOf(member?.name ?? '');
      return streams.map((stream) => {
        const isRadio = stream.id === member?.voice.radio;
        const volume = stream.id === member?.voice.screen ? audio.screenVolume : audio.volume;
        return {
          stream,
          // Rádio é controlado no painel: silenciar a voz da DJ não precisa calar a música.
          muted: session.voice.deafened || (isRadio ? session.settings.radioMuted : audio.muted),
          volume: isRadio ? session.settings.radioVolume : volume,
        };
      });
    }),
  );

  function play(el: HTMLAudioElement, output: Output) {
    let sink = '';
    // Roda a cada mudança na sala, inclusive quando alguém começa a falar: só toca no que mudou.
    function apply(next: Output) {
      if (el.srcObject !== next.stream) el.srcObject = next.stream;
      if (el.volume !== next.volume) el.volume = next.volume;
      if (next.sink !== sink && 'setSinkId' in el) {
        sink = next.sink;
        void (el as any).setSinkId(sink).catch(() => {});
      }
    }
    apply(output);
    void el.play().catch((err) => {
      if (err.name === 'NotAllowedError') session.audioBlocked = true;
    });
    return { update: apply };
  }
</script>

{#each outputs as { stream, muted, volume } (stream.id)}
  <audio use:play={{ stream, volume, sink: session.settings.speakerId }} {muted} data-stream={stream.id}></audio>
{/each}
