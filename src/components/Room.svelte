<script lang="ts">
  import { formatCode } from '../lib/code';
  import { SCREEN, screenBitrate, type ScreenQuality } from '../lib/media';
  import { LIMITS } from '../lib/protocol';
  import { addFromLink } from '../lib/youtube';
  import type { Profile } from '../lib/protocol';
  import type { RoomSession } from '../lib/session.svelte';
  import ChannelList from './ChannelList.svelte';
  import Chat from './Chat.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import Members from './Members.svelte';
  import MetricsPanel from './MetricsPanel.svelte';
  import Modal from './Modal.svelte';
  import RadioPanel from './RadioPanel.svelte';
  import RemoteAudio from './RemoteAudio.svelte';
  import SettingsModal from './SettingsModal.svelte';
  import UserMenu from './UserMenu.svelte';
  import VoiceStage from './VoiceStage.svelte';

  let {
    session,
    profile,
    onleave,
    onprofile,
  }: { session: RoomSession; profile: Profile; onleave: () => void; onprofile: (p: Profile) => void } = $props();

  let modal = $state<'invite' | 'settings' | 'screen' | 'leave' | 'channel' | 'radio' | null>(null);
  let radioMode = $state<'youtube' | 'tab'>('youtube');
  let radioLink = $state('');
  let radioTitle = $state('');
  let newChannel = $state<'text' | 'voice'>('text');
  let channelName = $state('');
  let showMembers = $state(innerWidth > 1000);
  let drawer = $state(false);
  let copied = $state(false);
  let quality = $state<ScreenQuality>('detail');
  let withAudio = $state(true);

  const channel = $derived(session.channels.find((c) => c.id === session.active));
  const inviteUrl = $derived(`${location.origin}/#${formatCode(session.code)}`);
  const screenAudioSupported = !navigator.userAgent.includes('Firefox');
  const viewers = $derived(
    Math.min(LIMITS.screenViewers, Math.max(1, session.members.filter((m) => m.voice.channel === session.voice.channel).length - 1)),
  );
  const uploadMbps = $derived((screenBitrate(SCREEN[quality].bitrate, viewers) * viewers) / 1_000_000);
  const unreadTotal = $derived(Object.values(session.unread).reduce((sum, n) => sum + n, 0));

  // Fechar a aba do host encerra a sala para todos: vale perguntar antes.
  function beforeUnload(e: BeforeUnloadEvent) {
    if (session.isHost) e.preventDefault();
  }

  $effect(() => {
    document.title = unreadTotal ? `(${unreadTotal}) Discordia` : 'Discordia';
    return () => {
      document.title = 'Discordia';
    };
  });

  // Limpa o contador ao voltar para a aba com o canal aberto.
  function onVisible() {
    pageVisible = document.visibilityState === 'visible';
    if (document.visibilityState === 'visible' && !session.voiceView) delete session.unread[session.active];
  }

  let pageVisible = $state(document.visibilityState === 'visible');

  $effect(() => {
    const lite = session.lite;
    document.documentElement.toggleAttribute('data-lite', lite);
    session.media.setLite(lite);
    return () => document.documentElement.removeAttribute('data-lite');
  });

  // Vídeo fora da tela: avisa quem envia para parar de codificar e gastar upload.
  $effect(() => {
    const channel = session.voice.channel;
    if (!channel) return;
    for (const member of session.members) {
      if (member.id === session.selfId || member.voice.channel !== channel) continue;
      const want = session.voiceView && pageVisible && !session.settings.gameMode && !session.audioOf(member.name).hideVideo;
      session.media.requestVideo(member.id, want);
    }
  });

  function startRadio() {
    modal = null;
    if (radioMode === 'tab') return void session.startTabRadio(radioTitle);
    session.radioCmd({ cmd: 'start', mode: 'youtube' });
    if (radioLink.trim()) void addFromLink(session, radioLink);
    radioLink = '';
  }

  function typing(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!session.voice.channel) return;
    if (e.altKey && e.shiftKey && e.code === 'KeyM') {
      e.preventDefault();
      session.setMuted(!session.voice.muted);
    } else if (e.altKey && e.shiftKey && e.code === 'KeyD') {
      e.preventDefault();
      session.toggleDeafen();
    } else if (session.settings.pushToTalk && e.code === session.settings.pushToTalkKey && !e.repeat && !typing(e)) {
      session.holdToTalk(true);
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.code === session.settings.pushToTalkKey) session.holdToTalk(false);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      session.toast('Não foi possível copiar. Selecione o texto manualmente.');
    }
  }
</script>

<svelte:window onbeforeunload={beforeUnload} onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={() => session.holdToTalk(false)} />
<svelte:document onvisibilitychange={onVisible} />

