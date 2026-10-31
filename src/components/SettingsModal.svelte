<script lang="ts">
  import { untrack } from 'svelte';
  import type { Profile } from '../lib/protocol';
  import type { RoomSession } from '../lib/session.svelte';
  import Modal from './Modal.svelte';
  import ProfileForm from './ProfileForm.svelte';
  import ThemePicker from './ThemePicker.svelte';

  let {
    session,
    profile,
    onprofile,
    onclose,
  }: { session: RoomSession; profile: Profile; onprofile: (p: Profile) => void; onclose: () => void } = $props();

  let tab = $state<'audio' | 'look' | 'profile'>('audio');
  let level = $state(0);
  let capturing = $state(false);

  const devices = $derived(session.devices);
  const inputs = $derived(devices.filter((d) => d.kind === 'audioinput' && d.label));
  const outputs = $derived(devices.filter((d) => d.kind === 'audiooutput' && d.label));
  const cameras = $derived(devices.filter((d) => d.kind === 'videoinput' && d.label));
  const canPickOutput = 'setSinkId' in HTMLMediaElement.prototype;

  // Mede o microfone escolhido. Em chamada reaproveita a captura ativa em vez de abrir outra.
  $effect(() => {
    void session.settings.micId;
    void session.micVersion;
    let stopped = false;
    let own: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let timer = 0;

    const live = untrack(() => session.media.mic);
    (live ? Promise.resolve(live) : session.media.openMic())
      .then(async (stream) => {
        if (!live) own = stream;
        if (stopped) return own?.getTracks().forEach((t) => t.stop());
        await session.refreshDevices(); // a permissão libera os nomes dos dispositivos
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        ctx.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          level = Math.min(1, Math.sqrt(sum / samples.length) * 5);
        }, 80);
      })
      .catch(() => session.refreshDevices());

    return () => {
      stopped = true;
      clearInterval(timer);
      own?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  });

  function captureKey(e: KeyboardEvent) {
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

<Modal title="Configurações" wide {onclose}>
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'audio'} class:on={tab === 'audio'} onclick={() => (tab = 'audio')}>Voz e vídeo</button>
    <button role="tab" aria-selected={tab === 'look'} class:on={tab === 'look'} onclick={() => (tab = 'look')}>Aparência</button>
    <button role="tab" aria-selected={tab === 'profile'} class:on={tab === 'profile'} onclick={() => (tab = 'profile')}>Perfil</button>
  </div>

  {#if tab === 'audio'}
    <div class="row">
      <div>
        <label class="label" for="mic">Microfone</label>
        <select id="mic" class="field" value={session.settings.micId} onchange={(e) => session.updateSettings({ micId: e.currentTarget.value })}>
          <option value="">Padrão do sistema</option>
          {#each inputs as device}<option value={device.deviceId}>{device.label}</option>{/each}
        </select>
      </div>
      <div>
        <label class="label" for="speaker">Saída de áudio</label>
        <select id="speaker" class="field" disabled={!canPickOutput} value={session.settings.speakerId} onchange={(e) => session.updateSettings({ speakerId: e.currentTarget.value })}>
          <option value="">Padrão do sistema</option>
          {#each outputs as device}<option value={device.deviceId}>{device.label}</option>{/each}
        </select>
      </div>
    </div>

    <label class="label" for="cam">Câmera</label>
    <select id="cam" class="field" value={session.settings.camId} onchange={(e) => session.updateSettings({ camId: e.currentTarget.value })}>
      <option value="">Padrão do sistema</option>
      {#each cameras as device}<option value={device.deviceId}>{device.label}</option>{/each}
    </select>

    <span class="label top">Teste de microfone</span>
    <div class="meter" role="meter" aria-label="Nível do microfone" aria-valuenow={Math.round(level * 100)}>
      <i style:width="{level * 100}%"></i>
      <b style:left="{Math.min(100, session.settings.sensitivity * 500)}%"></b>
    </div>

    <label class="label top" for="sens">Sensibilidade para detectar fala</label>
    <input id="sens" type="range" min="0.002" max="0.1" step="0.002" value={session.settings.sensitivity} oninput={(e) => session.updateSettings({ sensitivity: Number(e.currentTarget.value) })} />

    <div class="toggles">
      <label><input type="checkbox" checked={session.settings.noiseSuppression} onchange={(e) => session.updateSettings({ noiseSuppression: e.currentTarget.checked })} /> Supressão de ruído</label>
      <label><input type="checkbox" checked={session.settings.echoCancellation} onchange={(e) => session.updateSettings({ echoCancellation: e.currentTarget.checked })} /> Cancelamento de eco</label>
      <label><input type="checkbox" checked={session.settings.autoGainControl} onchange={(e) => session.updateSettings({ autoGainControl: e.currentTarget.checked })} /> Ganho automático</label>
      <label><input type="checkbox" checked={session.settings.pushToTalk} onchange={(e) => session.updateSettings({ pushToTalk: e.currentTarget.checked })} /> Apertar para falar</label>
      {#if session.settings.pushToTalk}
        <div class="ptt">
          <button class="btn" onclick={() => (capturing = true)}>{capturing ? 'Pressione uma tecla…' : `Tecla: ${session.settings.pushToTalkKey.replace(/^Key|^Digit/, '')}`}</button>
          <small>Funciona só com esta janela em foco: o navegador não recebe teclas de outros programas.</small>
        </div>
      {/if}
      <label><input type="checkbox" checked={session.settings.gameMode} onchange={() => session.toggleGameMode()} /> Modo jogo: só voz, sem receber vídeo</label>
      <label><input type="checkbox" checked={session.settings.lite} onchange={(e) => session.updateSettings({ lite: e.currentTarget.checked })} /> Modo economia: sem efeitos visuais e câmera mais leve</label>
      <label><input type="checkbox" checked={session.settings.sounds} onchange={(e) => session.updateSettings({ sounds: e.currentTarget.checked })} /> Sons do app</label>
      <label><input type="checkbox" checked={session.settings.notifications} onchange={toggleNotifications} /> Notificar menções</label>
    </div>
  {:else if tab === 'look'}
    <ThemePicker value={session.settings.theme} onpick={(theme) => session.updateSettings({ theme })} />
  {:else}
    <p class="hint">As mudanças valem na próxima sala em que você entrar.</p>
    <ProfileForm initial={profile} submit="Salvar" onsave={(p) => { onprofile(p); onclose(); }} />
  {/if}
</Modal>

<style>
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--line);
  }

  .tabs button {
    padding: 8px 12px;
    border-bottom: 2px solid transparent;
    color: var(--text-soft);
  }

  .tabs .on {
    border-color: var(--accent);
    color: var(--text);
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
    gap: 8px;
    margin-top: 14px;
  }

  .toggles input {
    accent-color: var(--accent);
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
