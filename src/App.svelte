<script lang="ts">
  import Avatar from './components/Avatar.svelte';
  import Home from './components/Home.svelte';
  import Logo from './components/Logo.svelte';
  import ProfileForm from './components/ProfileForm.svelte';
  import Room from './components/Room.svelte';
  import ThemePicker from './components/ThemePicker.svelte';
  import { normalizeCode } from './lib/code';
  import type { Profile } from './lib/protocol';
  import { RoomSession } from './lib/session.svelte';
  import { clearRoom, loadRoom } from './lib/roomStore';
  import { loadProfile, loadSettings, saveProfile, saveSettings } from './lib/settings';
  import { applyTheme, type ThemeId } from './lib/theme';

  let profile = $state(loadProfile());
  let theme = $state(loadSettings().theme);
  applyTheme(loadSettings().theme);
  let session = $state<RoomSession | null>(null);
  let notice = $state('');
  let invite = $state(normalizeCode(location.hash.slice(1)) ?? '');

  // Host depois do F5: volta direto para a sala.
  const saved = loadRoom();
  if (saved) {
    clearRoom();
    if (loadProfile()) open((s) => s.resume(saved));
  }

  window.addEventListener('hashchange', () => {
    invite = normalizeCode(location.hash.slice(1)) ?? '';
    if (profile && !session) followInvite();
  });

  // Quem abre um link de convite já tem o código preenchido.
  $effect(() => {
    if (session?.phase === 'ended') {
      notice = session.endReason;
      session = null;
    }
  });

  function open(run: (s: RoomSession) => Promise<void>) {
    if (!profile) return;
    notice = '';
    history.replaceState(null, '', location.pathname);
    const next = new RoomSession($state.snapshot(profile) as Profile);
    session = next;
    void run(next);
    if (import.meta.env.DEV) (window as any).session = next;
  }

  function setTheme(next: ThemeId) {
    theme = next;
    applyTheme(next);
    saveSettings({ ...loadSettings(), theme: next });
  }

  function setProfile(next: Profile) {
    const firstTime = !profile;
    profile = next;
    saveProfile(next);
    if (firstTime) followInvite();
  }

  // Abrir um link de convite já entra na sala; o código da tela inicial é para quem digita.
  function followInvite() {
    const code = invite;
    invite = '';
    if (code) open((s) => s.join(code));
  }

  // svelte-ignore state_referenced_locally
  if (!saved && loadProfile() && invite) followInvite();
</script>

{#if !profile}
  <main class="setup">
    <div class="card">
      <span class="brand"><Logo size={72} /></span>
      <h1>Bem-vindo ao Discordia</h1>
      <p>Escolha seu tema e como os amigos vão ver você. Fica salvo só neste navegador.</p>
      <div class="theme"><ThemePicker value={theme} onpick={setTheme} /></div>
      <ProfileForm initial={null} submit="Continuar" onsave={setProfile} />
    </div>
  </main>
{:else if session}
  {#if session.phase === 'connecting'}
    <main class="setup">
      <div class="card center">
        <div class="spin"><Avatar name={profile.name} avatar={profile.avatar} color={profile.color} size={64} /></div>
        <h1>{session.isHost ? 'Criando sala…' : 'Conectando ao host…'}</h1>
        {#if !session.isHost}<p>Pode levar até 20 segundos.</p>{/if}
        <button class="btn" onclick={() => { session?.close(); session = null; }}>Cancelar</button>
      </div>
    </main>
  {:else}
    <Room {session} onleave={() => { theme = loadSettings().theme; session?.close(); session = null; }} onprofile={setProfile} {profile} />
  {/if}
{:else}
  <Home
    {profile}
    {notice}
    {invite}
    {theme}
    ontheme={setTheme}
    oncreate={() => open((s) => s.create())}
    onjoin={(code) => open((s) => s.join(code))}
    onprofile={setProfile}
  />
{/if}

<style>
  .setup {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 16px;
    overflow: auto;
    background: radial-gradient(700px 420px at 18% 8%, rgb(var(--violet-rgb) / 22%), transparent 70%), radial-gradient(760px 460px at 84% 96%, rgb(var(--accent-rgb) / 16%), transparent 70%), var(--bg-deep);
  }

  .card {
    width: min(460px, 100%);
    padding: 32px;
    border: 1px solid var(--line);
    border-radius: 24px;
    background: color-mix(in srgb, var(--bg-main) 82%, transparent);
    box-shadow: 0 30px 80px rgb(0 0 0 / 45%);
    backdrop-filter: blur(14px);
    animation: pop-in 0.3s ease-out;
  }

  .brand {
    display: flex;
    justify-content: center;
  }

  .theme {
    margin-bottom: 16px;
  }

  .card > h1,
  .card > p {
    text-align: center;
  }

  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  h1 {
    margin: 14px 0 6px;
    font-size: 24px;
    font-weight: 800;
    letter-spacing: -0.03em;
  }

  p {
    margin: 0 0 18px;
    color: var(--text-soft);
  }

  .spin {
    animation: pulse 1.2s ease-in-out infinite;
  }

  .center .btn {
    margin-top: 10px;
  }

  @keyframes pulse {
    50% {
      transform: scale(0.92);
      opacity: 0.7;
    }
  }
</style>
