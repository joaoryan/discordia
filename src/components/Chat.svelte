<script lang="ts">
  import { tick } from 'svelte';
  import { readDataUrl } from '../lib/format';
  import { LIMITS, type Attachment, type Message } from '../lib/protocol';
  import type { RoomSession } from '../lib/session.svelte';
  import Icon from './Icon.svelte';
  import MessageView from './Message.svelte';

  const EMOJIS = ['😀', '😂', '🥹', '😍', '😎', '🤔', '😭', '😡', '👍', '👎', '🙏', '👏', '🔥', '🎉', '❤️', '💀', '🍎', '🎮', '☕', '🚀'];
  const GROUP_MS = 5 * 60 * 1000;

  let { session }: { session: RoomSession } = $props();

  let list = $state<HTMLElement>();
  let box = $state<HTMLTextAreaElement>();
  let drafts = $state<Record<string, string>>({});
  let replying = $state<Message | null>(null);
  let pending = $state<Attachment | null>(null);
  let emojiOpen = $state(false);
  let dragging = $state(false);
  let mentionIndex = $state(0);
  let pinned = true;

  const channel = $derived(session.channels.find((c) => c.id === session.active));
  const messages = $derived(session.messages[session.active] ?? []);
  const draft = $derived(drafts[session.active] ?? '');
  const typers = $derived(
    Object.keys(session.typing[session.active] ?? {})
      .map((id) => session.members.find((m) => m.id === id)?.name)
      .filter(Boolean),
  );
  const mentionQuery = $derived(draft.match(/(?:^|\s)@([^\s@]*)$/)?.[1]);
  const mentionOptions = $derived(
    mentionQuery === undefined
      ? []
      : session.members.filter((m) => m.id !== session.selfId && m.name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 6),
  );

  $effect(() => {
    void messages.length;
    void session.active;
    if (pinned) void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

  function compactAt(i: number) {
    const current = messages[i];
    const previous = messages[i - 1];
    return (
      !!previous &&
      !previous.system &&
      !current.replyTo &&
      previous.author === current.author &&
      current.ts - previous.ts < GROUP_MS
    );
  }

  function submit() {
    if (!draft.trim() && !pending) return;
    session.sendChat(session.active, draft, replying?.id, pending ?? undefined);
    drafts[session.active] = '';
    replying = null;
    pending = null;
    emojiOpen = false;
    pinned = true;
    if (box) box.style.height = '';
  }

  function applyMention(name: string) {
    drafts[session.active] = draft.replace(/@[^\s@]*$/, `@${name} `);
    box?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (mentionOptions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        mentionIndex = (mentionIndex + step + mentionOptions.length) % mentionOptions.length;
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        applyMention(mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)].name);
        mentionIndex = 0;
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      replying = null;
    }
  }

  function onInput(e: Event) {
    const el = e.currentTarget as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    session.notifyTyping(session.active);
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    if (file.size > LIMITS.file) return session.toast('Arquivos podem ter até 2 MB.');
    pending = { name: file.name, type: file.type, size: file.size, data: await readDataUrl(file) };
  }
</script>

<section
  class="chat"
  aria-label="Conversa"
  class:dragging
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={(e) => {
    e.preventDefault();
    dragging = false;
    void attach(e.dataTransfer?.files[0]);
  }}