<div class="room" class:no-members={!showMembers}>
  <nav class="rail" aria-label="Servidores">
    <span class="current"><span class="server"><Logo size={48} /></span></span>
    <hr />
    <button class="pill" aria-label="Convidar amigos" title="Convidar amigos" onclick={() => (modal = 'invite')}><Icon name="plus" size={22} /></button>
    <span class="spacer"></span>
    {#if session.isHost}
      <button
        class="pill"
        aria-label={session.locked ? 'Destrancar sala' : 'Trancar sala'}
        title={session.locked ? 'Sala trancada' : 'Trancar sala'}
        class:warn={session.locked}
        onclick={() => session.moderate({ action: 'lock', locked: !session.locked })}
      >
        <Icon name={session.locked ? 'lock' : 'unlock'} />
      </button>
    {/if}
    <button class="pill exit" aria-label={session.isHost ? 'Encerrar sala' : 'Sair da sala'} title={session.isHost ? 'Encerrar sala' : 'Sair da sala'} onclick={() => (session.isHost ? (modal = 'leave') : onleave())}>
      <Icon name="logout" />
    </button>
  </nav>

  <div class="side" class:open={drawer}>
    <ChannelList
      {session}
      {profile}
      oninvite={() => (modal = 'invite')}
      onsettings={() => (modal = 'settings')}
      onnewchannel={(kind) => {
        newChannel = kind;
        channelName = '';
        modal = 'channel';
      }}
    />
  </div>
  {#if drawer}<button class="scrim" aria-label="Fechar menu" onclick={() => (drawer = false)}></button>{/if}

  <main>
    <header>
      <button class="burger" aria-label="Abrir canais" onclick={() => (drawer = true)}><Icon name="menu" /></button>
      {#if session.voiceView}
        <Icon name="voice" /><strong>{session.channels.find((c) => c.id === session.voice.channel)?.name}</strong>
      {:else}
        <Icon name="hash" /><strong>{channel?.name}</strong>
      {/if}
      <span class="grow"></span>
      <button class="code" title="Copiar código" onclick={() => copy(formatCode(session.code))}>
        <code>{formatCode(session.code)}</code><Icon name="copy" size={15} />
      </button>
      <button class="toggle" aria-label="Métricas de desempenho" aria-pressed={session.settings.metrics} title="Métricas de desempenho" onclick={() => session.updateSettings({ metrics: !session.settings.metrics })}><Icon name="gauge" /></button>
      <button class="phone-exit" aria-label={session.isHost ? 'Encerrar sala' : 'Sair da sala'} onclick={() => (session.isHost ? (modal = 'leave') : onleave())}><Icon name="logout" /></button>
      <button class="toggle" aria-label="Mostrar ou ocultar membros" aria-pressed={showMembers} onclick={() => (showMembers = !showMembers)}><Icon name="members" /></button>
    </header>

    {#if session.phase === 'reconnecting'}
      <div class="banner" role="status">{session.hostReloading ? 'O host está recarregando a sala. Sua voz com os outros continua…' : 'Conexão perdida. Tentando voltar à sala…'}</div>
    {/if}
    {#if session.audioBlocked}
      <button class="banner" onclick={() => session.unblockAudio()}>Clique para ouvir a chamada</button>
    {/if}

    <div class="content">
      {#if session.voiceView && session.voice.channel}
        <VoiceStage {session} onscreen={() => (modal = 'screen')} onradio={() => (modal = 'radio')} />
      {:else}
        <Chat {session} />
      {/if}
      {#if session.radioHere}<RadioPanel {session} />{/if}
      {#if showMembers}<Members {session} />{/if}
    </div>
  </main>
</div>

{#if session.settings.metrics}<MetricsPanel {session} />{/if}
<RemoteAudio {session} />
<UserMenu {session} />

<div class="toasts" aria-live="polite">
  {#each session.toasts as toast (toast.id)}
    <div class="toast">{toast.text}</div>
  {/each}
</div>

{#if modal === 'invite'}
  <Modal title="Convide seus amigos" onclose={() => (modal = null)}>
    <p class="muted">Envie o código ou o link. Quem tiver um deles consegue entrar enquanto a sala não estiver trancada.</p>
    <div class="invite-code">{formatCode(session.code)}</div>
    <div class="invite-actions">
      <button class="btn primary" onclick={() => copy(formatCode(session.code))}>{copied ? 'Copiado!' : 'Copiar código'}</button>
      <button class="btn" onclick={() => copy(inviteUrl)}>Copiar link</button>
    </div>
  </Modal>
{:else if modal === 'settings'}
  <SettingsModal {session} {profile} {onprofile} onclose={() => (modal = null)} />
{:else if modal === 'screen'}
  <Modal title="Compartilhar tela" onclose={() => (modal = null)}>
    <div class="options">
      <label class:on={quality === 'detail'}>
        <input type="radio" bind:group={quality} value="detail" />
        <span><strong>Texto e código</strong><small>1080p a 15 qps, prioriza nitidez</small></span>
      </label>
      <label class:on={quality === 'motion'}>
        <input type="radio" bind:group={quality} value="motion" />
        <span><strong>Vídeo e jogos</strong><small>720p a 30 qps, prioriza fluidez</small></span>
      </label>
      <label class:on={quality === 'full'}>
        <input type="radio" bind:group={quality} value="full" />
        <span><strong>Alta qualidade</strong><small>1080p a 30 qps, exige bom upload</small></span>
      </label>
      <!-- Reservado para o futuro; veja SCREEN em lib/media.ts.
      <label class:on={quality === 'high'}>
        <input type="radio" bind:group={quality} value="high" />
        <span><strong>Alta qualidade</strong><small>1080p a 60 qps, exige internet e PC bons</small></span>
      </label>
      -->
    </div>
    <p class="upload">Upload necessário: até <strong>{uploadMbps.toLocaleString('pt-BR')} Mbps</strong>, com {viewers} {viewers === 1 ? 'espectador' : 'espectadores'}.</p>
    <label class="audio-option">
      <input type="checkbox" bind:checked={withAudio} disabled={!screenAudioSupported} />
      <span>
        Compartilhar áudio
        <small>{screenAudioSupported ? 'Para ouvir o jogo: no Windows, escolha "Tela inteira" e ligue "Compartilhar áudio do sistema". Compartilhar só a janela costuma vir sem som.' : 'O Firefox não captura áudio da tela.'}</small>
      </span>
    </label>
    <button class="btn primary wide" onclick={() => { modal = null; void session.startScreen(quality, withAudio && screenAudioSupported); }}>Escolher o que compartilhar</button>
  </Modal>
{:else if modal === 'radio'}
  <Modal title="Iniciar rádio" onclose={() => (modal = null)}>
    <div class="options">
      <label class:on={radioMode === 'youtube'}>
        <input type="radio" bind:group={radioMode} value="youtube" />
        <span><strong>YouTube</strong><small>Vídeo ou playlist. Cada pessoa toca no próprio player, sem usar seu upload.</small></span>
      </label>
      <label class:on={radioMode === 'tab'}>
        <input type="radio" bind:group={radioMode} value="tab" />
        <span><strong>Áudio de uma aba</strong><small>Transmite só o som de uma aba, sem vídeo. Chrome e Edge; ~130 kbps por pessoa.</small></span>
      </label>
    </div>
    {#if radioMode === 'youtube'}
      <label class="label top" for="radio-link">Link do YouTube (opcional)</label>
      <input id="radio-link" class="field" bind:value={radioLink} placeholder="https://youtube.com/playlist?list=..." autocomplete="off" />
    {:else}
      <label class="label top" for="radio-title">O que está tocando (opcional)</label>
      <input id="radio-title" class="field" bind:value={radioTitle} maxlength="120" autocomplete="off" />
      <p class="muted top">Na próxima janela, escolha a aba e marque a opção de compartilhar o áudio.</p>
    {/if}
    <button class="btn primary wide" onclick={startRadio}>Iniciar rádio</button>
  </Modal>
{:else if modal === 'leave'}
  <Modal title="Encerrar a sala?" onclose={() => (modal = null)}>
    <p class="muted">Você é o host. Ao sair, a sala acaba para todos e o histórico da conversa é apagado.</p>
    <div class="invite-actions">
      <button class="btn" onclick={() => (modal = null)}>Continuar na sala</button>
      <button class="btn danger" onclick={onleave}>Encerrar sala</button>
    </div>
  </Modal>
{:else if modal === 'channel'}
  <Modal title={newChannel === 'text' ? 'Novo canal de texto' : 'Novo canal de voz'} onclose={() => (modal = null)}>
    <form onsubmit={(e) => {
      e.preventDefault();
      if (!channelName.trim()) return;
      session.moderate({ action: 'add-channel', kind: newChannel, name: channelName });
      modal = null;
    }}>
      <label class="label" for="channel-name">Nome do canal</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="channel-name" class="field" bind:value={channelName} maxlength="32" autofocus autocomplete="off" />
      <button class="btn primary wide" disabled={!channelName.trim()}>Criar canal</button>
    </form>
  </Modal>
{/if}

<style>
  .room {
    display: grid;
    grid-template-columns: 72px 240px minmax(0, 1fr);
    height: 100dvh;
  }

  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px 0;
    background: var(--bg-rail);
  }

  .current {
    position: relative;
    display: block;
    width: 48px;
    height: 48px;
  }

  /* Indicador de servidor ativo, na borda do trilho. */
  .current::before {
    content: '';
    position: absolute;
    top: 8px;
    bottom: 8px;
    left: -12px;
    width: 4px;
    border-radius: 0 4px 4px 0;
    background: var(--gold);
  }

  .server {
    display: block;
    width: 48px;
    height: 48px;
    border-radius: 15px;
    box-shadow: 0 6px 18px rgb(var(--accent-rgb) / 18%);
  }

  hr {
    width: 32px;
    margin: 0;
    border: 0;
    border-top: 2px solid var(--line);
  }

  .pill {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 24px;
    background: var(--bg-side);
    color: var(--accent);
    transition: border-radius 0.15s, background 0.15s, color 0.15s;
  }

  .pill:hover {
    border-radius: 16px;
    background: var(--gold);
    color: var(--on-accent);
  }

  .pill.warn {
    background: var(--gold);
    color: var(--on-accent);
  }

  .pill.exit {
    color: var(--danger);
  }

  .pill.exit:hover {
    background: var(--danger);
    color: #fff;
  }

  .spacer {
    flex: 1;
  }

  .side {
    display: flex;
    min-height: 0;
  }

  .side > :global(aside) {
    flex: 1;
    min-width: 0;
  }

  main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-main);
  }

  main > header {
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
    height: 48px;
    padding: 0 14px;
    border-bottom: 1px solid var(--line);
    box-shadow: 0 1px 8px rgb(0 0 0 / 22%);
    color: var(--text-mute);
    z-index: 1;
  }

  header strong {
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grow {
    flex: 1;
  }

  .code {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-deep);
    color: var(--text-soft);
    font-size: 13px;
    transition: border-color 0.12s;
  }

  .code:hover {
    border-color: rgb(var(--accent-rgb) / 45%);
  }

  .code code {
    letter-spacing: 0.08em;
  }

  .toggle[aria-pressed='true'] {
    color: var(--text);
  }

  .burger,
  .phone-exit {
    display: none;
  }

  .banner {
    flex: none;
    width: 100%;
    padding: 6px 14px;
    background: var(--gold);
    color: var(--on-accent);
    font-weight: 600;
    text-align: center;
  }

  .content {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .toasts {
    position: fixed;
    bottom: 80px;
    left: 50%;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transform: translateX(-50%);
  }

  .toast {
    max-width: min(420px, 90vw);
    padding: 11px 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-float);
    box-shadow: var(--shadow);
    animation: pop-in 0.16s ease-out;
  }

  .muted {
    margin-top: 0;
    color: var(--text-soft);
  }

  .invite-code {
    margin-bottom: 14px;
    padding: 16px;
    border: 1px dashed rgb(var(--accent-rgb) / 40%);
    border-radius: 14px;
    background: var(--bg-deep);
    color: var(--accent-strong);
    font: 700 30px/1 ui-monospace, monospace;
    letter-spacing: 0.14em;
    text-align: center;
    user-select: all;
  }

  .invite-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .options {
    display: grid;
    gap: 8px;
  }

  .options label {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
  }

  .options label:hover {
    background: var(--bg-hover);
  }

  .options .on {
    border-color: var(--accent);
    background: rgb(var(--accent-rgb) / 8%);
  }

  .options input,
  .audio-option input {
    accent-color: var(--accent);
  }

  small {
    display: block;
    color: var(--text-mute);
  }

  .top {
    margin-top: 14px;
  }

  .upload {
    margin: 10px 0 0;
    color: var(--text-soft);
    font-size: 14px;
  }

  .audio-option {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }

  .wide {
    width: 100%;
    margin-top: 16px;
  }

  .scrim {
    display: none;
  }

  @media (max-width: 1000px) {
    .content > :global(aside) {
      position: absolute;
      top: 48px;
      right: 0;
      bottom: 0;
      z-index: 15;
      box-shadow: -8px 0 24px rgb(0 0 0 / 40%);
    }

    main {
      position: relative;
    }

    .room.no-members .content > :global(aside) {
      display: none;
    }
  }

  @media (max-width: 720px) {
    .room {
      grid-template-columns: minmax(0, 1fr);
    }

    .rail {
      display: none;
    }

    .side {
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      z-index: 30;
      width: min(280px, 85vw);
      transform: translateX(-100%);
      transition: transform 0.16s ease-out;
    }

    .side.open {
      transform: none;
    }

    .scrim {
      position: fixed;
      inset: 0;
      z-index: 25;
      display: block;
      background: rgb(0 0 0 / 50%);
    }

    .burger,
    .phone-exit {
      display: block;
    }

    .content {
      flex-direction: column;
    }

    .phone-exit {
      color: var(--danger);
    }
  }
</style>
