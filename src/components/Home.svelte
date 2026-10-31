<script lang="ts">
  import { normalizeCode, formatCode } from '../lib/code';
  import type { Profile } from '../lib/protocol';
  import { loadRecent } from '../lib/settings';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import ThemeIcon from './ThemeIcon.svelte';
  import ThemePicker from './ThemePicker.svelte';
  import type { ThemeId } from '../lib/theme';
  import Modal from './Modal.svelte';
  import ProfileForm from './ProfileForm.svelte';

  let {
    profile,
    notice,
    invite,
    oncreate,
    onjoin,
    onprofile,
    theme,
    ontheme,
  }: {
    profile: Profile;
    notice: string;
    invite: string;
    oncreate: () => void;
    onjoin: (code: string) => void;
    onprofile: (p: Profile) => void;
    theme: ThemeId;
    ontheme: (theme: ThemeId) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let input = $state(invite);
  let error = $state('');
  let editing = $state(false);
  const recent = loadRecent();

  function join(e: Event) {
    e.preventDefault();
    const code = normalizeCode(input);
    if (!code) {
      error = 'Códigos têm 6 caracteres, como AB7-K2Q.';
      return;
    }
    onjoin(code);
  }
</script>

<main>
  <span class="art"><ThemeIcon {theme} size={520} /></span>
  <div class="card">
    <header>
      <Logo size={84} />
      <h1>Discordia</h1>
      <p>Salas de texto, voz e vídeo direto entre amigos.</p>
    </header>

    {#if notice}<p class="notice" role="alert">{notice}</p>{/if}

    <section class="actions">
      <div>
        <span class="badge"><Icon name="plus" size={20} /></span>
        <h2>Criar sala</h2>
        <p>Seu computador será o anfitrião. A sala existe enquanto esta aba estiver aberta.</p>
        <button class="btn primary" onclick={oncreate}>Criar sala</button>
      </div>
      <form onsubmit={join}>
        <span class="badge alt"><Icon name="members" size={20} /></span>
        <h2>Entrar numa sala</h2>
        <label class="label" for="room-code">Código da sala</label>
        <input
          id="room-code"
          class="field code"
          placeholder="AB7-K2Q"
          bind:value={input}
          oninput={() => (error = '')}
          maxlength={8}
          autocomplete="off"
          spellcheck="false"
        />
        {#if error}<p class="error">{error}</p>{/if}
        <button class="btn">Entrar</button>
      </form>
    </section>

    <section class="pick">
      <span class="label">Tema</span>
      <ThemePicker value={theme} onpick={ontheme} />
    </section>

    {#if recent.length}
      <section class="recent">
        <span class="label">Salas recentes</span>
        {#each recent as room}
          <button onclick={() => onjoin(room.code)}>
            <span>{room.name}</span><code>{formatCode(room.code)}</code>
          </button>
        {/each}
      </section>
    {/if}

    <footer>
      <button class="me" onclick={() => (editing = true)}>
        <Avatar name={profile.name} avatar={profile.avatar} color={profile.color} size={32} />
        <span>{profile.name}</span>
        <small>Editar perfil</small>
      </button>
    </footer>
  </div>
</main>

{#if editing}
  <Modal title="Seu perfil" onclose={() => (editing = false)}>
    <ProfileForm
      initial={profile}
      submit="Salvar"
      onsave={(p) => {
        onprofile(p);
        editing = false;
      }}
    />
  </Modal>
{/if}

<style>
  main {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 16px;
    overflow: auto;
    background: radial-gradient(700px 420px at 18% 8%, rgb(var(--violet-rgb) / 22%), transparent 70%), radial-gradient(760px 460px at 84% 96%, rgb(var(--accent-rgb) / 16%), transparent 70%), var(--bg-deep);
  }

  /* Arte estática do tema: só aparece aqui e não pesa durante a chamada. */
  .art {
    position: fixed;
    right: -80px;
    bottom: -90px;
    color: var(--accent);
    opacity: 0.09;
    pointer-events: none;
  }

  .pick {
    margin-top: 16px;
  }

  .pick :global(.themes) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .card {
    position: relative;
    width: min(700px, 100%);
    padding: 32px;
    border: 1px solid var(--line);
    border-radius: 24px;
    background: color-mix(in srgb, var(--bg-main) 82%, transparent);
    box-shadow: 0 30px 80px rgb(0 0 0 / 45%);
    backdrop-filter: blur(14px);
    animation: pop-in 0.3s ease-out;
  }

  header {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 26px;
    text-align: center;
  }

  header :global(svg) {
    filter: drop-shadow(0 10px 26px rgb(var(--accent-rgb) / 30%));
  }

  h1 {
    margin: 12px 0 2px;
    background: linear-gradient(120deg, #fff 20%, var(--accent-strong) 85%);
    background-clip: text;
    color: transparent;
    font-size: 36px;
    font-weight: 800;
    letter-spacing: -0.035em;
  }

  header p {
    margin: 0;
    color: var(--text-soft);
  }

  .badge {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin-bottom: 12px;
    border-radius: 12px;
    background: rgb(var(--accent-rgb) / 14%);
    color: var(--accent);
  }

  .badge.alt {
    background: rgb(var(--violet-rgb) / 16%);
    color: var(--violet);
  }

  h2 {
    margin: 0 0 8px;
    font-size: 17px;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .actions > * {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--bg-side);
    transition: transform 0.16s, border-color 0.16s;
  }

  .actions > *:hover {
    border-color: rgb(255 255 255 / 14%);
    transform: translateY(-2px);
  }

  .actions p {
    flex: 1;
    margin: 0 0 14px;
    color: var(--text-soft);
    font-size: 14px;
  }

  .actions .btn {
    width: 100%;
  }

  .code {
    margin-bottom: 12px;
    font-family: ui-monospace, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .actions .error {
    flex: none;
    margin-top: -6px;
    color: #ff8f8f;
    font-size: 13px;
  }

  .notice {
    margin: 0 0 16px;
    padding: 10px 12px;
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    background: rgb(var(--accent-rgb) / 10%);
  }

  .recent {
    margin-top: 18px;
  }

  .recent button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    padding: 8px 10px;
    border-radius: 6px;
    text-align: left;
  }

  .recent button:hover {
    background: var(--bg-hover);
  }

  .recent code {
    color: var(--text-mute);
  }

  footer {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }

  .me {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
  }

  .me small {
    color: var(--text-mute);
    font-weight: 400;
  }

  @media (max-width: 600px) {
    .actions {
      grid-template-columns: 1fr;
    }

    .pick :global(.themes) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .card {
      padding: 20px;
    }
  }
</style>
