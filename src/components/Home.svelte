<script lang="ts">
  import { normalizeCode, formatCode } from '../lib/code';
  import type { Profile } from '../lib/protocol';
  import { friends } from '../lib/friends.svelte';
  import { loadRecent } from '../lib/settings';
  import { desktop } from '../lib/platform';
  import { allDownloads, downloadFor, latestVersion } from '../lib/download';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import MicTest from './MicTest.svelte';
  import Modal from './Modal.svelte';
  import ProfileForm from './ProfileForm.svelte';

  let {
    profile,
    notice,
    invite,
    oncreate,
    onjoin,
    onprofile,
  }: {
    profile: Profile;
    notice: string;
    invite: string;
    oncreate: (invitees: string[]) => void;
    onjoin: (code: string) => void;
    onprofile: (p: Profile) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let input = $state(invite);
  let error = $state('');
  let editing = $state(false);
  const recent = loadRecent();
  let picked = $state<string[]>([]);
  const shown = $derived(friends.sorted.slice(0, 6));
  // Dentro do próprio app não faz sentido oferecer o download.
  const app = desktop ? null : downloadFor(navigator.userAgent, (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform);
  let appVersion = $state<string | null>(null);
  if (app) void latestVersion().then((v) => (appVersion = v));

  function pick(address: string, on: boolean) {
    picked = on ? [...picked, address] : picked.filter((a) => a !== address);
  }

  const when = (at: number) => {
    const minutes = Math.round((Date.now() - at) / 60_000);
    if (minutes < 1) return 'agora há pouco';
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `há ${hours} h`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'ontem' : `há ${days} dias`;
  };

  function join(e: Event) {
    e.preventDefault();
    const code = normalizeCode(input);
    if (!code) {
      error = 'Cole o link de convite ou digite o código de 6 caracteres, como AB7-K2Q.';
      return;
    }
    onjoin(code);
  }
</script>

<main>
  <div class="shell">
    <section class="hero">
      <div class="brand">
        <Logo size={56} />
        <h1>Discordia</h1>
      </div>
      <p class="pitch">Chame a turma.<br />Sem servidor, sem conta.</p>
      <p class="sub">Sua sala vive no seu computador. Quem tiver o link entra direto, com voz, vídeo e chat.</p>

      {#if notice}<p class="notice" role="alert">{notice}</p>{/if}

      <button class="btn primary big" onclick={() => oncreate([])}><Icon name="plus" size={18} /> Criar sala</button>

      <form class="join" onsubmit={join}>
        <label class="label" for="room-code">Código da sala</label>
        <div class="join-row">
          <input
            id="room-code"
            class="field code"
            placeholder="AB7-K2Q ou link de convite"
            bind:value={input}
            oninput={() => (error = '')}
            autocomplete="off"
            spellcheck="false"
          />
          <button class="btn">Entrar</button>
        </div>
        {#if error}<p class="error">{error}</p>{/if}
      </form>

      {#if app}
        <div class="get-app">
          <a class="btn" href={app.url}><Icon name="download" size={18} /> Baixar{appVersion ? ` v${appVersion}` : ""} para {app.os}</a>
          <small>Atalhos dentro do jogo e mini janela por cima. <a href={allDownloads} target="_blank" rel="noopener">Outros sistemas</a></small>
        </div>
      {/if}
    </section>

    <section class="side">
      <div class="section-head">
        <span class="label">Amigos</span>
        {#if friends.people.length}
          <button class="link" onclick={() => friends.show()}>
            Ver todos{#if friends.totalUnread}<span class="badge-count">{friends.totalUnread}</span>{/if}
          </button>
        {/if}
      </div>
      {#if shown.length}
        <ul class="friends">
          {#each shown as person (person.address)}
            {@const unread = friends.unread[person.address] ?? 0}
            <li>
              <label class="pick" title="Marcar para chamar">
                <input type="checkbox" aria-label="Chamar {person.name}" checked={picked.includes(person.address)} onchange={(e) => pick(person.address, e.currentTarget.checked)} />
                <Avatar name={person.name} avatar={person.avatar} color={person.color} size={32} online={!!friends.online[person.address]} />
                <span class="room-text">
                  <strong>{person.name}</strong>
                  <small>{friends.online[person.address] ? 'online' : person.room ? `esteve em ${person.room}` : 'offline'}</small>
                </span>
              </label>
              <button class="dm" aria-label="Mensagem para {person.name}" title="Mensagem" onclick={() => friends.show(person.address)}>
                <Icon name="chat" size={18} />
                {#if unread}<span class="badge-count">{unread}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
        <button class="btn primary call" disabled={!picked.length} onclick={() => oncreate(picked)}>
          <Icon name="voice" size={18} />
          {picked.length ? `Criar sala e chamar ${picked.length === 1 ? friends.find(picked[0])?.name : `${picked.length} amigos`}` : 'Marque quem chamar para uma sala nova'}
        </button>
      {:else}
        <p class="empty">Quem entrar numa sala com você aparece aqui. Depois dá para mandar mensagem e chamar para uma sala nova, sem passar link por outro app.</p>
      {/if}

      <span class="label top">Salas recentes</span>
      {#if recent.length}
        <div class="rooms">
          {#each recent as room}
            <button class="room" onclick={() => onjoin(room.code)}>
              <span class="room-icon" aria-hidden="true">{room.name.slice(0, 1).toUpperCase()}</span>
              <span class="room-text"><strong>{room.name}</strong><small>{when(room.at)}</small></span>
              <code>{formatCode(room.code)}</code>
            </button>
          {/each}
        </div>
      {:else}
        <p class="empty">As salas em que você entrar aparecem aqui, para voltar com um clique.</p>
      {/if}

      <footer>
        <button class="me" onclick={() => (editing = true)}>
          <Avatar name={profile.name} avatar={profile.avatar} color={profile.color} size={36} online />
          <span><strong>{profile.name}</strong><small>Editar perfil</small></span>
        </button>
        <MicTest />
      </footer>
    </section>
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
    background: var(--bg-deep);
  }

  .shell {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    width: min(980px, 100%);
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 24px;
    box-shadow: 0 30px 80px rgb(0 0 0 / 45%);
    animation: pop-in 0.3s ease-out;
  }

  .hero {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 40px;
    background: radial-gradient(520px 320px at 10% 0%, rgb(var(--accent-rgb) / 14%), transparent 70%), radial-gradient(420px 300px at 100% 100%, rgb(var(--violet-rgb) / 12%), transparent 70%), var(--bg-side);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.03em;
  }

  .pitch {
    margin: 12px 0 0;
    font-size: clamp(28px, 4vw, 40px);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.035em;
  }

  .sub {
    margin: 0 0 8px;
    max-width: 44ch;
    color: var(--text-soft);
  }

  .big {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 46px;
    font-size: 15px;
  }

  .join {
    display: grid;
    gap: 6px;
  }

  .join-row {
    display: flex;
    gap: 8px;
  }

  .join-row input {
    flex: 1;
    min-width: 0;
  }

  .code {
    font-family: ui-monospace, monospace;
    letter-spacing: 0.06em;
  }

  .error {
    margin: 0;
    color: #ff8f8f;
    font-size: 13px;
  }

  .notice {
    margin: 0;
    padding: 10px 12px;
    border-left: 3px solid var(--accent);
    border-radius: 6px;
    background: rgb(var(--accent-rgb) / 10%);
  }

  .get-app {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    margin-top: auto;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }

  .get-app .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    text-decoration: none;
  }

  .get-app small a {
    color: var(--accent);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 32px 28px;
    background: var(--bg-main);
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-head .label {
    margin: 0;
  }

  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
  }

  .top {
    margin-top: 14px;
  }

  .friends {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .friends li {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: 12px;
    transition: background 0.12s;
  }

  .friends li:hover {
    background: var(--bg-hover);
  }

  .pick {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 7px 8px;
    cursor: pointer;
  }

  .dm {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-right: 4px;
    border-radius: 9px;
    color: var(--text-soft);
  }

  .dm:hover {
    background: var(--bg-active);
    color: var(--text);
  }

  .dm .badge-count {
    position: absolute;
    top: 0;
    right: -2px;
  }

  .call {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-top: 6px;
    font-size: 14px;
  }

  .call:disabled {
    background: var(--bg-input);
    box-shadow: none;
    color: var(--text-mute);
    font-weight: 500;
    opacity: 1;
  }

  .rooms {
    display: grid;
    gap: 6px;
  }

  .room {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--bg-input);
    text-align: left;
    transition: background 0.12s, transform 0.12s;
  }

  .room:hover {
    background: var(--bg-active);
    transform: translateY(-1px);
  }

  .room-icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    background: linear-gradient(135deg, rgb(var(--accent-rgb) / 30%), rgb(var(--violet-rgb) / 30%));
    font-weight: 800;
  }

  .room-text {
    flex: 1;
    min-width: 0;
  }

  .room-text strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    display: block;
    color: var(--text-mute);
    font-size: 12px;
  }

  .room code {
    color: var(--text-soft);
    font-size: 12px;
    letter-spacing: 0.06em;
  }

  .empty {
    margin: 0;
    color: var(--text-mute);
    font-size: 14px;
  }

  footer {
    display: grid;
    gap: 10px;
    margin-top: auto;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }

  .me {
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
  }

  @media (max-width: 760px) {
    .shell {
      grid-template-columns: 1fr;
    }

    .hero,
    .side {
      padding: 22px;
    }
  }
</style>
