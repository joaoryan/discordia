<script lang="ts">
  import type { Profile } from '../lib/protocol';
  import type { RoomSession } from '../lib/session.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let {
    session,
    profile,
    oninvite,
    onsettings,
    onnewchannel,
  }: {
    session: RoomSession;
    profile: Profile;
    oninvite: () => void;
    onsettings: () => void;
    onnewchannel: (kind: 'text' | 'voice') => void;
  } = $props();

  const text = $derived(session.channels.filter((c) => c.kind === 'text'));
  const voice = $derived(session.channels.filter((c) => c.kind === 'voice'));
  const voiceName = $derived(session.channels.find((c) => c.id === session.voice.channel)?.name);
</script>

<aside>
  <header>
    <strong>{session.name}</strong>
    <button aria-label="Convidar amigos" title="Convidar amigos" onclick={oninvite}><Icon name="plus" size={18} /></button>
  </header>

  <nav>
    <div class="group">
      <span>Canais de texto</span>
      {#if session.isHost}
        <button aria-label="Criar canal de texto" onclick={() => onnewchannel('text')}><Icon name="plus" size={14} /></button>
      {/if}
    </div>
    {#each text as channel (channel.id)}
      {@const unread = session.unread[channel.id] ?? 0}
      <div class="channel-row">
        <button
          class="channel"
          class:active={session.active === channel.id && !session.voiceView}
          class:unread={unread > 0}
          onclick={() => session.openChannel(channel.id)}
        >
          <Icon name="hash" size={18} />
          <span>{channel.name}</span>
          {#if unread}<b>{unread}</b>{/if}
        </button>
        {#if session.isHost && text.length > 1}
          <button class="remove" aria-label="Apagar canal {channel.name}" onclick={() => session.moderate({ action: 'remove-channel', id: channel.id })}>
            <Icon name="trash" size={14} />
          </button>
        {/if}
      </div>
    {/each}

    <div class="group">
      <span>Canais de voz</span>
      {#if session.isHost}
        <button aria-label="Criar canal de voz" onclick={() => onnewchannel('voice')}><Icon name="plus" size={14} /></button>
      {/if}
    </div>
    {#each voice as channel (channel.id)}
      {@const inside = session.members.filter((m) => m.voice.channel === channel.id)}
      <div class="channel-row">
        <button
          class="channel"
          class:active={session.voiceView && session.voice.channel === channel.id}
          onclick={() => session.joinVoice(channel.id)}
        >
          <Icon name="voice" size={18} />
          <span>{channel.name}</span>
        </button>
        {#if session.isHost && voice.length > 1}
          <button class="remove" aria-label="Apagar canal {channel.name}" onclick={() => session.moderate({ action: 'remove-channel', id: channel.id })}>
            <Icon name="trash" size={14} />
          </button>
        {/if}
      </div>
      {#each inside as member (member.id)}
        <div class="voice-member">
          <Avatar name={member.name} avatar={member.avatar} color={member.color} size={24} speaking={member.speaking} />
          <span>{member.name}</span>
          {#if member.voice.screen}<em>AO VIVO</em>{/if}
          {#if member.voice.deafened}<Icon name="headsetOff" size={14} />
          {:else if member.voice.muted}<Icon name="micOff" size={14} />{/if}
        </div>
      {/each}
    {/each}
  </nav>

  {#if session.voice.channel}
    <div class="connected">
      <div>
        <strong>Voz conectada</strong>
        <button class="back" onclick={() => (session.voiceView = true)}>{voiceName}</button>
      </div>
      <button aria-label="Sair do canal de voz" title="Sair do canal de voz" onclick={() => session.leaveVoice()}><Icon name="hangup" /></button>
    </div>
  {/if}

  <footer>
    <Avatar name={profile.name} avatar={profile.avatar} color={profile.color} size={34} speaking={session.me?.speaking} online />
    <span class="me">{profile.name}</span>
    <button aria-label={session.voice.muted ? 'Ativar microfone' : 'Silenciar microfone'} aria-pressed={session.voice.muted} class:off={session.voice.muted} onclick={() => session.setMuted(!session.voice.muted)} disabled={!session.voice.channel}>
      <Icon name={session.voice.muted ? 'micOff' : 'mic'} />
    </button>
    <button aria-label={session.voice.deafened ? 'Ativar áudio' : 'Ensurdecer'} aria-pressed={session.voice.deafened} class:off={session.voice.deafened} onclick={() => session.toggleDeafen()} disabled={!session.voice.channel}>
      <Icon name={session.voice.deafened ? 'headsetOff' : 'headset'} />
    </button>
    <button aria-label="Modo jogo" aria-pressed={session.settings.gameMode} title="Modo jogo: mais leve, sem vídeo" class:game={session.settings.gameMode} onclick={() => session.toggleGameMode()}>
      <Icon name="gamepad" />
    </button>
    <button aria-label="Configurações" onclick={onsettings}><Icon name="settings" /></button>
  </footer>
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-side);
  }

  header {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
    box-shadow: 0 1px 8px rgb(0 0 0 / 22%);
  }

  header strong {
    font-weight: 700;
    letter-spacing: -0.015em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  nav {
    flex: 1;
    min-height: 0;
    padding: 6px 8px;
    overflow-y: auto;
  }

  .group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 14px 4px 4px;
    color: var(--text-mute);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .channel-row {
    position: relative;
  }

  .channel {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    height: 34px;
    margin-bottom: 2px;
    padding: 0 9px;
    border-radius: 8px;
    font-weight: 500;
    color: var(--text-mute);
    text-align: left;
    transition: background 0.1s;
  }

  .channel span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .channel:hover {
    background: var(--bg-hover);
    color: var(--text-soft);
  }

  .channel.active {
    background: linear-gradient(90deg, rgb(var(--accent-rgb) / 16%), rgb(255 255 255 / 5%));
    box-shadow: inset 2px 0 0 var(--accent);
    color: var(--text);
  }

  .channel.unread {
    color: var(--text);
    font-weight: 600;
  }

  .channel b {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--danger);
    color: #fff;
    font-size: 12px;
    text-align: center;
  }

  .remove {
    position: absolute;
    top: 8px;
    right: 8px;
    display: none;
    color: var(--text-mute);
  }

  .channel-row:hover .remove,
  .remove:focus-visible {
    display: block;
  }

  .remove:hover {
    color: var(--danger);
  }

  .voice-member {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 8px 3px 32px;
    color: var(--text-soft);
    font-size: 14px;
  }

  .voice-member span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .voice-member em {
    padding: 0 4px;
    border-radius: 4px;
    background: var(--danger);
    color: #fff;
    font-size: 10px;
    font-style: normal;
    font-weight: 700;
  }

  .connected {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-top: 1px solid var(--line);
    background: linear-gradient(0deg, rgb(67 208 138 / 8%), transparent);
    font-size: 13px;
  }

  .connected strong {
    display: block;
    color: var(--ok);
  }

  .back {
    color: var(--text-soft);
  }

  .connected > button {
    color: var(--text-soft);
  }

  .connected > button:hover {
    color: var(--danger);
  }

  footer {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    height: 54px;
    padding: 0 8px;
    background: var(--bg-panel);
  }

  .me {
    flex: 1;
    min-width: 0;
    margin-left: 6px;
    overflow: hidden;
    font-weight: 600;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  footer button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    color: var(--text-soft);
    transition: background 0.12s, color 0.12s;
  }

  footer button:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  footer button.game {
    color: var(--accent);
  }

  footer button.off {
    color: var(--danger);
  }
</style>
