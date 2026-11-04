<script lang="ts">
  // Teste de microfone antes de entrar: mostra o nível já com o tratamento de voz,
  // para a pessoa não descobrir na frente dos outros que o microfone não funciona.
  import { onDestroy } from 'svelte';
  import { MicChain, createVoiceContext } from '../lib/micChain';
  import { loadSettings } from '../lib/settings';

  let phase = $state<'idle' | 'opening' | 'on' | 'error'>('idle');
  let level = $state(0);
  let heard = $state(false);
  let stop = () => {};

  async function start() {
    phase = 'opening';
    const s = loadSettings();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: s.micId ? { ideal: s.micId } : undefined, echoCancellation: s.echoCancellation, noiseSuppression: s.noiseSuppression, autoGainControl: s.autoGainControl },
      });
      const ctx = createVoiceContext();
      const chain = await MicChain.create(ctx, stream, { voiceIsolation: s.voiceIsolation, noiseGate: s.noiseGate, threshold: s.sensitivity, volume: s.micVolume }, (st) => {
        level = Math.min(1, st.level * 5);
        if (st.open) heard = true;
      });
      phase = 'on';
      stop = () => {
        chain.close();
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        phase = 'idle';
        level = 0;
      };
    } catch {
      phase = 'error';
    }
  }

  onDestroy(() => stop());
</script>

<div class="mic-test">
  {#if phase === 'on'}
    <div class="meter" role="meter" aria-label="Nível do microfone" aria-valuenow={Math.round(level * 100)}><i style:width="{level * 100}%"></i></div>
    <span class="status" class:ok={heard}>{heard ? 'Ouvindo sua voz' : 'Fale alguma coisa…'}</span>
    <button type="button" class="btn" onclick={() => stop()}>Parar</button>
  {:else}
    <span class="status" class:bad={phase === 'error'}>
      {phase === 'error' ? 'Não foi possível abrir o microfone. Verifique a permissão do navegador.' : 'Teste antes de entrar numa chamada.'}
    </span>
    <button type="button" class="btn" disabled={phase === 'opening'} onclick={start}>{phase === 'opening' ? 'Abrindo…' : 'Testar microfone'}</button>
  {/if}
</div>

<style>
  .mic-test {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
  }

  .meter {
    flex: 1;
    height: 8px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--bg-deep);
  }

  .meter i {
    display: block;
    height: 100%;
    background: var(--ok);
    transition: width 0.08s linear;
  }

  .status {
    flex: 1;
    color: var(--text-mute);
    font-size: 13px;
  }

  .meter + .status {
    flex: none;
  }

  .status.ok {
    color: var(--ok);
  }

  .status.bad {
    color: var(--danger);
  }

  .btn {
    flex: none;
  }
</style>
