<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { title, onclose, children, wide = false }: { title: string; onclose: () => void; children: Snippet; wide?: boolean } = $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal" class:wide role="dialog" aria-modal="true" aria-label={title}>
    <header>
      <h2>{title}</h2>
      <button aria-label="Fechar" onclick={onclose}><Icon name="close" /></button>
    </header>
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(8 8 14 / 68%);
    backdrop-filter: blur(6px);
    animation: fade 0.12s;
  }

  .modal {
    width: min(440px, 100%);
    max-height: calc(100dvh - 32px);
    overflow: auto;
    padding: 24px;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--bg-main);
    box-shadow: 0 24px 70px rgb(0 0 0 / 55%);
    animation: rise 0.16s ease-out;
  }

  .wide {
    width: min(560px, 100%);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  h2 {
    margin: 0;
    font-size: 20px;
    letter-spacing: -0.02em;
  }

  header button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    color: var(--text-mute);
    transition: background 0.12s, color 0.12s;
  }

  header button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }
</style>
