import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { createRoom, joinRoom, person } from './helpers';

// Um navegador por teste: aqui se abrem e trocam muitas capturas, e o limite é por processo.
let own: Browser;
test.beforeEach(async () => {
  own = await chromium.launch(test.info().project.use.launchOptions);
});
test.afterEach(async () => {
  await own.close();
});

async function call() {
  const host = await person(own, 'Host');
  const code = await createRoom(host);
  const ana = await person(own, 'Ana');
  await joinRoom(ana, code);
  for (const page of [host, ana]) await page.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect(host.locator('audio')).toHaveCount(1, { timeout: 15_000 });
  await expect(ana.locator('audio')).toHaveCount(1, { timeout: 15_000 });
  return { host, ana };
}

const micLabel = (p: Page) => p.evaluate(() => (window as any).session.media.mic?.getAudioTracks()[0].label);
const sentTrack = (p: Page, kind: string) => p.evaluate((k) => {
  const [peer] = (window as any).session.media.peers.values();
  const sender = peer.pc.getSenders().find((s: RTCRtpSender) => s.track?.kind === k);
  return sender ? { label: sender.track.label, state: sender.track.readyState } : null;
}, kind);
const settings = async (p: Page) => {
  await p.getByRole('button', { name: 'Configurações' }).click();
  await expect(p.getByLabel('Microfone', { exact: true }).locator('option')).not.toHaveCount(1);
};

test('trocar de microfone no meio da chamada troca o que é enviado', async () => {
  const { host, ana } = await call();
  await settings(ana);
  const select = ana.getByLabel('Microfone', { exact: true });
  const options = await select.locator('option').evaluateAll((o: HTMLOptionElement[]) => o.map((x) => ({ v: x.value, t: x.textContent })));
  const target = options.filter((o) => o.v && o.v !== 'default' && o.v !== 'communications').at(-1)!;
  await select.selectOption(target.v);
  await expect.poll(() => micLabel(ana)).toBe(target.t);
  expect(await sentTrack(ana, 'audio')).toEqual({ label: target.t, state: 'live' });

  const before = await host.evaluate(async () => Object.values(await (window as any).session.media.stats())[0] as any);
  await expect.poll(async () => (await host.evaluate(async () => Object.values(await (window as any).session.media.stats())[0] as any)).inbound).toBeGreaterThan(before.inbound + 500);

  // Trocas em sequência não deixam captura sobrando.
  await select.selectOption('');
  await select.selectOption(target.v);
  await expect.poll(() => micLabel(ana)).toBe(target.t);
  expect(await ana.evaluate(() => (window as any).session.media.mic.getAudioTracks()[0].readyState)).toBe('live');
});

test('fone desconectado cai para o padrão sem derrubar a voz', async () => {
  const { ana } = await call();
  const first = await ana.evaluate(() => {
    const track = (window as any).session.media.mic.getAudioTracks()[0];
    (window as any).oldTrack = track;
    track.stop();
    track.dispatchEvent(new Event('ended'));
    return track.id;
  });
  await expect.poll(() => ana.evaluate(() => (window as any).session.media.mic?.getAudioTracks()[0].id)).not.toBe(first);
  expect((await sentTrack(ana, 'audio'))?.state).toBe('live');
});

