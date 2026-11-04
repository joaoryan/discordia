<script lang="ts" generics="T extends string">
  // Seletor próprio: o <select> nativo não aceita estilo na lista e destoa do resto do app.
  // Segue o padrão "combobox só de seleção" da WAI-ARIA, com teclado completo.
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';

  let {
    id,
    value,
    options,
    onchange,
    disabled = false,
    placeholder = 'Escolha',
  }: {
    id: string;
    value: T;
    options: { value: T; label: string; hint?: string }[];
    onchange: (value: T) => void;
    disabled?: boolean;
    placeholder?: string;
  } = $props();

  let open = $state(false);
  let active = $state(0);
  let root = $state<HTMLElement>();
  let list = $state<HTMLElement>();
  let typed = '';
  let typedAt = 0;

  const current = $derived(options.find((o) => o.value === value));
  const listId = $derived(`${id}-list`);

  async function show() {
    if (disabled) return;
    open = true;
    active = Math.max(0, options.findIndex((o) => o.value === value));
    await tick();
    scrollToActive();
  }

  function choose(index: number) {
    const option = options[index];
    open = false;
    if (option && option.value !== value) onchange(option.value);
    root?.querySelector('button')?.focus();
  }

  function scrollToActive() {
    list?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function move(to: number) {
    active = Math.max(0, Math.min(options.length - 1, to));
    void tick().then(scrollToActive);
  }

  function onkeydown(e: KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        void show();
      }
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(active + 1),
      ArrowUp: () => move(active - 1),
      Home: () => move(0),
      End: () => move(options.length - 1),
      PageDown: () => move(active + 6),
      PageUp: () => move(active - 6),
      Enter: () => choose(active),
      ' ': () => choose(active),
      Escape: () => (open = false),
      Tab: () => (open = false),
    };
    const run = keys[e.key];
    if (run) {
      if (e.key !== 'Tab') e.preventDefault();
      if (e.key === 'Escape') e.stopPropagation(); // não fecha o modal junto
      return run();
    }
    // Digitar pula para a opção que começa com as letras digitadas.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = performance.now();
      typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = now;
      const found = options.findIndex((o) => o.label.toLowerCase().startsWith(typed));
      if (found >= 0) move(found);
    }
  }

  function onwindowclick(e: MouseEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onclick={onwindowclick} />

<div class="select" class:open class:disabled bind:this={root}>
  <button
    {id}
    type="button"
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={listId}
    aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
    {disabled}
    onclick={() => (open ? (open = false) : void show())}
    {onkeydown}
  >
    <span class="value" class:placeholder={!current}>{current?.label ?? placeholder}</span>
    <span class="chevron"><Icon name="chevron" size={16} /></span>
  </button>

  {#if open}
    <ul id={listId} role="listbox" tabindex="-1" bind:this={list} aria-labelledby={id}>
      {#each options as option, i (option.value)}
        <li
          id="{id}-opt-{i}"
          role="option"
          data-index={i}
          data-value={option.value}
          aria-selected={option.value === value}
          class:active={i === active}
          onpointerenter={() => (active = i)}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => choose(i)}
          onkeydown={() => {}}
        >
          <span class="text">
            <span>{option.label}</span>
            {#if option.hint}<small>{option.hint}</small>{/if}
          </span>
          {#if option.value === value}<span class="check"><Icon name="check" size={16} /></span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .select {
    position: relative;
    min-width: 0;
  }

  button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 44px;
    padding: 0 12px 0 13px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-deep);
    text-align: left;
    transition: border-color 0.14s, box-shadow 0.14s, background 0.14s;
  }

  button:hover:not(:disabled) {
    border-color: rgb(255 255 255 / 14%);
  }

  .open button,
  button:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgb(var(--accent-rgb) / 18%);
    outline: none;
  }

  .value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .placeholder {
    color: var(--text-mute);
  }

  .chevron {
    display: grid;
    color: var(--text-mute);
    transition: transform 0.16s;
  }

  .open .chevron {
    transform: rotate(180deg);
    color: var(--accent);
  }

  ul {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 40;
    max-height: 260px;
    margin: 0;
    padding: 5px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-float);
    box-shadow: var(--shadow);
    list-style: none;
    animation: drop 0.12s ease-out;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    color: var(--text-soft);
    cursor: pointer;
  }

  li.active {
    background: var(--bg-hover);
    color: var(--text);
  }

  li[aria-selected='true'] {
    color: var(--text);
    font-weight: 600;
  }

  .text {
    display: grid;
    flex: 1;
    min-width: 0;
  }

  .text span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--text-mute);
    font-size: 12px;
    font-weight: 400;
  }

  .check {
    display: grid;
    color: var(--accent);
  }

  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    ul,
    .chevron {
      animation: none;
      transition: none;
    }
  }
</style>
