<script lang="ts">
  // Painel de amigos: lista de quem esteve em salas com você e conversa direta, cifrada de ponta a ponta.
  import { tick } from 'svelte';
  import { formatCode } from '../lib/code';
  import { MAX_DM, friends, type DirectMessage } from '../lib/friends.svelte';
  import type { Profile } from '../lib/protocol';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let {
    me,
    room,
    onjoin,
  }: {
    me: Profile;
    /** Sala em que você está agora: dá para chamar o amigo direto para ela. */
    room: { code: string; name: string } | null;
    onjoin: (code: string) => void;
  } = $props();

  let draft = $state('');
  let list = $state<HTMLElement>();
  let menuOpen = $state(false);

  const friend = $derived(friends.open ? friends.find(friends.open) : undefined);
  const thread = $derived(friends.open ? (friends.threads[friends.open] ?? []) : []);
  const online = (address: string) => !!friends.online[address];

  const ago = (at: number) => {
    const minutes = Math.round((Date.now() - at) / 60_000);
    if (minutes < 1) return 'agora';
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `há ${hours} h`;
    const days = Math.round(hours / 24);
    return days === 1 ? 'ontem' : `há ${days} dias`;
  };
  const time = (at: number) => new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const status = (m: DirectMessage) => (m.status === 'sending' ? 'enviando…' : m.status === 'queued' ? 'entrega quando abrir o app' : m.status === 'failed' ? 'não enviada' : '');

  // Desce para a última mensagem ao abrir a conversa e quando chega algo.
  $effect(() => {
    void thread.length;
    void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

  $effect(() => {
    if (friends.open && thread.length) friends.markRead(friends.open);
  });

  function send(e: Event) {
    e.preventDefault();
    if (!friends.open || !draft.trim()) return;
    void friends.sendText(friends.open, draft, me);
    draft = '';
  }

  function inviteHere() {
    if (!friends.open || !room) return;
    void friends.invite([friends.open], room.code, room.name, me);
  }

  function close() {
    friends.panel = false;
    friends.open = null;
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && friends.panel && close()} />

<div class="scrim" role="presentation" onclick={close}></div>
<aside class="panel" aria-label="Amigos">
  {#if friend}
    <header>
      <button class="icon" aria-label="Voltar para a lista" onclick={() => (friends.open = null)}><Icon name="back" /></button>
      <Avatar name={friend.name} avatar={friend.avatar} color={friend.color} size={34} online={online(friend.address)} />
      <div class="who">
        <strong>{friend.name}</strong>
        <small>{online(friend.address) ? 'online agora' : friend.room ? `esteve com você em ${friend.room}` : 'offline'}</small>
      </div>
      <div class="more">
        <button class="icon" aria-label="Mais opções" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}><Icon name="menu" /></button>
        {#if menuOpen}
          <div class="menu" role="menu">
            <button role="menuitem" onclick={() => { menuOpen = false; friends.forget(friend.address); friends.open = null; }}>Remover dos recentes</button>
            <button role="menuitem" class="danger" onclick={() => { menuOpen = false; friends.block(friend.address); friends.open = null; }}><Icon name="ban" size={16} /> Bloquear</button>
          </div>
        {/if}
      </div>
    </header>

    <ol class="thread" bind:this={list}>
      {#if !thread.length}
        <li class="empty">
          <Icon name="lock" size={18} />
          <span>Só vocês dois leem o que for escrito aqui: as mensagens são cifradas neste navegador.</span>
        </li>
      {/if}
      {#each thread as message (message.id)}
        <li class:mine={message.mine}>
          {#if message.kind === 'invite'}
            <div class="invite">
              <span class="tag"><Icon name="voice" size={14} /> {message.mine ? 'Você chamou para uma sala' : `${friend.name} te chamou`}</span>
              <strong>{message.room}</strong>
              <code>{formatCode(message.code)}</code>
              {#if !message.mine}
                <button class="btn primary" disabled={room?.code === message.code} onclick={() => onjoin(message.code)}>
                  {room?.code === message.code ? 'Você já está nesta sala' : room ? 'Sair desta sala e entrar' : 'Entrar na sala'}
                </button>
              {/if}
            </div>
          {:else}
            <p class="bubble">{message.text}</p>
          {/if}
          <small>{time(message.at)}{#if message.mine && status(message)} · {status(message)}{/if}</small>
        </li>
      {/each}
    </ol>

    <form class="composer" onsubmit={send}>
      {#if room}
        <button type="button" class="btn invite-here" onclick={inviteHere} title="Manda o convite da sala em que você está">
          <Icon name="voice" size={16} /> Chamar para {room.name}
        </button>
      {/if}
      <div class="input">
        <textarea
          aria-label="Mensagem para {friend.name}"
          placeholder="Mensagem para {friend.name}"
          rows="1"
          maxlength={MAX_DM}
          bind:value={draft}
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
        ></textarea>
        <button class="icon send" aria-label="Enviar" disabled={!draft.trim()}><Icon name="send" size={18} /></button>
      </div>
    </form>
  {:else}
    <header>
      <div class="who">
        <strong>Amigos</strong>
        <small>{friends.connected ? 'Quem esteve em salas com você' : 'Conectando…'}</small>
      </div>
      <button class="icon" aria-label="Fechar" onclick={close}><Icon name="close" /></button>
    </header>
    {#if friends.people.length}
      <ul class="people">
        {#each friends.sorted as person (person.address)}
          {@const unread = friends.unread[person.address] ?? 0}
          <li>
            <button class="person" onclick={() => friends.show(person.address)}>
              <Avatar name={person.name} avatar={person.avatar} color={person.color} size={38} online={online(person.address)} />
              <span class="who">
                <strong>{person.name}</strong>
                <small>{online(person.address) ? 'online' : `visto ${ago(person.seen)}`}{person.room ? ` · ${person.room}` : ''}</small>
              </span>
              {#if unread}<span class="badge-count">{unread}</span>{/if}
            </button>
            {#if room}
              <button class="icon call" aria-label="Chamar {person.name} para esta sala" title="Chamar para esta sala" onclick={() => friends.invite([person.address], room.code, room.name, me)}>
                <Icon name="voice" size={18} />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="nobody">
        <Icon name="members" size={28} />
        <p>Quem entrar numa sala com você aparece aqui. Depois dá para mandar mensagem e chamar para uma sala nova, sem precisar passar o link por outro app.</p>
      </div>
    {/if}
  {/if}
</aside>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 44;
    background: rgb(8 8 14 / 45%);
    animation: fade 0.12s;
  }

  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 45;
    display: flex;
    flex-direction: column;
    width: min(400px, 100vw);
    border-left: 1px solid var(--line);
    background: var(--bg-main);
    box-shadow: -18px 0 50px rgb(0 0 0 / 40%);
    animation: slide 0.18s ease-out;
  }

  header {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    height: 64px;
    padding: 0 10px 0 14px;
    border-bottom: 1px solid var(--line);
  }

  .who {
    display: grid;
    flex: 1;
    min-width: 0;
  }

  .who strong,
  .who small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .who small {
    color: var(--text-mute);
    font-size: 12.5px;
  }

  .icon {
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 9px;
    color: var(--text-soft);
    transition: background 0.12s, color 0.12s;
  }

  .icon:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }

  .more {
    position: relative;
  }

  .menu {
    position: absolute;
    top: 40px;
    right: 0;
    z-index: 2;
    display: grid;
    min-width: 190px;
    padding: 5px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-float);
    box-shadow: var(--shadow);
  }

  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    text-align: left;
  }

  .menu button:hover {
    background: var(--bg-hover);
  }

  .menu .danger {
    color: var(--danger);
  }

  .people {
    flex: 1;
    margin: 0;
    padding: 8px;
    overflow-y: auto;
    list-style: none;
  }

  .people li {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .person {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 9px 10px;
    border-radius: 12px;
    text-align: left;
    transition: background 0.12s;
  }

  .person:hover {
    background: var(--bg-hover);
  }

  .call {
    color: var(--accent);
  }

  .nobody {
    display: grid;
    justify-items: center;
    gap: 12px;
    padding: 48px 32px;
    color: var(--text-mute);
    text-align: center;
  }

  .nobody p {
    margin: 0;
  }

  .thread {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding: 16px 14px;
    overflow-y: auto;
    list-style: none;
  }

  .thread li {
    display: grid;
    justify-items: start;
    gap: 3px;
    max-width: 85%;
  }

  .thread li.mine {
    align-self: flex-end;
    justify-items: end;
  }

  .thread small {
    color: var(--text-mute);
    font-size: 11.5px;
  }

  .bubble {
    margin: 0;
    padding: 8px 12px;
    border-radius: 14px 14px 14px 4px;
    background: var(--bg-input);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .mine .bubble {
    border-radius: 14px 14px 4px 14px;
    background: rgb(var(--accent-rgb) / 18%);
  }

  .empty {
    display: flex !important;
    align-items: center;
    gap: 10px;
    align-self: center;
    max-width: 100% !important;
    padding: 12px 14px;
    border: 1px dashed var(--line);
    border-radius: 12px;
    color: var(--text-mute);
    font-size: 13px;
  }

  .invite {
    display: grid;
    gap: 6px;
    min-width: 240px;
    padding: 14px;
    border: 1px solid rgb(var(--accent-rgb) / 35%);
    border-radius: 14px;
    background: linear-gradient(135deg, rgb(var(--accent-rgb) / 14%), rgb(var(--violet-rgb) / 12%)), var(--bg-side);
  }

  .invite .tag {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-size: 12px;
    font-weight: 700;
  }

  .invite strong {
    font-size: 16px;
  }

  .invite code {
    color: var(--text-soft);
    letter-spacing: 0.08em;
  }

  .composer {
    display: grid;
    flex: none;
    gap: 8px;
    padding: 10px 12px 14px;
    border-top: 1px solid var(--line);
  }

  .invite-here {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    color: var(--accent);
    font-size: 13px;
  }

  .input {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 4px 4px 4px 12px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-input);
  }

  .input:focus-within {
    border-color: rgb(var(--accent-rgb) / 60%);
  }

  textarea {
    flex: 1;
    max-height: 140px;
    padding: 8px 0;
    border: 0;
    background: none;
    outline: none;
    resize: none;
    field-sizing: content;
  }

  .send {
    color: var(--accent);
  }

  @keyframes slide {
    from {
      transform: translateX(24px);
      opacity: 0;
    }
  }
</style>
