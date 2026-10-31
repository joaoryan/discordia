import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { createRoom, joinRoom, person, say, shots } from './helpers';

const fakeCapture = (page: Page, withAudio: boolean) => page.evaluate((audio) => {
  navigator.mediaDevices.getDisplayMedia = async (options) => {
    (window as any).captureOptions = options;
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    const ctx2d = canvas.getContext('2d')!;
    setInterval(() => { ctx2d.fillStyle = `hsl(${Date.now() % 360} 70% 50%)`; ctx2d.fillRect(0, 0, 640, 360); }, 50);
    const stream = canvas.captureStream(15);
    if (audio) {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest); osc.start();
      stream.addTrack(dest.stream.getAudioTracks()[0]);
    }
    return stream;
  };
}, withAudio);

const share = async (page: Page) => {
  await page.getByRole('button', { name: 'Compartilhar tela' }).click();
  await page.getByRole('button', { name: 'Escolher o que compartilhar' }).click();
};

async function room(count: number) {
  const browsers: Browser[] = await Promise.all(Array.from({ length: count }, () => chromium.launch(test.info().project.use.launchOptions)));
  const pages: Page[] = [];
  let code = '';
  for (let i = 0; i < count; i++) {
    const page = await person(browsers[i], i ? `V${i}` : 'Host');
    if (i === 0) code = await createRoom(page);
    else await joinRoom(page, code);
    pages.push(page);
  }
  for (const page of pages) await page.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect(pages[0].locator('.voice-member')).toHaveCount(count);
  return { pages, close: () => Promise.all(browsers.map((b) => b.close())) };
}

test('som da transmissão chega a quem assiste e o pedido abre em tela inteira', async () => {
  const { pages: [host, ana], close } = await room(2);
  await fakeCapture(host, true);
  await share(host);
  await ana.getByRole('button', { name: 'Assistir' }).click({ timeout: 15_000 });
  await expect(ana.locator('[data-label="Tela de Host"] video')).toBeVisible({ timeout: 15_000 });

  const options = await host.evaluate(() => {
    const o = (window as any).captureOptions;
    return { systemAudio: o.systemAudio, windowAudio: o.windowAudio, surface: o.video.displaySurface, self: o.selfBrowserSurface };
  });
  expect(options).toEqual({ systemAudio: 'include', windowAudio: 'system', surface: 'monitor', self: 'exclude' });

  const id = await ana.evaluate(() => (window as any).session.members.find((m: any) => m.isHost).voice.screen);
  const audio = ana.locator(`audio[data-stream="${id}"]`);
  await expect(audio).toHaveJSProperty('muted', false);
  await expect(audio).toHaveJSProperty('volume', 1);
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => (el.srcObject as MediaStream).getAudioTracks().length)).toBe(1);

  // O áudio continua chegando com a pessoa no chat, onde o vídeo é pausado.
  const bytes = () => ana.evaluate(async () => {
    const [peer] = (window as any).session.media.peers.values();
    let total = 0;
    (await peer.pc.getStats()).forEach((e: any) => { if (e.type === 'inbound-rtp' && e.kind === 'audio') total += e.bytesReceived; });
    return total;
  });
  await ana.getByRole('button', { name: 'geral' }).click();
  const before = await bytes();
  await expect.poll(bytes).toBeGreaterThan(before + 2000);
  await close();
});

test('sem som capturado, quem transmite é avisado e quem assiste vê o aviso', async () => {
  const { pages: [host, ana], close } = await room(2);
  await fakeCapture(host, false);
  await share(host);
  await expect(host.getByText('Transmissão sem som')).toBeVisible();
  await expect(ana.locator('[data-label="Tela de Host · sem som"]')).toBeVisible();
  await close();
});

test('modo foco: transmissão grande, convidados pequenos, sem tela cheia', async () => {
  const { pages: [host, ana, bia], close } = await room(3);
  await fakeCapture(host, true);
  await share(host);
  await ana.getByRole('button', { name: 'Assistir' }).click({ timeout: 15_000 });
  const screen = ana.locator('[data-label="Tela de Host"]');
  await expect(screen.locator('video')).toBeVisible({ timeout: 15_000 });
  await ana.waitForTimeout(300);
  const big = await screen.boundingBox();
  const small = await ana.locator('[data-label="V2"]').boundingBox();
  expect(big!.width).toBeGreaterThan(450);
  expect(small!.width).toBeLessThan(200);
  expect(await ana.evaluate(() => document.fullscreenElement)).toBeNull();
  await ana.screenshot({ path: `${shots}/12-foco.png` });

  await ana.getByRole('button', { name: 'Reduzir Tela de Host' }).click();
  await expect.poll(async () => (await ana.locator('[data-label="V2"]').boundingBox())!.width).toBeGreaterThan(200);
  await ana.getByRole('button', { name: 'Ampliar Tela de Host' }).click();

  await host.getByRole('button', { name: 'Parar de compartilhar' }).click();
  await expect.poll(async () => (await ana.locator('[data-label="V2"]').boundingBox())!.width).toBeGreaterThan(200);
  expect(bia).toBeTruthy();
  await close();
});

test('5 espectadores recebem a tela; o sexto é recusado', async () => {
  test.setTimeout(120_000);
  const { pages, close } = await room(7);
  const [host, ...viewers] = pages;
  await fakeCapture(host, true);
  await host.getByRole('button', { name: 'Compartilhar tela' }).click();
  await expect(host.getByText('até 7,5 Mbps')).toBeVisible(); // 5 × 1,5 Mbps
  await host.getByRole('button', { name: 'Escolher o que compartilhar' }).click();
  for (const page of viewers.slice(0, 5)) {
    await page.getByRole('button', { name: 'Assistir' }).click({ timeout: 15_000 });
    await expect(page.locator('[data-label="Tela de Host"] video')).toBeVisible({ timeout: 20_000 });
  }
  await viewers[5].getByRole('button', { name: 'Assistir' }).click({ timeout: 15_000 });
  await expect(viewers[5].getByText('A transmissão já tem 5 espectadores.')).toBeVisible();
  await expect(viewers[5].getByRole('button', { name: 'Assistir' })).toBeVisible();

  await expect.poll(() => host.evaluate(() => {
    const media = (window as any).session.media;
    const track = media.screen.getVideoTracks()[0];
    return [...media.peers.values()].flatMap((p: any) => p.pc.getSenders()).find((s: RTCRtpSender) => s.track === track)?.getParameters().encodings[0]?.maxBitrate;
  })).toBe(1_500_000);
  await close();
});

test('editar e apagar mensagem', async () => {
  const { pages: [host, ana], close } = await room(2);
  await host.locator('.channel', { hasText: 'geral' }).click();
  await ana.locator('.channel', { hasText: 'geral' }).click();
  await say(ana, 'mensagem errada');
  const own = ana.locator('article', { hasText: 'mensagem errada' });
  await own.hover();
  await own.getByRole('button', { name: 'Editar' }).click();
  await ana.getByLabel('Editar mensagem').fill('mensagem certa');
  await ana.keyboard.press('Enter');
  await expect(host.locator('article', { hasText: 'mensagem certa' })).toContainText('(editada)');
  const theirs = host.locator('article', { hasText: 'mensagem certa' });
  await theirs.hover();
  await expect(theirs.getByRole('button', { name: 'Editar' })).toHaveCount(0);
  await theirs.getByRole('button', { name: 'Apagar mensagem' }).click();
  await expect(ana.getByText('mensagem certa')).toHaveCount(0);
  await close();
});