>
  <div
    class="scroll"
    bind:this={list}
    onscroll={() => {
      if (list) pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    }}
  >
    <div class="intro">
      <div class="big"><Icon name="hash" size={36} /></div>
      <h2>Bem-vindo a #{channel?.name}</h2>
      <p>O histórico dura enquanto o host mantiver a sala aberta.</p>
    </div>
    {#each messages as message, i (message.id)}
      <MessageView {session} {message} compact={compactAt(i)} onreply={(m) => { replying = m; box?.focus(); }} />
    {/each}
  </div>

  <div class="composer">
    {#if mentionOptions.length}
      <div class="popup" role="listbox">
        {#each mentionOptions as member, i}
          <button role="option" aria-selected={i === mentionIndex} class:sel={i === mentionIndex} onclick={() => applyMention(member.name)}>@{member.name}</button>
        {/each}
      </div>
    {/if}
    {#if replying}
      <div class="bar">
        <span>Respondendo a <strong>{replying.authorName}</strong></span>
        <button aria-label="Cancelar resposta" onclick={() => (replying = null)}><Icon name="close" size={16} /></button>
      </div>
    {/if}
    {#if pending}
      <div class="bar">
        <span>Anexo: <strong>{pending.name}</strong></span>
        <button aria-label="Remover anexo" onclick={() => (pending = null)}><Icon name="close" size={16} /></button>
      </div>
    {/if}
    <div class="input">
      <label class="tool" aria-label="Anexar arquivo">
        <Icon name="paperclip" />
        <input type="file" hidden onchange={(e) => { void attach(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </label>
      <textarea
        bind:this={box}
        rows="1"
        placeholder="Conversar em #{channel?.name ?? ''}"
        aria-label="Mensagem"
        maxlength={LIMITS.text}
        value={draft}
        oninput={(e) => { drafts[session.active] = e.currentTarget.value; onInput(e); }}
        onkeydown={onKey}
        onpaste={(e) => {
          const file = e.clipboardData?.files[0];
          if (file) {
            e.preventDefault();
            void attach(file);
          }
        }}
      ></textarea>
      <button class="tool" aria-label="Emojis" aria-expanded={emojiOpen} onclick={() => (emojiOpen = !emojiOpen)}><Icon name="smile" /></button>
      {#if emojiOpen}
        <div class="emojis">
          {#each EMOJIS as emoji}
            <button aria-label="Inserir {emoji}" onclick={() => { drafts[session.active] = draft + emoji; box?.focus(); }}>{emoji}</button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="typing" aria-live="polite">
      {#if typers.length === 1}<strong>{typers[0]}</strong> está digitando…
      {:else if typers.length > 1}Várias pessoas estão digitando…{/if}
    </div>
  </div>
</section>

<style>
  .chat {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .chat.dragging {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    padding-bottom: 12px;
    overflow-y: auto;
  }

  .intro {
    padding: 28px 16px 8px;
  }

  .big {
    display: grid;
    place-items: center;
    width: 68px;
    height: 68px;
    border-radius: 22px;
    background: linear-gradient(145deg, rgb(var(--violet-rgb) / 30%), rgb(var(--accent-rgb) / 24%));
    color: var(--accent-strong);
  }

  .intro h2 {
    margin: 12px 0 2px;
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.03em;
  }

  .intro p {
    margin: 0;
    color: var(--text-soft);
  }

  .composer {
    position: relative;
    flex: none;
    padding: 0 16px;
  }

  .input {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 5px 8px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-input);
    box-shadow: 0 6px 20px rgb(0 0 0 / 18%);
    transition: border-color 0.14s, box-shadow 0.14s;
  }

  .input:focus-within {
    border-color: rgb(var(--accent-rgb) / 45%);
    box-shadow: 0 0 0 3px rgb(var(--accent-rgb) / 10%), 0 6px 20px rgb(0 0 0 / 18%);
  }

  textarea {
    flex: 1;
    min-width: 0;
    max-height: 160px;
    padding: 8px 4px;
    border: 0;
    outline: 0;
    background: none;
    resize: none;
  }

  .tool {
    display: grid;
    flex: none;
    place-items: center;
    width: 36px;
    height: 36px;
    color: var(--text-soft);
    cursor: pointer;
  }

  .tool:hover {
    color: var(--text);
  }

  .bar {
    display: flex;
    justify-content: space-between;
    padding: 6px 12px;
    border-radius: 10px 10px 0 0;
    background: var(--bg-side);
    color: var(--text-soft);
    font-size: 13px;
  }

  .popup {
    position: absolute;
    right: 16px;
    bottom: calc(100% + 4px);
    left: 16px;
    z-index: 5;
    padding: 6px;
    border-radius: 8px;
    background: var(--bg-side);
    box-shadow: 0 6px 20px rgb(0 0 0 / 40%);
  }

  .popup button {
    display: block;
    width: 100%;
    padding: 6px 8px;
    border-radius: 4px;
    text-align: left;
  }

  .popup .sel {
    background: var(--bg-active);
  }

  .emojis {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    z-index: 5;
    display: grid;
    grid-template-columns: repeat(5, 40px);
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-float);
    box-shadow: 0 6px 20px rgb(0 0 0 / 40%);
  }

  .emojis button {
    height: 40px;
    border-radius: 6px;
    font-size: 21px;
  }

  .emojis button:hover {
    background: var(--bg-hover);
  }

  .typing {
    height: 22px;
    padding: 2px 4px;
    color: var(--text-soft);
    font-size: 12px;
  }
</style>
