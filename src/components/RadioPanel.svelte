<script lang="ts">
  import { rangeFill } from '../lib/actions';
  import { onMount } from 'svelte';
  import type { RoomSession } from '../lib/session.svelte';
  import { desktop } from '../lib/platform';
  import { addFromLink, loadYouTube } from '../lib/youtube';
  import Icon from './Icon.svelte';

  const SYNC_MS = 3_000;
  const MAX_DRIFT_S = 3;
  const PLAYING = 1;
  const ENDED = 0;

  let { session }: { session: RoomSession } = $props();

  let target = $state<HTMLElement>();
  let player = $state<any>(null);
  let blocked = $state(false);
  let link = $state('');
  let loaded = '';

  const radio = $derived(session.radio!);
  const track = $derived(radio.current);
  const youtube = $derived(radio.mode === 'youtube');
  const muted = $derived(session.settings.radioMuted || session.voice.deafened);
  const expected = () => radio.position + (radio.paused ? 0 : (performance.now() - session.radioReceivedAt) / 1000);

  onMount(() => {
    if (!youtube) return;
    let gone = false;
    let timer = 0;
    loadYouTube()
      .then((YT) => {
        if (gone || !target) return;
        const instance = new YT.Player(target, {
          width: 200,
          height: 200,
          playerVars: { origin: location.origin, playsinline: 1, rel: 0 },
          events: {
            onReady: () => (player = instance),
            onAutoplayBlocked: () => (blocked = true),
            onStateChange: (e: { data: number }) => {
              if (e.data === PLAYING) blocked = false;
              if (e.data === ENDED && radio.current) session.radioCmd({ cmd: 'ended', id: radio.current.id });
            },
            // Vídeo removido ou com incorporação proibida: segue para a próxima.
            onError: () => {
              if (!radio.current) return;
              session.toast(`Não foi possível tocar "${radio.current.title}".`);
              session.radioCmd({ cmd: 'ended', id: radio.current.id });
            },
          },
        });
        timer = window.setInterval(() => {
          if (instance.getPlayerState?.() !== PLAYING || radio.paused || muted) return;
          if (Math.abs(instance.getCurrentTime() - expected()) > MAX_DRIFT_S) instance.seekTo(expected(), true);
        }, SYNC_MS);
      })
      .catch(() => session.toast('Não foi possível carregar o player do YouTube.'));
    return () => {
      gone = true;
      clearInterval(timer);
      player?.destroy();
    };
  });

  $effect(() => {
    if (!player) return;
    const videoId = track?.videoId;
    if (videoId && track.id !== loaded) {
      loaded = track.id;
      const start = { videoId, startSeconds: Math.max(0, expected()) };
      // Quem silenciou não baixa nem decodifica nada até voltar a ouvir.
      if (muted) player.cueVideoById(start);
      else player.loadVideoById(start);
    } else if (!videoId) {
      loaded = '';
      player.stopVideo();
    }
  });

  $effect(() => {
    if (!player || !track) return;
    const stopped = radio.paused || muted;
    if (stopped) player.pauseVideo();
    else if (player.getPlayerState() !== PLAYING) {
      player.seekTo(Math.max(0, expected()), true);
      player.playVideo();
    }
  });

  $effect(() => {
    if (!player) return;
    player.setVolume(Math.round(session.settings.radioVolume * 100));
    if (muted) player.mute();
    else player.unMute();
  });

  const togglePause = () => session.radioShortcut('pause');
  const skip = () => session.radioShortcut('next');

  // Atalhos no padrão dos outros da sala (Alt+Shift+M muta, Alt+Shift+D ensurdece).
  // No app de computador eles são globais e chegam pelo processo principal.
  function shortcut(e: KeyboardEvent) {
    if (!e.altKey || !e.shiftKey || desktop) return;
    const action = ({ KeyP: 'pause', KeyN: 'next', ArrowUp: 'up', ArrowDown: 'down' } as const)[e.code as 'KeyP'];
    if (!action) return;
    e.preventDefault();
    session.radioShortcut(action);
  }

  // Teclas de mídia do teclado e controles do sistema (Windows, macOS, Linux), mesmo com outra janela em foco.
  $effect(() => {
    const media = navigator.mediaSession;
    if (!media || !youtube) return;
    media.metadata = track ? new MediaMetadata({ title: track.title, artist: `Rádio Discordia · ${track.addedBy}` }) : null;
    media.playbackState = !track ? 'none' : radio.paused ? 'paused' : 'playing';
    const handlers: [MediaSessionAction, (() => void) | null][] = [
      ['play', () => radio.paused && togglePause()],
      ['pause', () => !radio.paused && togglePause()],
      ['nexttrack', skip],
    ];
    for (const [action, run] of handlers) {
      try {
        media.setActionHandler(action, run);
      } catch {
        // Ação não suportada neste navegador.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          media.setActionHandler(action, null);
        } catch {
          // idem
        }
      }
    };
  });

  function add(e: Event) {
    e.preventDefault();
    if (!link.trim()) return;
    void addFromLink(session, link);
    link = '';
  }
</script>

<svelte:window onkeydown={shortcut} />

