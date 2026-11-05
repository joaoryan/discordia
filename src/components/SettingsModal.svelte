<script lang="ts">
  import { untrack } from 'svelte';
  import { MicChain, createVoiceContext } from '../lib/micChain';
  import { desktop } from '../lib/platform';
  import { SOUND_GROUPS, playSound, type SoundId } from '../lib/sounds';
  import { rangeFill } from '../lib/actions';
  import Icon from './Icon.svelte';
  import Select from './Select.svelte';
  import type { Profile } from '../lib/protocol';
  import type { RoomSession } from '../lib/session.svelte';
  import ProfileForm from './ProfileForm.svelte';

  let {
    session,
    profile,
    onprofile,
    onclose,
  }: { session: RoomSession; profile: Profile; onprofile: (p: Profile) => void; onclose: () => void } = $props();

  type Section = 'profile' | 'audio' | 'video' | 'sounds' | 'keys' | 'notify' | 'desktop';
  let tab = $state<Section>('audio');
  let autoStart = $state(false);
  void desktop?.getAutoStart().then((on) => (autoStart = on));

  const SECTIONS: { group: string; items: [Section, string][] }[] = [
    { group: 'Você', items: [['profile', 'Perfil']] },
    { group: 'App', items: [['audio', 'Voz e microfone'], ['video', 'Vídeo'], ['sounds', 'Sons'], ['keys', 'Atalhos'], ['notify', 'Notificações']] },
    ...(desktop ? [{ group: 'Computador', items: [['desktop', 'App de computador']] as [Section, string][] }] : []),
  ];
  const keyName = (code: string) => code.replace(/^Key|^Digit/, '').replace(/^Arrow/, '↑ ').replace('↑ Down', '↓').replace('↑ Left', '←').replace('↑ Right', '→');
  let level = $state(0);
  let capturing = $state(false);

  const devices = $derived(session.devices);
  const inputs = $derived(devices.filter((d) => d.kind === 'audioinput' && d.label));
  const outputs = $derived(devices.filter((d) => d.kind === 'audiooutput' && d.label));
  const cameras = $derived(devices.filter((d) => d.kind === 'videoinput' && d.label));
  const canPickOutput = 'setSinkId' in HTMLMediaElement.prototype;
  const deviceOptions = (list: MediaDeviceInfo[]) => [{ value: '', label: 'Padrão do sistema' }, ...list.map((d) => ({ value: d.deviceId, label: d.label }))];

  // Mede a voz já tratada (antes da porta), para a marca de sensibilidade bater com o que é enviado.
  // Em chamada lê a captura ativa; fora dela monta um tratamento só para o teste.
  let preview: MicChain | null = null;
  $effect(() => {
    void session.settings.micId;
    void session.settings.voiceIsolation;
    void session.micVersion;
    let stopped = false;
    let own: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer = 0;

    const read = (get: () => number) => (timer = window.setInterval(() => (level = Math.min(1, get() * 5)), 80));
    if (untrack(() => session.media.mic)) {
      read(() => session.media.micLevel);
    } else {
      session.media
        .openMic()
        .then(async (stream) => {
          own = stream;
          if (stopped) return stream.getTracks().forEach((t) => t.stop());
          await session.refreshDevices(); // a permissão libera os nomes dos dispositivos
          ctx = createVoiceContext();
          const s = untrack(() => session.settings);
          const chain = await MicChain.create(ctx, stream, { voiceIsolation: s.voiceIsolation, noiseGate: s.noiseGate, threshold: s.sensitivity, volume: s.micVolume });
          if (stopped) return chain.close();
          preview = chain;
          read(() => chain.state.level);
        })
        .catch(() => session.refreshDevices());
    }

    return () => {
      stopped = true;
      clearInterval(timer);
      preview?.close();
      preview = null;
      own?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  });

  $effect(() => {
    const { noiseGate, sensitivity, micVolume } = session.settings;
    preview?.update({ noiseGate, threshold: sensitivity, volume: micVolume });
  });

  function toggleSound(id: SoundId, on: boolean) {
    const rest = session.settings.mutedSounds.filter((s) => s !== id);
    session.updateSettings({ mutedSounds: on ? rest : [...rest, id] });
    if (on) playSound(id, session.settings.soundVolume);
  }

  function captureKey(e: KeyboardEvent) {
    // Esc com uma lista aberta só fecha a lista.
    if (e.key === 'Escape' && !capturing) return (e.target as HTMLElement).closest?.('.select.open') ? undefined : onclose();
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    capturing = false;
    session.updateSettings({ pushToTalkKey: e.code });
  }

  async function toggleNotifications(e: Event) {
    const wanted = (e.currentTarget as HTMLInputElement).checked;
    const granted = wanted && (await Notification.requestPermission()) === 'granted';
    session.updateSettings({ notifications: granted });
  }
</script>

<svelte:window onkeydowncapture={captureKey} />

<div class="settings" role="dialog" aria-modal="true" aria-label="Configurações">
  <div class="nav" role="tablist" aria-orientation="vertical" aria-label="Categorias">
    {#each SECTIONS as section}
      <span class="group">{section.group}</span>
      {#each section.items as [id, label]}
        <button role="tab" aria-selected={tab === id} class:on={tab === id} onclick={() => (tab = id)}>{label}</button>
      {/each}
    {/each}
  </div>

  <div class="pane">
    <button class="close" aria-label="Fechar" title="Fechar (Esc)" onclick={onclose}><Icon name="close" /></button>
    <div class="inner">
      {#if tab === 'profile'}
        <h2>Perfil</h2>
        <p class="hint">As mudanças valem na próxima sala em que você entrar.</p>
        <ProfileForm initial={profile} submit="Salvar" onsave={(p) => { onprofile(p); onclose(); }} />
      {:else if tab === 'audio'}
        <h2>Voz e microfone</h2>
        <div class="row">
          <div>
            <label class="label" for="mic">Microfone</label>
            <Select id="mic" value={session.settings.micId} options={deviceOptions(inputs)} onchange={(v) => session.updateSettings({ micId: v })} />
          </div>
          <div>
            <label class="label" for="speaker">Saída de áudio</label>
            <Select id="speaker" disabled={!canPickOutput} value={session.settings.speakerId} options={deviceOptions(outputs)} onchange={(v) => session.updateSettings({ speakerId: v })} />
          </div>
        </div>

        <span class="label top">Teste de microfone</span>
        <div class="meter" role="meter" aria-label="Nível do microfone" aria-valuenow={Math.round(level * 100)}>
          <i style:width="{level * 100}%"></i>
          <b style:left="{Math.min(100, session.settings.sensitivity * 500)}%"></b>
        </div>

        <label class="label top" for="micvol">Volume do microfone: {Math.round(session.settings.micVolume * 100)}%</label>
        <input id="micvol" type="range" use:rangeFill={session.settings.micVolume} min="0" max="2" step="0.05" value={session.settings.micVolume} oninput={(e) => session.updateSettings({ micVolume: Number(e.currentTarget.value) })} />

        <label class="label top" for="sens">Sensibilidade para detectar fala</label>
        <input id="sens" type="range" use:rangeFill={session.settings.sensitivity} min="0.002" max="0.1" step="0.002" value={session.settings.sensitivity} oninput={(e) => session.updateSettings({ sensitivity: Number(e.currentTarget.value) })} />
        {#if session.settings.noiseGate}<small class="hint">Só o som que passa da marca é enviado. Se cortar o começo das suas falas, arraste para a esquerda.</small>{/if}

        <div class="toggles">
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.voiceIsolation} onchange={(e) => session.updateSettings({ voiceIsolation: e.currentTarget.checked })} /> Isolar a voz (IA): remove teclado, ventilador, TV e barulho de fundo</label>
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.noiseGate} onchange={(e) => session.updateSettings({ noiseGate: e.currentTarget.checked })} /> Cortar o som quando você não está falando</label>
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.noiseSuppression} onchange={(e) => session.updateSettings({ noiseSuppression: e.currentTarget.checked })} /> Supressão de ruído do navegador</label>
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.echoCancellation} onchange={(e) => session.updateSettings({ echoCancellation: e.currentTarget.checked })} /> Cancelamento de eco</label>
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.autoGainControl} onchange={(e) => session.updateSettings({ autoGainControl: e.currentTarget.checked })} /> Ganho automático</label>
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.gameMode} onchange={() => session.toggleGameMode()} /> Modo jogo: só voz, sem receber vídeo</label>
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.helpRelay} onchange={(e) => session.updateSettings({ helpRelay: e.currentTarget.checked })} /> Ajudar a conectar: repassa a voz entre duas pessoas do canal que a rede impede de se falarem direto</label>
        </div>
      {:else if tab === 'video'}
        <h2>Vídeo</h2>
        <label class="label" for="cam">Câmera</label>
        <Select id="cam" value={session.settings.camId} options={deviceOptions(cameras)} onchange={(v) => session.updateSettings({ camId: v })} />
        <div class="toggles">
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.lite} onchange={(e) => session.updateSettings({ lite: e.currentTarget.checked })} /> Modo economia: sem efeitos visuais e câmera mais leve</label>
        </div>
      {:else if tab === 'sounds'}
        <h2>Sons</h2>
        <div class="toggles first">
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.sounds} onchange={(e) => session.updateSettings({ sounds: e.currentTarget.checked })} /> Tocar sons do app</label>
        </div>
        <label class="label top" for="soundvol">Volume dos sons: {Math.round(session.settings.soundVolume * 100)}%</label>
        <input id="soundvol" type="range" use:rangeFill={session.settings.soundVolume} min="0.1" max="1.5" step="0.05" disabled={!session.settings.sounds} value={session.settings.soundVolume} oninput={(e) => session.updateSettings({ soundVolume: Number(e.currentTarget.value) })} onchange={() => playSound('message', session.settings.soundVolume)} />

        <div class="sound-groups">
          {#each SOUND_GROUPS as group}
            <div>
              <span class="label top">{group.title}</span>
              <ul class="sounds" class:off={!session.settings.sounds}>
                {#each group.sounds as sound}
                  <li>
                    <label><input type="checkbox" disabled={!session.settings.sounds} checked={!session.settings.mutedSounds.includes(sound.id)} onchange={(e) => toggleSound(sound.id, e.currentTarget.checked)} /> {sound.label}</label>
                    <button aria-label="Ouvir: {sound.label}" title="Ouvir" onclick={() => playSound(sound.id, session.settings.soundVolume)}><Icon name="play" size={14} /></button>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {:else if tab === 'keys'}
        <h2>Atalhos</h2>
        <p class="hint">{desktop ? 'No app de computador, os atalhos funcionam mesmo com outro programa em foco, inclusive dentro do jogo.' : 'No navegador, os atalhos só funcionam com a janela do Discordia em foco. No app de computador eles funcionam em qualquer programa.'}</p>
        <dl class="keys">
          <dt>Silenciar ou ativar o microfone</dt><dd><kbd>Alt</kbd><kbd>Shift</kbd><kbd>M</kbd></dd>
          <dt>Ensurdecer ou voltar a ouvir</dt><dd><kbd>Alt</kbd><kbd>Shift</kbd><kbd>D</kbd></dd>
          <dt>Rádio: pausar ou continuar</dt><dd><kbd>Alt</kbd><kbd>Shift</kbd><kbd>P</kbd></dd>
          <dt>Rádio: próxima música</dt><dd><kbd>Alt</kbd><kbd>Shift</kbd><kbd>N</kbd></dd>
          <dt>Rádio: volume</dt><dd><kbd>Alt</kbd><kbd>Shift</kbd><kbd>↑</kbd><kbd>↓</kbd></dd>
          <dt>Rádio pelas teclas de mídia do teclado</dt><dd><kbd>⏯</kbd><kbd>⏭</kbd></dd>
        </dl>
        <div class="toggles">
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.pushToTalk} onchange={(e) => session.updateSettings({ pushToTalk: e.currentTarget.checked })} /> Apertar para falar: o microfone só abre segurando a tecla</label>
          {#if session.settings.pushToTalk}
            <div class="ptt">
              <button class="btn" onclick={() => (capturing = true)}>{capturing ? 'Pressione uma tecla…' : `Tecla: ${keyName(session.settings.pushToTalkKey)}`}</button>
              <small>{desktop ? 'Funciona em qualquer programa.' : 'Funciona só com esta janela em foco: o navegador não recebe teclas de outros programas.'}</small>
            </div>
          {/if}
        </div>
      {:else if tab === 'notify'}
        <h2>Notificações</h2>
        <div class="toggles first">
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.notifications} onchange={toggleNotifications} /> Notificar quando alguém mencionar você com a janela em segundo plano</label>
        </div>
        <p class="hint">Os sons de cada ação ficam em <button class="link" onclick={() => (tab = 'sounds')}>Sons</button>.</p>
      {:else if tab === 'desktop' && desktop}
        <h2>App de computador</h2>
        <p class="hint">Versão {desktop.version}.</p>
        <div class="toggles first">
          <label class="option-row"><input type="checkbox" class="switch" checked={autoStart} onchange={async (e) => { const on = e.currentTarget.checked; await desktop!.setAutoStart(on); autoStart = on; }} /> Iniciar com o sistema, minimizado na bandeja</label>
          <label class="option-row"><input type="checkbox" class="switch" checked={session.settings.miniWindow} onchange={(e) => session.updateSettings({ miniWindow: e.currentTarget.checked })} /> Mostrar a mini janela por cima dos outros programas durante a chamada</label>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .settings {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    grid-template-columns: minmax(200px, 1fr) minmax(0, 2.6fr);
    background: var(--bg-main);
    animation: fade 0.12s;
  }

  .nav {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    padding: 48px 12px 24px;
    overflow-y: auto;
    background: var(--bg-side);
  }

  .nav .group,
  .nav button {
    width: 200px;
  }

  .nav .group {
    padding: 14px 10px 4px;
    color: var(--text-mute);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .nav button {
    padding: 7px 10px;
    border-radius: 8px;
    color: var(--text-soft);
    text-align: left;
  }

  .nav button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .nav button.on {
    background: var(--bg-active);
    color: var(--text);
  }

  .pane {
    position: relative;
    overflow-y: auto;
  }

  .inner {
    max-width: 720px;
    padding: 48px 40px 64px;
  }

  h2 {
    margin: 0 0 18px;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .close {
    position: sticky;
    top: 16px;
    float: right;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    margin: 16px 16px 0 0;
    border: 1px solid var(--line);
    border-radius: 50%;
    color: var(--text-soft);
  }

  .close:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .sound-groups {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0 18px;
  }

  .keys {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px 16px;
    margin: 0 0 14px;
  }

  .keys dt {
    color: var(--text-soft);
  }

  .keys dd {
    display: flex;
    gap: 4px;
    margin: 0;
  }

  kbd {
    min-width: 26px;
    padding: 2px 7px;
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 6px;
    background: var(--bg-input);
    font: 600 12px/1.6 var(--font);
    text-align: center;
  }

  .link {
    color: var(--accent);
    text-decoration: underline;
  }

  @media (max-width: 720px) {
    .settings {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }

    .nav {
      flex-direction: row;
      align-items: center;
      padding: 8px;
      overflow-x: auto;
    }

    .nav .group {
      display: none;
    }

    .nav button {
      width: auto;
      flex: none;
    }

    .inner {
      padding: 20px 16px 48px;
    }
  }

  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }

  .row > * {
    min-width: 0;
  }

  .top {
    margin-top: 14px;
  }

  .meter {
    position: relative;
    height: 10px;
    overflow: hidden;
    border-radius: 5px;
    background: var(--bg-deep);
  }

  .meter i {
    display: block;
    height: 100%;
    background: var(--ok);
    transition: width 0.08s linear;
  }

  .meter b {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--text);
  }

  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }

  .toggles {
    display: grid;
    margin-top: 14px;
    border-top: 1px solid var(--line);
  }

  .toggles > label {
    padding: 11px 2px;
    border-bottom: 1px solid var(--line);
  }

  .first {
    margin-top: 0;
  }

  .sounds {
    display: grid;
    gap: 2px;
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
  }

  .sounds.off {
    opacity: 0.5;
  }

  .sounds li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 32px;
    padding: 0 4px 0 8px;
    border-radius: 6px;
  }

  .sounds li:hover {
    background: var(--bg-hover);
  }

  .sounds label {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 4px 0;
    cursor: pointer;
  }

  .sounds button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--text-soft);
  }

  .sounds button:hover {
    background: var(--bg-active);
    color: var(--accent);
  }

  .ptt {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: 22px;
  }

  .ptt small {
    color: var(--text-mute);
  }

  .hint {
    margin-top: 0;
    color: var(--text-soft);
  }

  @media (max-width: 520px) {
    .row {
      grid-template-columns: 1fr;
    }
  }
</style>
