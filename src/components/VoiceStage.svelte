<script lang="ts">
  import type { RoomSession } from '../lib/session.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import VideoTile from './VideoTile.svelte';

  let { session, onscreen, onradio }: { session: RoomSession; onscreen: () => void; onradio: () => void } = $props();

  const inside = $derived(session.members.filter((m) => m.voice.channel === session.voice.channel));
  const channelName = $derived(session.channels.find((c) => c.id === session.voice.channel)?.name);

  function openMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    session.menu = { id, x: e.clientX, y: e.clientY };
  }

  function toggleFocus(key: string) {
    session.focus = session.focus === key ? null : key;
  }

  // Foco some sozinho se a transmissão ou a câmera acabar.
  const focused = $derived.by(() => {
    const key = session.focus;
    if (!key) return null;
    if (key === 'me-screen') return session.localScreen ? key : null;
    const [kind, id] = key.split(':');
    const member = inside.find((m) => m.id === id);
    if (kind === 'screen') return member?.voice.screen ? key : null;
    return (id === session.selfId ? session.localCamera : member?.voice.camera) ? key : null;
  });

  const streamById = (peer: string, id: string | null) => (id ? (session.remote[peer] ?? []).find((s) => s.id === id) ?? null : null);
</script>

<section class="stage" aria-label="Canal de voz {channelName}">
  <div class="grid" class:many={inside.length > 4} class:spot={!!focused}>
    {#if session.radioHere && session.radio?.current}
      {@const track = session.radio.current}
      <div class="tile-radio" data-label="Rádio">
        {#if track.videoId}<img src="https://i.ytimg.com/vi/{track.videoId}/mqdefault.jpg" alt="" />{:else}<Icon name="music" size={48} />{/if}
        <div>
          <small>Tocando no rádio</small>
          <strong>{track.title}</strong>
        </div>
      </div>
    {/if}
    {#if session.localScreen}
      <VideoTile stream={session.localScreen} label="Sua tela" fit="contain" focused={focused === 'me-screen'} onfocus={() => toggleFocus('me-screen')} />
    {/if}
    {#each inside as member (member.id)}
      {#if member.voice.screen && member.id !== session.selfId && !session.settings.gameMode}
        {@const stream = streamById(member.id, member.voice.screen)}
        {@const key = `screen:${member.id}`}
        <VideoTile
          {stream}
          label={member.voice.screenAudio ? `Tela de ${member.name}` : `Tela de ${member.name} · sem som`}
          fit="contain"
          focused={focused === key}
          onfocus={stream ? () => toggleFocus(key) : undefined}
          onstop={() => session.toggleWatch(member.id)}
        >
          <div class="watch">
            <span>{member.name} está ao vivo</span>
            <button class="btn primary" onclick={() => session.toggleWatch(member.id)}>
              {session.watching.includes(member.id) ? 'Conectando…' : 'Assistir'}
            </button>
          </div>
        </VideoTile>
      {/if}
      {@const camera = member.id === session.selfId ? session.localCamera : session.settings.gameMode || session.audioOf(member.name).hideVideo ? null : streamById(member.id, member.voice.camera)}
      <VideoTile
        stream={camera}
        onmenu={member.id === session.selfId ? undefined : (e) => openMenu(e, member.id)}
        label={member.id === session.selfId ? `${member.name} (você)` : member.name}
        mirror={member.id === session.selfId}
        speaking={member.speaking}
        tint={member.color}
        focused={focused === `cam:${member.id}`}
        onfocus={camera ? () => toggleFocus(`cam:${member.id}`) : undefined}
      >
        <Avatar name={member.name} avatar={member.avatar} color={member.color} size={focused ? 56 : 84} />
      </VideoTile>
    {/each}
  </div>

  <div class="controls">
    <button
      class="round"
      class:off={session.voice.muted}
      aria-label={session.voice.muted ? 'Ativar microfone' : 'Silenciar microfone'}
      onclick={() => session.setMuted(!session.voice.muted)}
    >
      <Icon name={session.voice.muted ? 'micOff' : 'mic'} size={22} />
    </button>
    <button class="round" class:on={session.localCamera} aria-label={session.localCamera ? 'Desligar câmera' : 'Ligar câmera'} onclick={() => session.toggleCamera()}>
      <Icon name={session.localCamera ? 'camera' : 'cameraOff'} size={22} />
    </button>
    <button
      class="round"
      class:on={session.localScreen}
      aria-label={session.localScreen ? 'Parar de compartilhar' : 'Compartilhar tela'}
      onclick={() => (session.localScreen ? session.stopScreen() : onscreen())}
    >
      <Icon name="screen" size={22} />
    </button>
    <button class="round" class:on={session.radioHere} aria-label="Rádio" title="Rádio" disabled={!!session.radio} onclick={onradio}>
      <Icon name="music" size={22} />
    </button>
    <button class="round hang" aria-label="Sair do canal de voz" onclick={() => session.leaveVoice()}>
      <Icon name="hangup" size={22} />
    </button>
  </div>
</section>

<style>
  .stage {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: radial-gradient(800px 400px at 50% 110%, rgb(var(--violet-rgb) / 12%), transparent 70%), var(--bg-deep);
  }

  .grid {
    display: grid;
    flex: 1;
    grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
    grid-auto-rows: max-content;
    align-content: safe center;
    gap: 10px;
    min-height: 0;
    padding: 16px;
    overflow-y: auto;
  }

  .grid.many {
    grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  }

  .grid.spot {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: flex-start;
    gap: 8px;
  }

  .grid.spot .tile-radio {
    flex: none;
    width: 184px;
    padding: 8px;
    font-size: 12px;
  }

  .tile-radio {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    border: 1px solid rgb(var(--accent-rgb) / 22%);
    border-radius: 16px;
    background: linear-gradient(135deg, rgb(var(--accent-rgb) / 20%), rgb(var(--violet-rgb) / 16%)), var(--bg-side);
  }

  .tile-radio img {
    width: 45%;
    border-radius: 8px;
  }

  .tile-radio div {
    min-width: 0;
  }

  .tile-radio small {
    display: block;
    color: var(--accent);
  }

  .tile-radio strong {
    overflow-wrap: anywhere;
  }

  @media (max-width: 720px) {
    .grid.spot {
      flex-flow: row wrap;
      align-content: flex-start;
      justify-content: flex-start;
      padding-top: calc(54vw + 24px);
    }

    .grid.spot .tile-radio {
      width: 104px;
    }
  }

  .watch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .controls {
    display: flex;
    flex: none;
    gap: 10px;
    align-self: center;
    margin: 4px 0 16px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg-side);
    box-shadow: var(--shadow);
  }

  .round {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--bg-active);
    transition: background 0.12s, transform 0.08s;
  }

  .round:hover:not(:disabled) {
    background: #4a4a58;
    transform: translateY(-1px);
  }

  .round.off {
    background: #fff;
    color: var(--danger);
  }

  .round.on {
    background: var(--gold);
    color: var(--on-accent);
  }

  .round.on:hover:not(:disabled) {
    background: var(--gold);
  }

  .round.hang:hover {
    background: var(--danger);
  }

  .round.hang {
    background: var(--danger);
    color: #fff;
  }
</style>