test('fone novo aparece na lista sem recarregar', async () => {
  const { ana } = await call();
  await settings(ana);
  await ana.evaluate(() => {
    const original = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => [
      ...(await original()),
      { deviceId: 'fone-novo', groupId: 'g', kind: 'audioinput', label: 'Fone Novo', toJSON() {} } as MediaDeviceInfo,
    ];
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  await expect(ana.getByLabel('Microfone', { exact: true })).toContainText('Fone Novo');
});

test('saída de áudio volta para o padrão e não é reaplicada à toa', async () => {
  const { ana } = await call();
  await ana.evaluate(() => {
    (window as any).sinks = [];
    const original = HTMLMediaElement.prototype.setSinkId;
    HTMLMediaElement.prototype.setSinkId = function (id: string) {
      (window as any).sinks.push(id);
      return original.call(this, 'default' === id ? '' : '').catch(() => {});
    };
  });
  await ana.evaluate(() => (window as any).session.updateSettings({ speakerId: 'caixa' }));
  await expect.poll(() => ana.evaluate(() => (window as any).sinks)).toEqual(['caixa']);
  await ana.evaluate(() => (window as any).session.updateSettings({ speakerId: '' }));
  await expect.poll(() => ana.evaluate(() => (window as any).sinks)).toEqual(['caixa', '']);
  await ana.waitForTimeout(2500); // o bipe do microfone falso muda "falando" várias vezes
  expect(await ana.evaluate(() => (window as any).sinks)).toEqual(['caixa', '']);
});

test('clique duplo no canal abre um microfone só', async () => {
  const page = await person(own, 'Ana');
  await createRoom(page);
  await page.evaluate(() => {
    (window as any).opened = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => { (window as any).opened++; return original(c); };
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Saguão'))!;
    button.click(); button.click(); button.click();
  });
  await expect(page.locator('.voice-member')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).opened)).toBe(1);
});

test('ensurdecer devolve o estado anterior do microfone', async () => {
  const { ana } = await call();
  const muted = () => ana.evaluate(() => (window as any).session.voice.muted);
  await ana.keyboard.press('Alt+Shift+M');
  await expect.poll(muted).toBe(true);
  await ana.keyboard.press('Alt+Shift+D');
  await ana.keyboard.press('Alt+Shift+D');
  await ana.waitForTimeout(200);
  expect(await muted()).toBe(true);
});

test('quem entrou só ouvindo ativa o microfone depois', async () => {
  const page = await person(own, 'Ana');
  await createRoom(page);
  await page.evaluate(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let denied = true;
    navigator.mediaDevices.getUserMedia = (c) => {
      if (denied) { denied = false; return Promise.reject(new DOMException('negado', 'NotAllowedError')); }
      return original(c);
    };
  });
  await page.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect(page.getByText('Microfone indisponível')).toBeVisible();
  await page.getByRole('button', { name: 'Ativar microfone' }).first().click();
  await expect.poll(() => micLabel(page)).toBeTruthy();
});

test('câmera troca ao vivo e para de ser enviada para quem não está vendo', async () => {
  const { host, ana } = await call();
  await ana.getByRole('button', { name: 'Ligar câmera' }).click();
  await expect(host.locator('[data-label="Ana"] video')).toBeVisible({ timeout: 15_000 });

  const cams = await ana.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').map((d) => d.deviceId));
  const old = await ana.evaluate(() => (window as any).session.media.camera.id);
  await ana.evaluate((id) => (window as any).session.updateSettings({ camId: id }), cams.at(-1));
  await expect.poll(async () => (await sentTrack(ana, 'video'))?.state).toBe('live');
  expect(await ana.evaluate(() => (window as any).session.media.camera.id)).toBe(old); // mesmo stream

  const video = () => ana.evaluate(() => {
    const [peer] = (window as any).session.media.peers.values();
    return peer.pc.getSenders().filter((s: RTCRtpSender) => s.track?.kind === 'video').length;
  });
  await expect.poll(video).toBe(1);
  await host.getByRole('button', { name: 'geral' }).click();
  await expect.poll(video).toBe(0); // host saiu da tela da chamada
  await host.locator('.back').click();
  await expect.poll(video).toBe(1);
  await expect(host.locator('[data-label="Ana"] video')).toBeVisible();
});

test('câmera desconectada desliga sem travar', async () => {
  const { ana } = await call();
  await ana.getByRole('button', { name: 'Ligar câmera' }).click();
  await expect(ana.getByRole('button', { name: 'Desligar câmera' })).toBeVisible();
  await ana.evaluate(() => (window as any).session.media.camera.getVideoTracks()[0].dispatchEvent(new Event('ended')));
  await expect(ana.getByRole('button', { name: 'Ligar câmera' })).toBeVisible();
});

