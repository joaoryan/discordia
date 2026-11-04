<script lang="ts">
  import Avatar from './components/Avatar.svelte';
  import FriendsPanel from './components/FriendsPanel.svelte';
  import Incoming from './components/Incoming.svelte';
  import Home from './components/Home.svelte';
  import Logo from './components/Logo.svelte';
  import MicTest from './components/MicTest.svelte';
  import ProfileForm from './components/ProfileForm.svelte';
  import Room from './components/Room.svelte';
  import { normalizeCode } from './lib/code';
  import type { Profile } from './lib/protocol';
  import { RoomSession } from './lib/session.svelte';
  import { clearRoom, loadRoom } from './lib/roomStore';
  import { desktop } from './lib/platform';
  import { friends } from './lib/friends.svelte';
  import { loadProfile, loadSettings, saveProfile } from './lib/settings';
  import { playSound } from './lib/sounds';

  let profile = $state(loadProfile());
  let session = $state<RoomSession | null>(null);
  let notice = $state('');
  let invite = $state(normalizeCode(location.hash.slice(1)) ?? '');
  /** Amigos para chamar assim que a sala que está sendo criada ficar pronta. */
  let pendingInvites: string[] = [];

  // svelte-ignore state_referenced_locally
  if (profile) friends.start();

  // Convite ou mensagem de amigo: som e, com a janela em segundo plano, notificação do sistema.
  friends.onIncoming = (friend, message) => {
    const settings = session?.settings ?? loadSettings();
    const sound = message.kind === 'invite' ? 'invite' : 'direct';
    if (settings.sounds && !settings.mutedSounds.includes(sound)) playSound(sound, settings.soundVolume);
    if (document.visibilityState === 'visible' || !settings.notifications || Notification.permission !== 'granted') return;
    const title = message.kind === 'invite' ? `${message.name} te chamou para ${message.room}` : message.name;
    const note = new Notification(title, { body: message.kind === 'text' ? message.text : 'Clique para responder', tag: message.id, icon: '/icon-192.png' });
    note.onclick = () => {
      focus();
      friends.show(friend?.address ?? null);
    };
  };

  $effect(() => {
    if (session?.phase !== 'open' || !pendingInvites.length || !profile) return;
    const list = pendingInvites;
    pendingInvites = [];
    void friends.invite(list, session.code, session.name, profile);
    session.toast(list.length === 1 ? `Convite enviado para ${friends.find(list[0])?.name ?? 'seu amigo'}.` : `Convite enviado para ${list.length} amigos.`);
  });

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

  async function open(run: (s: RoomSession) => Promise<void>) {
    if (!profile) return;
    notice = '';
    history.replaceState(null, '', location.pathname);
    // A chave pública vai junto do perfil: é assim que os outros da sala passam a te ter como amigo.
    // Já existindo, é lida na hora, para a volta do F5 não piscar a tela inicial.
    const friend = friends.storedKey ?? (await friends.publicKey().catch(() => undefined));
    const next = new RoomSession({ ...($state.snapshot(profile) as Profile), friend });
    session = next;
    void run(next);
    if (import.meta.env.DEV) (window as any).session = next;
  }

  function setProfile(next: Profile) {
    const firstTime = !profile;
    profile = next;
    saveProfile(next);
    if (firstTime) {
      friends.start();
      followInvite();
    }
  }

  /** Entrar pela mensagem de um amigo: se já estiver noutra sala, sai dela antes. */
  function joinFromFriend(code: string) {
    friends.panel = false;
    if (session?.code === code) return;
    if (session) {
      session.close();
      session = null;
    }
    void open((s) => s.join(code));
  }

  // Abrir um link de convite já entra na sala; o código da tela inicial é para quem digita.
  function followInvite() {
    const code = invite;
    invite = '';
    if (code) open((s) => s.join(code));
  }

  // svelte-ignore state_referenced_locally
  if (!saved && loadProfile() && invite) followInvite();

  // App de computador: um link discordia://AB7-K2Q aberto no sistema entra na sala.
  desktop?.onJoin((code) => {
    if (session) return;
    invite = code;
    if (profile) followInvite();
  });
</script>

{#if !profile}
  <main class="setup">
    <div class="card">
      <span class="brand"><Logo size={72} /></span>
      <h1>Bem-vindo ao Discordia</h1>
      <p>Escolha como os amigos vão ver você. Fica salvo só neste navegador.</p>
      <ProfileForm initial={null} submit="Continuar" onsave={setProfile} />
      <div class="mic">
        <span class="label">Microfone</span>
        <MicTest />
      </div>
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
    <Room {session} onleave={() => { session?.close(); session = null; }} onprofile={setProfile} {profile} />
  {/if}
{:else}
  <Home
    {profile}
    {notice}
    {invite}
    oncreate={(invitees) => {
      pendingInvites = invitees;
      void open((s) => s.create());
    }}
    onjoin={(code) => open((s) => s.join(code))}
    onprofile={setProfile}
  />
{/if}

{#if profile}
  {#if friends.panel}
    <FriendsPanel me={profile} room={session?.phase === 'open' ? { code: session.code, name: session.name } : null} onjoin={joinFromFriend} />
  {/if}
  <Incoming room={session?.phase === 'open' ? { code: session.code } : null} onjoin={joinFromFriend} />
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

  .mic {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }

  .brand {
    display: flex;
    justify-content: center;
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
