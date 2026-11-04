<script lang="ts">
  import { untrack } from 'svelte';
  import { formatCode } from '../lib/code';
  import { SCREEN, screenBitrate, type ScreenQuality } from '../lib/media';
  import { LIMITS } from '../lib/protocol';
  import { addFromLink } from '../lib/youtube';
  import type { Profile } from '../lib/protocol';
  import type { RoomSession } from '../lib/session.svelte';
  import ChannelList from './ChannelList.svelte';
  import Chat from './Chat.svelte';
  import Icon from './Icon.svelte';
  import Members from './Members.svelte';
  import MetricsPanel from './MetricsPanel.svelte';
  import Modal from './Modal.svelte';
  import RadioPanel from './RadioPanel.svelte';
  import RemoteAudio from './RemoteAudio.svelte';
  import SettingsModal from './SettingsModal.svelte';
  import SourcePicker from './SourcePicker.svelte';
  import { desktop } from '../lib/platform';
  import { friends } from '../lib/friends.svelte';
  import Avatar from './Avatar.svelte';
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
  let showMembers = $state(false);
  let drawer = $state(false);
  let copied = $state(false);
  let quality = $state<ScreenQuality>('detail');
  let withAudio = $state(true);

  const channel = $derived(session.channels.find((c) => c.id === session.active));
  // No app a página roda em app://, que não serve como convite: o link aponta para o site.
  const site = location.protocol === 'app:' ? (import.meta.env.VITE_PUBLIC_URL ?? location.origin) : location.origin;
  const inviteUrl = $derived(`${site.replace(/\/$/, '')}/#${formatCode(session.code)}`);
  const screenAudioSupported = desktop ? desktop.systemAudio : !navigator.userAgent.includes('Firefox');
  const viewers = $derived(
    Math.min(LIMITS.screenViewers, Math.max(1, session.members.filter((m) => m.voice.channel === session.voice.channel).length - 1)),
  );
  const uploadMbps = $derived((screenBitrate(SCREEN[quality].bitrate, viewers) * viewers) / 1_000_000);
  const unreadTotal = $derived(Object.values(session.unread).reduce((sum, n) => sum + n, 0));

  // Fechar a aba do host encerra a sala para todos: vale perguntar antes.
  function beforeUnload(e: BeforeUnloadEvent) {
    if (session.isHost) e.preventDefault();
  }

  // Fora da sala volta o título descritivo do index.html, que é o que aparece nas buscas.
  const homeTitle = document.title;
  $effect(() => {
    document.title = unreadTotal ? `(${unreadTotal}) Discordia` : 'Discordia';
    return () => {
      document.title = homeTitle;
    };
  });

  // Limpa o contador ao voltar para a aba com o canal aberto.
  function onVisible() {
    pageVisible = document.visibilityState === 'visible';
    if (document.visibilityState === 'visible' && session.chatVisible) delete session.unread[session.active];
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

  // --- App de computador: atalhos globais, bandeja e mini janela ---
  $effect(() => {
    if (!desktop) return;
    const offs = [
      desktop.onPushToTalk((held) => session.holdToTalk(held)),
      desktop.onShortcut((shortcut) => {
        if (!session.voice.channel) return;
        if (shortcut === 'mute') void session.setMuted(!session.voice.muted);
        else if (shortcut === 'deafen') session.toggleDeafen();
        else session.radioShortcut(({ 'radio-pause': 'pause', 'radio-next': 'next', 'radio-up': 'up', 'radio-down': 'down' } as const)[shortcut]);
      }),
      desktop.onCallAction((action) => {
        if (!session.voice.channel) return;
        if (action === 'mute') void session.setMuted(!session.voice.muted);
        else if (action === 'deafen') session.toggleDeafen();
        else if (action === 'leave') session.leaveVoice();
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      desktop?.setPushToTalk(null);
      desktop?.updateCall(null);
    };
  });

  $effect(() => {
    desktop?.setPushToTalk(session.settings.pushToTalk && session.voice.channel ? session.settings.pushToTalkKey : null);
  });

  $effect(() => {
    desktop?.setMiniWindow(session.settings.miniWindow);
  });

  $effect(() => {
    if (!desktop) return;
    const channel = session.voice.channel;
    desktop.updateCall(
      channel
        ? {
            channel: session.channels.find((c) => c.id === channel)?.name ?? 'Voz',
            muted: session.voice.muted,
            deafened: session.voice.deafened,
            people: session.members
              .filter((m) => m.voice.channel === channel)
              .map((m) => ({ name: m.name, color: m.color, speaking: m.speaking, self: m.id === session.selfId })),
          }
        : null,
    );
  });

  function onKeyDown(e: KeyboardEvent) {
    if (!session.voice.channel) return;
    // No app esses atalhos são globais e chegam pelo processo principal; aqui contariam em dobro.
    if (desktop && e.altKey && e.shiftKey) return;
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

  // Quem está na sala vira amigo recente. A chave muda só quando alguém entra, sai ou troca o perfil,
  // não a cada vez que alguém fala.
  const roster = $derived(session.members.map((m) => `${m.id}:${m.name}:${m.friend ?? ''}:${m.avatar.length}`).join('|'));
  $effect(() => {
    void roster;
    for (const member of untrack(() => session.members)) {
      if (member.id !== session.selfId) void friends.remember(member, session.name);
    }
  });

  let called = $state<string[]>([]);
  function callFriend(address: string) {
    called = [...called, address];
    void friends.invite([address], session.code, session.name, profile);
  }

  // Convidar copia o link na hora e mostra o código grande, para ditar.
  function invite() {
    void copy(inviteUrl);
    modal = 'invite';
  }

  const leave = () => (session.isHost ? (modal = 'leave') : onleave());
  const voiceName = $derived(session.channels.find((c) => c.id === session.voice.channel)?.name);
  const inCall = $derived(session.members.filter((m) => m.voice.channel === session.voice.channel).length);

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

<div class="room">
  <div class="side" class:open={drawer}>
    <ChannelList
      {session}
      {profile}
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
      <button class="icon burger" aria-label="Abrir canais" onclick={() => (drawer = true)}><Icon name="menu" /></button>
      {#if session.voiceView && session.voice.channel}
        <Icon name="voice" /><strong>{voiceName}</strong>
        <span class="count">{inCall} {inCall === 1 ? 'pessoa' : 'pessoas'}</span>
      {:else}
        <Icon name="hash" /><strong>{channel?.name}</strong>
      {/if}
      <span class="grow"></span>
      <button class="invite code" title="Copia o link de convite" onclick={invite}>
        <Icon name="plus" size={16} /><span class="label-text">Convidar</span><code>{formatCode(session.code)}</code>
      </button>
      <button class="icon friends" aria-label="Amigos" title="Amigos e mensagens" onclick={() => friends.show()}>
        <Icon name="chat" />
        {#if friends.totalUnread}<span class="badge-count">{friends.totalUnread}</span>{/if}
      </button>
      <button class="icon" aria-label="Métricas de desempenho" aria-pressed={session.settings.metrics} title="Métricas de desempenho" onclick={() => session.updateSettings({ metrics: !session.settings.metrics })}><Icon name="gauge" /></button>
      <button class="icon" aria-label="Mostrar ou ocultar membros" title="Membros" aria-pressed={showMembers} onclick={() => (showMembers = !showMembers)}><Icon name="members" /></button>
      {#if session.isHost}
        <button
          class="icon"
          class:warn={session.locked}
          aria-label={session.locked ? 'Destrancar sala' : 'Trancar sala'}
          title={session.locked ? 'Sala trancada: ninguém novo entra' : 'Trancar sala'}
          onclick={() => session.moderate({ action: 'lock', locked: !session.locked })}
        >
          <Icon name={session.locked ? 'lock' : 'unlock'} />
        </button>
      {/if}
      <button class="icon exit" aria-label={session.isHost ? 'Encerrar sala' : 'Sair da sala'} title={session.isHost ? 'Encerrar sala' : 'Sair da sala'} onclick={leave}><Icon name="logout" /></button>
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
        {#if session.callChat}
          <div class="call-chat">
            <div class="call-chat-head">
              <Icon name="hash" size={16} /><strong>{channel?.name}</strong>
              <button class="icon" aria-label="Recolher chat" title="Recolher chat" onclick={() => (session.callChat = false)}><Icon name="close" size={16} /></button>
            </div>
            <Chat {session} />
          </div>
        {/if}
      {:else}
        <Chat {session} />
      {/if}
      {#if session.radioHere}<RadioPanel {session} />{/if}
      {#if showMembers}
        <div class="members-pop"><Members {session} /></div>
      {/if}
    </div>
  </main>
</div>

{#if session.settings.metrics}<MetricsPanel {session} />{/if}
<RemoteAudio {session} />
<SourcePicker />
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
    {#if friends.people.length}
      <span class="label top">Chamar amigos recentes</span>
      <ul class="call-list">
        {#each friends.sorted.filter((p) => !session.members.some((m) => m.friend === p.pub)).slice(0, 8) as person (person.address)}
          <li>
            <Avatar name={person.name} avatar={person.avatar} color={person.color} size={32} online={!!friends.online[person.address]} />
            <span><strong>{person.name}</strong><small>{friends.online[person.address] ? 'online' : 'recebe quando abrir o Discordia'}</small></span>
            <button class="btn" disabled={called.includes(person.address)} onclick={() => callFriend(person.address)}>
              {called.includes(person.address) ? 'Chamado' : 'Chamar'}
            </button>
          </li>
        {:else}
          <li class="all-here">Todos os seus amigos recentes já estão aqui.</li>
        {/each}
      </ul>
    {/if}
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
        <small>{desktop ? (screenAudioSupported ? 'O som do computador vai junto, de qualquer tela ou janela.' : 'Neste sistema o app ainda não captura o som do computador.') : screenAudioSupported ? 'Para ouvir o jogo: no Windows, escolha "Tela inteira" e ligue "Compartilhar áudio do sistema". Compartilhar só a janela costuma vir sem som.' : 'O Firefox não captura áudio da tela.'}</small>
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
        <span><strong>Áudio de uma aba</strong><small>{desktop ? 'No app, transmite o som do computador (só Windows), sem vídeo; ~130 kbps por pessoa.' : 'Transmite só o som de uma aba, sem vídeo. Chrome e Edge; ~130 kbps por pessoa.'}</small></span>
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
    grid-template-columns: 248px minmax(0, 1fr);
    height: 100dvh;
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
    position: relative;
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
    gap: 6px;
    height: 52px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--line);
    color: var(--text-mute);
    z-index: 2;
  }

  header strong {
    overflow: hidden;
    color: var(--text);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    margin-left: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-input);
    color: var(--text-soft);
    font-size: 12px;
    white-space: nowrap;
  }

  .grow {
    flex: 1;
  }

  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    color: var(--text-mute);
    transition: background 0.12s, color 0.12s;
  }

  .icon:hover,
  .icon[aria-pressed='true'] {
    background: var(--bg-hover);
    color: var(--text);
  }

  .icon.warn {
    background: rgb(var(--accent-rgb) / 16%);
    color: var(--accent);
  }

  .icon.exit:hover {
    background: rgb(240 82 92 / 16%);
    color: var(--danger);
  }

  /* Convidar é a ação mais importante da sala: dourado, sempre à vista. */
  .invite {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: 34px;
    margin-right: 6px;
    padding: 0 6px 0 10px;
    border-radius: 9px;
    background: var(--gold);
    color: var(--on-accent);
    font-weight: 700;
    font-size: 13px;
    transition: filter 0.12s;
  }

  .invite:hover {
    filter: brightness(1.08);
  }

  .invite code {
    padding: 3px 7px;
    border-radius: 6px;
    background: rgb(0 0 0 / 18%);
    font-size: 12px;
    letter-spacing: 0.08em;
  }

  .burger {
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
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .call-chat {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 340px;
    min-height: 0;
    border-left: 1px solid var(--line);
    background: var(--bg-main);
  }

  .call-chat-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    height: 44px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--line);
    color: var(--text-mute);
  }

  .call-chat-head strong {
    flex: 1;
  }

  .call-chat :global(.intro) {
    display: none;
  }

  .members-pop {
    position: absolute;
    top: 8px;
    right: 8px;
    bottom: 8px;
    z-index: 15;
    display: flex;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow);
    animation: pop-in 0.14s ease-out;
  }

  .toasts {
    position: fixed;
    bottom: 96px;
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

  .friends {
    position: relative;
  }

  .friends .badge-count {
    position: absolute;
    top: -2px;
    right: -4px;
  }

  .call-list {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .call-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px;
  }

  .call-list span {
    flex: 1;
    min-width: 0;
  }

  .call-list .btn {
    padding: 7px 14px;
    font-size: 13px;
  }

  .all-here {
    color: var(--text-mute);
    font-size: 14px;
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

  @media (max-width: 1200px) {
    .call-chat {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 12;
      box-shadow: -8px 0 24px rgb(0 0 0 / 40%);
    }
  }

  @media (max-width: 1000px) {
    .content > :global(aside.radio) {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 14;
      box-shadow: -8px 0 24px rgb(0 0 0 / 40%);
    }
  }

  @media (max-width: 720px) {
    .room {
      grid-template-columns: minmax(0, 1fr);
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

    .burger {
      display: grid;
    }

    .count,
    .invite .label-text {
      display: none;
    }

    .content {
      flex-direction: column;
    }

    .call-chat {
      width: 100%;
    }

    .content > :global(aside.radio) {
      position: static;
    }
  }
</style>
