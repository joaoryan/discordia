<script lang="ts">
  // Convites e mensagens de amigos que chegam com o painel fechado: um cartão no canto, em qualquer tela.
  import { friends } from '../lib/friends.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  const TEXT_MS = 10_000;

  let { room, onjoin }: { room: { code: string } | null; onjoin: (code: string) => void } = $props();

  // Mensagens somem sozinhas; convites ficam até a pessoa decidir.
  $effect(() => {
    const timers = friends.incoming
      .filter((i) => i.message.kind === 'text')
      .map((i) => setTimeout(() => friends.dismiss(i.message.id), TEXT_MS));
    return () => timers.forEach(clearTimeout);
  });
</script>

{#if friends.incoming.length && !friends.panel}
  <div class="stack" aria-live="polite">
    {#each friends.incoming.slice(-3) as { address, message } (message.id)}
      {@const friend = friends.find(address)}
      <div class="card" class:invite={message.kind === 'invite'} role="status">
        <Avatar name={message.name} avatar={friend?.avatar} color={friend?.color ?? message.color} size={36} online={!!friends.online[address]} />
        <div class="body">
          {#if message.kind === 'invite'}
            <span class="tag"><Icon name="voice" size={13} /> Convite</span>
            <p><strong>{message.name}</strong> te chamou para <strong>{message.room}</strong></p>
            <div class="actions">
              {#if room?.code !== message.code}
                <button class="btn primary" onclick={() => { friends.dismiss(message.id); onjoin(message.code); }}>
                  {room ? 'Sair desta sala e entrar' : 'Entrar'}
                </button>
              {/if}
              <button class="btn" onclick={() => friends.show(address)}>Responder</button>
            </div>
          {:else}
            <p><strong>{message.name}</strong> <span class="text">{message.text}</span></p>
            <div class="actions">
              <button class="btn" onclick={() => friends.show(address)}>Responder</button>
            </div>
          {/if}
        </div>
        <button class="close" aria-label="Dispensar" onclick={() => friends.dismiss(message.id)}><Icon name="close" size={16} /></button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .stack {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 70;
    display: grid;
    gap: 10px;
    width: min(360px, calc(100vw - 32px));
  }

  .card {
    display: flex;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--bg-float);
    box-shadow: var(--shadow);
    animation: pop-in 0.18s ease-out;
  }

  .card.invite {
    border-color: rgb(var(--accent-rgb) / 45%);
    background: linear-gradient(135deg, rgb(var(--accent-rgb) / 12%), rgb(var(--violet-rgb) / 10%)), var(--bg-float);
  }

  .body {
    display: grid;
    flex: 1;
    gap: 6px;
    min-width: 0;
  }

  .tag {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--accent);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .text {
    display: -webkit-box;
    overflow: hidden;
    color: var(--text-soft);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }

  .actions .btn {
    padding: 7px 12px;
    font-size: 13px;
  }

  .close {
    display: grid;
    flex: none;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    color: var(--text-mute);
  }

  .close:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
</style>
