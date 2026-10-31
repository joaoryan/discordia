<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    stream,
    label,
    speaking = false,
    mirror = false,
    fit = 'cover',
    tint = '#8f73f2',
    onstop,
    onmenu,
    focused = false,
    onfocus,
    children,
  }: {
    stream: MediaStream | null;
    label: string;
    speaking?: boolean;
    mirror?: boolean;
    fit?: 'cover' | 'contain';
    tint?: string;
    onstop?: () => void;
    onmenu?: (e: MouseEvent) => void;
    focused?: boolean;
    onfocus?: () => void;
    children?: Snippet;
  } = $props();

  let video = $state<HTMLVideoElement>();

  $effect(() => {
    if (video && video.srcObject !== stream) video.srcObject = stream;
  });

  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : video?.parentElement?.requestFullscreen());
</script>

<div class="tile" class:speaking class:focused style:--tint={tint} data-label={label} role="group" aria-label={label} oncontextmenu={onmenu}>
  {#if stream}
    <!-- Mudo aqui: todo áudio remoto toca nos elementos de RemoteAudio. -->
    <video bind:this={video} autoplay playsinline muted class:mirror style:object-fit={fit} ondblclick={fullscreen}></video>
  {:else}
    {@render children?.()}
  {/if}
  <span class="tag">{label}</span>
  {#if onfocus}
    <div class="view">
      {#if focused && stream}<button onclick={fullscreen}>Tela cheia</button>{/if}
      <button aria-label={focused ? `Reduzir ${label}` : `Ampliar ${label}`} onclick={onfocus}>{focused ? 'Reduzir' : 'Ampliar'}</button>
    </div>
  {/if}
  {#if onmenu}<button class="more" aria-label="Opções de {label}" onclick={onmenu}>⋯</button>{/if}
  {#if stream && onstop}<button class="stop" onclick={onstop}>Parar de assistir</button>{/if}
</div>

<style>
  .tile {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 0;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    border-radius: 16px;
    background:
      radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--tint) 34%, transparent), transparent 68%),
      var(--bg-side);
    outline: 2px solid var(--line);
    outline-offset: -2px;
  }

  /* Muda várias vezes por segundo: nada de sombra desfocada nem transição aqui. */
  .tile.speaking {
    outline-color: var(--ok);
  }

  video {
    width: 100%;
    height: 100%;
    background: #000;
  }

  .mirror {
    transform: scaleX(-1);
  }

  /* Foco: só CSS, sem mover o elemento, para o vídeo não reiniciar. */
  :global(.spot) .tile {
    flex: none;
    width: 184px;
  }

  :global(.spot) .tile.focused {
    position: absolute;
    inset: 16px 216px 16px 16px;
    width: auto;
    aspect-ratio: auto;
  }

  .view {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: flex;
    gap: 4px;
  }

  .view button {
    padding: 2px 8px;
    border-radius: 6px;
    background: rgb(10 10 16 / 72%);
    font-size: 12.500px;
  }

  @media (max-width: 720px) {
    :global(.spot) .tile {
      width: 104px;
    }

    :global(.spot) .tile.focused {
      inset: 12px 12px auto;
      width: auto;
      height: 54vw;
    }

    :global(.spot) .tile:not(.focused) .tag,
    :global(.spot) .tile:not(.focused) .view {
      font-size: 11px;
    }
  }

  .more {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 30px;
    height: 26px;
    border-radius: 6px;
    background: rgb(0 0 0 / 60%);
    font-weight: 700;
  }

  .stop {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgb(0 0 0 / 60%);
    font-size: 13px;
  }

  .tag {
    position: absolute;
    bottom: 8px;
    left: 8px;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgb(10 10 16 / 72%);
    font-size: 13px;
    font-weight: 550;
  }
</style>
