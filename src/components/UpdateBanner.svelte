<script lang="ts">
  // App de computador: avisa quando a versão nova já foi baixada e deixa reiniciar na hora.
  // Sem clicar, ela é instalada quando o app fechar.
  import Icon from './Icon.svelte';
  import { desktop } from '../lib/platform';

  let { inCall = false }: { inCall?: boolean } = $props();
  let version = $state<string | null>(null);
  let hidden = $state(false);

  if (desktop) {
    void desktop.getUpdate().then((v) => v && (version = v));
    desktop.onUpdate((v) => {
      version = v;
      hidden = false;
    });
  }
</script>

{#if version && !hidden}
  <div class="update" role="status">
    <Icon name="download" size={16} />
    <span>Versão {version} pronta.{#if inCall} Reiniciar derruba a chamada.{/if}</span>
    <button class="btn primary" onclick={() => desktop?.installUpdate()}>Reiniciar e atualizar</button>
    <button class="link" onclick={() => (hidden = true)}>Depois</button>
  </div>
{/if}

<style>
  .update {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 50;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    max-width: calc(100vw - 32px);
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-float);
    box-shadow: var(--shadow);
    color: var(--text);
    font-size: 14px;
  }

  .update .btn {
    padding: 6px 12px;
  }

  .link {
    border: 0;
    background: none;
    color: var(--text-mute);
    cursor: pointer;
  }
</style>
