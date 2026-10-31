<script lang="ts">
  import type { Member } from '../lib/protocol';
  import type { RoomSession } from '../lib/session.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let { session }: { session: RoomSession } = $props();

  const status = (m: Member) => {
    if (m.voice.screen) return 'Compartilhando a tela';
    const channel = session.channels.find((c) => c.id === m.voice.channel);
    return channel ? `Em ${channel.name}` : '';
  };

  function openMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    session.menu = { id, x: e.clientX, y: e.clientY };
  }
</script>

<aside aria-label="Membros">
  <h3>Online — {session.members.length}</h3>
  {#each session.members as member (member.id)}
    <div class="member">
      <button
        class="who"
        disabled={member.id === session.selfId}
        aria-haspopup="menu"
        onclick={(e) => openMenu(e, member.id)}
        oncontextmenu={(e) => openMenu(e, member.id)}
      >
        <Avatar name={member.name} avatar={member.avatar} color={member.color} size={34} speaking={member.speaking} online />
        <span class="text">
          <span class="name" style:color={member.color}>
            {member.name}
            {#if member.isHost}<span title="Host da sala" class="crown"><Icon name="crown" size={14} /></span>{/if}
            {#if session.audioOf(member.name).muted}<span title="Silenciado para você" class="local"><Icon name="micOff" size={14} /></span>{/if}
          </span>
          {#if status(member)}<small>{status(member)}</small>{/if}
        </span>
      </button>
    </div>
  {/each}
</aside>

<style>
  aside {
    width: 240px;
    padding: 12px 8px;
    overflow-y: auto;
    background: var(--bg-side);
  }

  h3 {
    margin: 8px;
    color: var(--text-mute);
    font-size: 12px;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .member {
    position: relative;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border-radius: 10px;
    text-align: left;
    transition: background 0.1s;
  }

  .who:disabled {
    cursor: default;
    opacity: 1;
  }

  .who:hover {
    background: var(--bg-hover);
  }

  .text {
    min-width: 0;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
  }

  .crown {
    display: inline-flex;
    color: var(--accent);
  }

  small {
    display: block;
    color: var(--text-mute);
  }

  .local {
    display: inline-flex;
    color: var(--danger);
  }
</style>
