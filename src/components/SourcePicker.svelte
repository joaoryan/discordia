<script lang="ts">
  // Só no app de computador: o Electron não tem seletor de tela próprio, então a página mostra um.
  import { desktop, type ScreenSource } from '../lib/platform';
  import Modal from './Modal.svelte';

  let sources = $state<ScreenSource[] | null>(null);

  $effect(() => desktop?.onPickSource((list) => (sources = list)));

  function choose(id: string | null) {
    desktop?.pickSource(id);
    sources = null;
  }

  const screens = $derived(sources?.filter((s) => s.kind === 'screen') ?? []);
  const windows = $derived(sources?.filter((s) => s.kind === 'window') ?? []);
</script>

{#if sources}
  <Modal title="O que compartilhar?" wide onclose={() => choose(null)}>
    {#if desktop?.systemAudio}<p class="hint">O som do computador vai junto com a tela.</p>{/if}
    {#each [['Telas', screens], ['Janelas', windows]] as const as [title, list]}
      {#if list.length}
        <span class="label">{title}</span>
        <div class="grid">
          {#each list as source (source.id)}
            <button class="source" onclick={() => choose(source.id)}>
              <img src={source.thumbnail} alt="" />
              <span>{source.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/each}
  </Modal>
{/if}

<style>
  .hint {
    margin-top: 0;
    color: var(--text-soft);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 10px;
    margin: 6px 0 16px;
  }

  .source {
    display: grid;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 12px;
    text-align: left;
  }

  .source:hover,
  .source:focus-visible {
    border-color: var(--accent);
    background: rgb(var(--accent-rgb) / 8%);
  }

  img {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 6px;
    background: var(--bg-deep);
    object-fit: contain;
  }

  span {
    overflow: hidden;
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
