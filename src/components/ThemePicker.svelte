<script lang="ts">
  import { THEMES, type ThemeId } from '../lib/theme';
  import ThemeIcon from './ThemeIcon.svelte';

  let { value, onpick }: { value: ThemeId; onpick: (theme: ThemeId) => void } = $props();
</script>

<div class="themes" role="radiogroup" aria-label="Tema">
  {#each THEMES as theme (theme.id)}
    <button
      type="button"
      role="radio"
      aria-checked={value === theme.id}
      aria-label="Tema {theme.name}"
      class:on={value === theme.id}
      style:--a={theme.colors[1]}
      style:--b={theme.colors[2]}
      style:--bg={theme.colors[0]}
      onclick={() => onpick(theme.id)}
    >
      <span class="art"><ThemeIcon theme={theme.id} /></span>
      <strong>{theme.name}</strong>
      <small>{theme.mood}</small>
    </button>
  {/each}
</div>

<style>
  .themes {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  button {
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    color: #fff;
    text-align: left;
    transition: border-color 0.12s;
  }

  button:hover {
    border-color: var(--a);
  }

  button.on {
    border-color: var(--a);
    outline: 2px solid var(--a);
    outline-offset: -2px;
  }

  .art {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-bottom: 6px;
    border-radius: 10px;
    background: linear-gradient(135deg, var(--a), var(--b));
    color: #10101a;
  }

  strong,
  small {
    display: block;
  }

  strong {
    font-size: 13.500px;
  }

  small {
    color: rgb(255 255 255 / 62%);
    font-size: 11.500px;
  }
</style>
