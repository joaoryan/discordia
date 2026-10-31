<script lang="ts">
  import { resizeAvatar } from '../lib/format';
  import { LIMITS, type Profile } from '../lib/protocol';
  import Avatar from './Avatar.svelte';

  const COLORS = ['#f7b23b', '#f0756e', '#e27ac0', '#a48cf5', '#62b0f0', '#4fd096', '#ff9259'];

  let { initial, onsave, submit }: { initial: Profile | null; onsave: (p: Profile) => void; submit: string } = $props();

  // O formulário só usa o perfil como valor inicial; a edição é local até salvar.
  // svelte-ignore state_referenced_locally
  let name = $state(initial?.name ?? '');
  // svelte-ignore state_referenced_locally
  let avatar = $state(initial?.avatar ?? '');
  // svelte-ignore state_referenced_locally
  let color = $state(initial?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)]);
  let error = $state('');

  async function pick(ev: Event) {
    const file = (ev.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      avatar = await resizeAvatar(file);
      error = '';
    } catch {
      error = 'Não foi possível usar essa imagem.';
    }
  }
</script>

<form
  onsubmit={(e) => {
    e.preventDefault();
    if (name.trim()) onsave({ name: name.trim(), avatar, color });
  }}
>
  <div class="avatar-row">
    <Avatar name={name || '?'} {avatar} {color} size={84} />
    <div class="avatar-actions">
      <label class="btn">
        Escolher imagem
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden onchange={pick} />
      </label>
      {#if avatar}<button type="button" class="link" onclick={() => (avatar = '')}>Remover imagem</button>{/if}
    </div>
  </div>
  <div class="colors" role="radiogroup" aria-label="Cor do avatar">
    {#each COLORS as option}
      <button
        type="button"
        role="radio"
        aria-checked={color === option}
        aria-label="Cor {option}"
        class:selected={color === option}
        style:background={option}
        onclick={() => (color = option)}
      ></button>
    {/each}
  </div>
  <label class="label" for="profile-name">Nome de usuário</label>
  <!-- svelte-ignore a11y_autofocus -->
  <input id="profile-name" class="field" bind:value={name} maxlength={LIMITS.name} autofocus autocomplete="off" />
  {#if error}<p class="error">{error}</p>{/if}
  <button class="btn primary submit" disabled={!name.trim()}>{submit}</button>
</form>

<style>
  .avatar-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 14px;
  }

  .avatar-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  label.btn {
    cursor: pointer;
  }

  .link {
    color: var(--text-soft);
    font-size: 13px;
    text-decoration: underline;
  }

  .colors {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  .colors button {
    width: 26px;
    height: 26px;
    border-radius: 50%;
  }

  .colors .selected {
    box-shadow: 0 0 0 2px var(--bg-main), 0 0 0 4px var(--accent);
  }

  .submit {
    width: 100%;
    margin-top: 16px;
  }

  .error {
    margin: 8px 0 0;
    color: #ff8f8f;
    font-size: 13px;
  }
</style>
