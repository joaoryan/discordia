<script lang="ts">
  import type { RoomSession } from '../lib/session.svelte';

  const WIDTH = 240;
  const HEIGHT = 380;

  let { session }: { session: RoomSession } = $props();

  const member = $derived(session.members.find((m) => m.id === session.menu?.id));
  const audio = $derived(session.audioOf(member?.name ?? ''));
  const left = $derived(Math.max(8, Math.min(session.menu?.x ?? 0, innerWidth - WIDTH - 8)));
  const top = $derived(Math.max(8, Math.min(session.menu?.y ?? 0, innerHeight - HEIGHT - 8)));
</script>

<svelte:window onclick={() => (session.menu = null)} onkeydown={(e) => e.key === 'Escape' && (session.menu = null)} />

{#if member}
  {@const name = member.name}
  <div class="menu" role="menu" tabindex="-1" aria-label="Opções de {name}" style:left="{left}px" style:top="{top}px" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <strong>{name}</strong>

    <label>
      <span>Volume <b>{Math.round(audio.volume * 100)}%</b></span>
      <input type="range" min="0" max="1" step="0.05" aria-label="Volume de {name}" value={audio.volume} oninput={(e) => session.setUserAudio(name, { volume: Number(e.currentTarget.value) })} />
    </label>

    {#if member.voice.screen}
      <label>
        <span>Transmissão <b>{Math.round(audio.screenVolume * 100)}%</b></span>
        <input type="range" min="0" max="1" step="0.05" aria-label="Volume da transmissão de {name}" value={audio.screenVolume} oninput={(e) => session.setUserAudio(name, { screenVolume: Number(e.currentTarget.value) })} />
      </label>
    {/if}

    <label class="check">
      <input type="checkbox" aria-label="Silenciar para mim" checked={audio.muted} onchange={(e) => session.setUserAudio(name, { muted: e.currentTarget.checked })} />
      Silenciar para mim
    </label>
    <label class="check">
      <input type="checkbox" aria-label="Ocultar câmera" checked={audio.hideVideo} onchange={(e) => session.setUserAudio(name, { hideVideo: e.currentTarget.checked })} />
      Ocultar câmera
    </label>

    {#if session.isHost}
      <hr />
      <button role="menuitem" onclick={() => { session.moderate({ action: 'mute', id: member.id }); session.menu = null; }}>Silenciar para todos</button>
      {#if member.voice.channel}
        <button role="menuitem" onclick={() => { session.moderate({ action: 'disconnect', id: member.id }); session.menu = null; }}>Desconectar da voz</button>
      {/if}
      <button role="menuitem" class="danger" onclick={() => { session.moderate({ action: 'kick', id: member.id }); session.menu = null; }}>Expulsar</button>
      <button role="menuitem" class="danger" onclick={() => { session.moderate({ action: 'ban', id: member.id }); session.menu = null; }}>Banir</button>
    {/if}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 40;
    display: grid;
    gap: 6px;
    width: 240px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-float);
    box-shadow: var(--shadow);
    animation: pop-in 0.12s ease-out;
    font-size: 14px;
  }

  label span {
    display: flex;
    justify-content: space-between;
    color: var(--text-soft);
  }

  input {
    accent-color: var(--accent);
  }

  input[type='range'] {
    width: 100%;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  hr {
    width: 100%;
    margin: 2px 0;
    border: 0;
    border-top: 1px solid var(--bg-active);
  }

  button {
    padding: 6px 8px;
    border-radius: 4px;
    text-align: left;
  }

  button:hover {
    background: var(--bg-hover);
  }

  .danger {
    color: #ff8f8f;
  }
</style>