test('painel de métricas mostra dados reais e só amostra quando aberto', async () => {
  const { host } = await call();
  await host.evaluate(() => {
    const media = (window as any).session.media;
    const original = media.stats.bind(media);
    (window as any).samples = 0;
    media.stats = () => { (window as any).samples++; return original(); };
  });
  await host.waitForTimeout(2300);
  expect(await host.evaluate(() => (window as any).samples)).toBe(0);

  await host.getByRole('button', { name: 'Métricas de desempenho' }).click();
  const panel = host.getByRole('region', { name: 'Métricas de desempenho' });
  await expect(panel).toContainText('Upload');
  await expect(panel).toContainText('Ana');
  await expect(panel).toContainText('direto');
  await expect.poll(async () => panel.locator('dd', { hasText: /kbps|Mbps/ }).first().textContent(), { timeout: 8000 }).not.toBe('0 kbps');
  await expect(panel.locator('dd').nth(1)).toContainText(/KB|MB/);
  await host.screenshot({ path: 'test-results/screens/11-metricas.png' });
});

test('modo jogo corta vídeo recebido, efeitos e envio no silêncio', async () => {
  const { host, ana } = await call();
  await ana.getByRole('button', { name: 'Ligar câmera' }).click();
  await expect(host.locator('[data-label="Ana"] video')).toBeVisible({ timeout: 15_000 });
  await host.getByRole('button', { name: 'Modo jogo' }).click();
  await expect(host.locator('html')).toHaveAttribute('data-lite');
  await expect(host.locator('[data-label="Ana"] video')).toHaveCount(0);
  const video = () => ana.evaluate(() => {
    const [peer] = (window as any).session.media.peers.values();
    return peer.pc.getSenders().filter((s: RTCRtpSender) => s.track?.kind === 'video').length;
  });
  await expect.poll(video).toBe(0);
  await host.getByRole('button', { name: 'Modo jogo' }).click();
  await expect.poll(video).toBe(1);

  // Ao reentrar, o áudio já negocia DTX e pacotes de 40 ms, sem quebrar a conexão.
  await ana.getByRole('button', { name: 'Desligar câmera' }).click();
  await ana.getByRole('button', { name: 'Modo jogo' }).click();
  await ana.getByRole('button', { name: 'Sair do canal de voz' }).first().click();
  await expect(ana.locator('.voice-member')).toHaveCount(1);
  await ana.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect(ana.locator('audio')).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(() => ana.evaluate(() => {
    const [peer] = (window as any).session.media.peers.values();
    return peer.pc.remoteDescription?.sdp ?? '';
  })).toContain('usedtx=1');
  const stats = () => host.evaluate(async () => Object.values(await (window as any).session.media.stats())[0] as any);
  const before = await stats();
  await expect.poll(async () => (await stats()).inbound, { timeout: 8000 }).toBeGreaterThan(before.inbound);
  await expect(ana.locator('.voice-member')).toHaveCount(2);
  await ana.getByRole('button', { name: 'Modo jogo' }).click();
});

test('modo economia remove efeitos e reduz a câmera', async () => {
  const { ana } = await call();
  await ana.getByRole('button', { name: 'Ligar câmera' }).click();
  await ana.evaluate(() => (window as any).session.updateSettings({ lite: true }));
  await expect(ana.locator('html')).toHaveAttribute('data-lite');
  await expect.poll(() => ana.evaluate(() => {
    const [peer] = (window as any).session.media.peers.values();
    const sender = peer.pc.getSenders().find((s: RTCRtpSender) => s.track?.kind === 'video');
    return sender?.getParameters().encodings[0]?.maxBitrate;
  }), { timeout: 10_000 }).toBe(150_000);
});