<aside class="radio" aria-label="Rádio">
  <h3><Icon name="music" size={15} /> Rádio <small>{radio.paused ? 'pausado' : 'ao vivo'}</small></h3>

  {#if youtube}
    <!-- Exigência do YouTube: player visível, com ao menos 200×200 e nada por cima. -->
    <div class="player"><div bind:this={target}></div></div>
    {#if blocked}
      <button class="btn primary" onclick={() => { blocked = false; player?.playVideo(); }}>Tocar aqui</button>
    {/if}
  {:else}
    <div class="eq" class:still={radio.paused} aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
  {/if}

  <p class="title">{track?.title ?? 'Fila vazia: adicione uma música'}</p>
  {#if track}<small class="by">por {track.addedBy}</small>{/if}

  {#if youtube}
    <div class="row controls">
      <button class="icon" aria-label={radio.paused ? 'Continuar' : 'Pausar'} title="{radio.paused ? 'Continuar' : 'Pausar'} (Alt+Shift+P)" disabled={!track} onclick={togglePause}>
        <Icon name={radio.paused ? 'play' : 'pause'} size={18} />
      </button>
      <button class="icon" aria-label="Pular música" title="Pular (Alt+Shift+N)" disabled={!track} onclick={skip}><Icon name="skip" size={18} /></button>
      <button class="icon" class:mine={radio.shuffle} aria-label="Ordem aleatória" aria-pressed={radio.shuffle} title="Ordem aleatória" onclick={() => session.radioCmd({ cmd: 'shuffle' })}><Icon name="shuffle" size={18} /></button>
      <button class="btn stop" onclick={() => session.radioCmd({ cmd: 'stop' })}>Encerrar</button>
    </div>
  {:else}
    <div class="row">
      {#if session.canControlRadio}
        <input class="field small" aria-label="O que está tocando" value={track?.title ?? ''} maxlength="120" onchange={(e) => session.radioCmd({ cmd: 'title', title: e.currentTarget.value })} />
      {/if}
      <button class="btn stop" onclick={() => session.radioCmd({ cmd: 'stop' })}>Encerrar</button>
    </div>
  {/if}

  <div class="row">
    <button class="icon" aria-label={session.settings.radioMuted ? 'Ativar rádio' : 'Silenciar rádio'} aria-pressed={session.settings.radioMuted} onclick={() => session.updateSettings({ radioMuted: !session.settings.radioMuted })}>
      <Icon name={session.settings.radioMuted ? 'micOff' : 'voice'} size={18} />
    </button>
    <input type="range" use:rangeFill={session.settings.radioVolume} min="0" max="1" step="0.05" aria-label="Volume do rádio" title="Volume (Alt+Shift+↑ / ↓)" value={session.settings.radioVolume} oninput={(e) => session.updateSettings({ radioVolume: Number(e.currentTarget.value) })} />
  </div>

  {#if youtube}
    <form onsubmit={add}>
      <input class="field small" aria-label="Adicionar música" placeholder="Link do YouTube: toca a seguir" bind:value={link} autocomplete="off" />
      <button class="icon" aria-label="Adicionar à fila"><Icon name="plus" size={18} /></button>
    </form>

    <span class="next">A seguir — {radio.queue.length} <small>· a fila repete</small></span>
    <ol>
      {#each radio.queue as item, i (item.id)}
        <li>
          <span class="name">{item.title}<small>{item.addedBy}</small></span>
          {#if i > 0}
            <button class="icon up" aria-label="Tocar a seguir: {item.title}" title="Tocar a seguir" onclick={() => session.radioCmd({ cmd: 'up', id: item.id })}>↑</button>
          {/if}
          <button class="icon" aria-label="Remover {item.title}" onclick={() => session.radioCmd({ cmd: 'remove', id: item.id })}><Icon name="close" size={14} /></button>
        </li>
      {/each}
    </ol>
    <small class="keys">Atalhos: Alt+Shift+P pausa · N pula · ↑↓ volume. As teclas de mídia do teclado também funcionam.</small>
  {/if}
</aside>

<style>
  .radio {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    width: 272px;
    padding: 12px;
    overflow-y: auto;
    background: var(--bg-side);
    border-left: 1px solid var(--line);
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--accent);
    font-size: 14px;
  }

  h3 small {
    color: var(--text-mute);
    font-weight: 400;
  }

  .player {
    flex: none;
    align-self: center;
    width: 200px;
    height: 200px;
    overflow: hidden;
    border-radius: 12px;
    background: #000;
    box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
  }

  .title {
    margin: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .by {
    margin-top: -6px;
    color: var(--text-mute);
  }

  .row,
  form {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .row .btn {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    font-size: 13px;
  }

  .btn.stop {
    margin-left: auto;
  }

  .mine {
    color: var(--accent);
  }

  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    color: var(--text-soft);
  }

  .icon:hover {
    background: var(--bg-hover);
  }

  input[type='range'] {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }

  .small {
    min-width: 0;
    padding: 6px 8px;
    font-size: 13px;
  }

  .next {
    margin-top: 4px;
    color: var(--text-mute);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  ol {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name small {
    display: block;
    color: var(--text-mute);
  }

  .icon:disabled {
    opacity: 0.4;
  }

  .up {
    font-size: 15px;
    font-weight: 700;
  }

  .next small {
    font-weight: 400;
    text-transform: none;
  }

  .keys {
    color: var(--text-mute);
    font-size: 11px;
  }

  .eq {
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 6px;
    height: 72px;
  }

  .eq i {
    width: 12px;
    height: 100%;
    border-radius: 4px;
    background: var(--gold);
    transform-origin: bottom;
    animation: eq 0.9s ease-in-out infinite alternate;
  }

  .eq i:nth-child(2) {
    animation-delay: -0.3s;
  }

  .eq i:nth-child(3) {
    animation-delay: -0.6s;
  }

  .eq i:nth-child(4) {
    animation-delay: -0.15s;
  }

  .eq i:nth-child(5) {
    animation-delay: -0.45s;
  }

  .eq.still i {
    animation-play-state: paused;
  }

  @keyframes eq {
    from {
      transform: scaleY(0.2);
    }
  }

  @media (max-width: 720px) {
    .radio {
      width: 100%;
      max-height: 55%;
      border-top: 1px solid var(--line);
      border-left: 0;
    }
  }
</style>
