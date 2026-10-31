<script lang="ts">
  import { formatBytes, formatTime, segments } from '../lib/format';
  import type { Message } from '../lib/protocol';
  import type { RoomSession } from '../lib/session.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  const QUICK = ['👍', '😂', '❤️', '🔥', '😮'];

  let {
    session,
    message,
    compact,
    onreply,
  }: { session: RoomSession; message: Message; compact: boolean; onreply: (m: Message) => void } = $props();

  let editing = $state(false);
  let draft = $state('');
  const mine = $derived(message.author === session.selfId);

  function startEdit() {
    draft = message.text;
    editing = true;
  }

  function saveEdit() {
    if (draft.trim() && draft !== message.text) session.editMessage(message.channel, message.id, draft);
    editing = false;
  }

  const names = $derived(session.members.map((m) => m.name));
  const reply = $derived(message.replyTo ? session.messages[message.channel]?.find((m) => m.id === message.replyTo) : undefined);
  const mentioned = $derived(session.mentionsMe(message.text));
  const isImage = $derived(message.attachment?.type.startsWith('image/') && message.attachment.data);
</script>

{#if message.system}
  <div class="system">{message.text}</div>
{:else}
  <article class:compact class:mentioned>
    {#if reply}
      <div class="reply"><Icon name="reply" size={13} /><strong>{reply.authorName}</strong><span>{reply.text || 'anexo'}</span></div>
    {/if}
    <div class="row">
      <div class="gutter">
        {#if !compact}<Avatar name={message.authorName} avatar={message.authorAvatar} color={message.authorColor} />{/if}
      </div>
      <div class="body">
        {#if !compact}
          <div class="meta">
            <strong style:color={message.authorColor}>{message.authorName}</strong>
            <time>{formatTime(message.ts)}</time>
          </div>
        {/if}
        {#if editing}
          <!-- svelte-ignore a11y_autofocus -->
          <textarea
            class="edit"
            aria-label="Editar mensagem"
            bind:value={draft}
            autofocus
            onkeydown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveEdit();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                editing = false;
              }
            }}
          ></textarea>
          <small class="hint">Enter para salvar · Esc para cancelar</small>
        {:else if message.text}
          <p>
            {#each segments(message.text, names) as part}
              {#if part.kind === 'link'}<a href={part.value} target="_blank" rel="noopener noreferrer">{part.value}</a>
              {:else if part.kind === 'mention'}<mark>{part.value}</mark>
              {:else}{part.value}{/if}
            {/each}
            {#if message.edited}<small class="hint">(editada)</small>{/if}
          </p>
        {/if}
        {#if message.attachment}
          {#if isImage}
            <a class="image" href={message.attachment.data} download={message.attachment.name}>
              <img src={message.attachment.data} alt={message.attachment.name} loading="lazy" />
            </a>
          {:else if message.attachment.data}
            <a class="file" href={message.attachment.data} download={message.attachment.name}>
              <Icon name="download" />
              <span>{message.attachment.name}<small>{formatBytes(message.attachment.size)}</small></span>
            </a>
          {:else}
            <p class="expired">Anexo expirado: {message.attachment.name}</p>
          {/if}
        {/if}
        {#if Object.keys(message.reactions).length}
          <div class="reactions">
            {#each Object.entries(message.reactions) as [emoji, users]}
              <button class:mine={users.includes(session.selfId)} onclick={() => session.react(message.channel, message.id, emoji)}>
                {emoji} {users.length}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
    <div class="tools">
      {#each QUICK as emoji}
        <button aria-label="Reagir com {emoji}" onclick={() => session.react(message.channel, message.id, emoji)}>{emoji}</button>
      {/each}
      <button aria-label="Responder" onclick={() => onreply(message)}><Icon name="reply" size={16} /></button>
      {#if mine && message.text}
        <button aria-label="Editar" onclick={startEdit}><Icon name="pencil" size={15} /></button>
      {/if}
      {#if mine || session.isHost}
        <button aria-label="Apagar mensagem" onclick={() => session.deleteMessage(message.channel, message.id)}><Icon name="trash" size={15} /></button>
      {/if}
    </div>
  </article>
{/if}

<style>
  article {
    position: relative;
    margin-top: 16px;
    padding: 3px 18px;
    transition: background 0.1s;
    animation: pop-in 0.16s ease-out;
    /* Mensagens fora da tela não gastam layout nem pintura. */
    content-visibility: auto;
    contain-intrinsic-size: auto 60px;
  }

  article.compact {
    margin-top: 0;
  }

  article:hover {
    background: rgb(255 255 255 / 3%);
  }

  article.mentioned {
    box-shadow: inset 2px 0 0 var(--accent);
    background: rgb(var(--accent-rgb) / 9%);
  }

  .row {
    display: flex;
    gap: 14px;
  }

  .gutter {
    flex: none;
    width: 40px;
  }

  .body {
    flex: 1;
    min-width: 0;
  }

  .meta strong {
    font-weight: 650;
  }

  .meta {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  time {
    color: var(--text-mute);
    font-size: 11.5px;
  }

  p {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  a {
    color: var(--accent-strong);
  }

  mark {
    padding: 0 2px;
    border-radius: 3px;
    background: rgb(232 163 61 / 25%);
    color: var(--accent-strong);
  }

  .edit {
    width: 100%;
    min-height: 44px;
    padding: 8px;
    border: 1px solid var(--accent);
    border-radius: 8px;
    outline: 0;
    background: var(--bg-input);
    resize: vertical;
  }

  .hint {
    color: var(--text-mute);
    font-size: 11.500px;
  }

  .reply {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 54px;
    color: var(--text-mute);
    font-size: 13px;
  }

  .reply span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .image img {
    display: block;
    max-width: min(400px, 100%);
    max-height: 300px;
    margin-top: 6px;
    border-radius: 12px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 30%);
  }

  .file {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    max-width: 100%;
    margin-top: 6px;
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-side);
    text-decoration: none;
  }

  .file small {
    display: block;
    color: var(--text-mute);
  }

  .expired {
    color: var(--text-mute);
    font-style: italic;
  }

  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .reactions button {
    padding: 1px 8px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: var(--bg-side);
    font-size: 14px;
    transition: background 0.12s, border-color 0.12s;
  }

  .reactions button:hover {
    border-color: var(--line);
    background: var(--bg-hover);
  }

  .reactions .mine {
    border-color: var(--accent);
    background: rgb(232 163 61 / 15%);
  }

  .tools {
    position: absolute;
    top: -14px;
    right: 16px;
    z-index: 2;
    display: none;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-side);
    box-shadow: 0 4px 14px rgb(0 0 0 / 40%);
  }

  article:hover .tools,
  .tools:focus-within {
    display: flex;
  }

  .tools button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 7px;
  }

  .tools button:hover {
    background: var(--bg-hover);
  }

  .system {
    margin-top: 10px;
    padding: 0 16px 0 70px;
    color: var(--text-mute);
    font-size: 14px;
  }
</style>
