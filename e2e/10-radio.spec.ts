import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { createRoom, joinRoom, person, shots } from './helpers';

// Player falso: o teste verifica o que o app manda tocar, sem depender da rede do YouTube.
const FAKE_API = `
window.__players = [];
window.YT = { Player: class {
  constructor(el, o) {
    this.o = o; this.state = -1; this.time = 0; this.volume = 100; this.muted = false; this.video = null;
    window.__players.push(this); window.__player = this;
    setTimeout(() => o.events.onReady && o.events.onReady({ target: this }));
  }
  loadVideoById(a) { this.video = a.videoId; this.time = a.startSeconds; this.set(1); }
  cueVideoById(a) { this.video = a.videoId; this.time = a.startSeconds; this.set(5); }
  cuePlaylist() { this.list = ['aaaaaaaaaa1','aaaaaaaaaa2','aaaaaaaaaa3']; this.set(5); }
  getPlaylist() { return this.list; }
  set(s) { this.state = s; setTimeout(() => this.o.events.onStateChange && this.o.events.onStateChange({ data: s })); }
  getPlayerState() { return this.state; } getCurrentTime() { return this.time; }
  playVideo() { this.set(1); } pauseVideo() { this.set(2); } stopVideo() { this.video = null; this.set(5); }
  seekTo(t) { this.time = t; this.seeked = t; } setVolume(v) { this.volume = v; }
  mute() { this.muted = true; } unMute() { this.muted = false; } destroy() {}
}};
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();`;

let own: Browser;
test.beforeAll(async () => {
  own = await chromium.launch(test.info().project.use.launchOptions);
});
test.afterAll(async () => {
  await own.close();
});

async function fake(page: Page) {
  await page.route('https://www.youtube.com/iframe_api', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_API }));
  await page.route('https://www.youtube.com/oembed*', (r) => {
    const id = decodeURIComponent(r.request().url()).match(/v=([\w-]{11})/)?.[1];
    r.fulfill({ json: { title: `Título ${id}` }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://i.ytimg.com/**', (r) => r.abort());
}

async function call() {
  const host = await person(own, 'Host');
  const code = await createRoom(host);
  const ana = await person(own, 'Ana');
  await joinRoom(ana, code);
  for (const page of [host, ana]) {
    await fake(page);
    await page.getByRole('button', { name: 'Saguão', exact: true }).click();
  }
  await expect(host.locator('.voice-member')).toHaveCount(2);
  return { host, ana };
}

const startYouTube = async (page: Page, link: string) => {
  await page.getByRole('button', { name: 'Rádio', exact: true }).click();
  await page.getByLabel('Link do YouTube').fill(link);
  await page.getByRole('button', { name: 'Iniciar rádio' }).click();
};
const playing = (page: Page) => page.evaluate(() => (window as any).__player?.video ?? null);
const radio = (page: Page) => page.getByRole('complementary', { name: 'Rádio' });

test('playlist toca sincronizada, sem nenhuma trilha nova de mídia', async () => {
  const { host, ana } = await call();
  await startYouTube(host, 'https://www.youtube.com/playlist?list=PLteste');
  await expect.poll(() => playing(host)).toBe('aaaaaaaaaa1');
  await expect.poll(() => playing(ana)).toBe('aaaaaaaaaa1');
  await expect(radio(ana)).toContainText('Título aaaaaaaaaa1');
  await expect(radio(ana)).toContainText('A seguir — 2');
  await host.screenshot({ path: `${shots}/10-radio.png` });

  const senders = await host.evaluate(() => {
    const [peer] = (window as any).session.media.peers.values();
    return peer.pc.getSenders().filter((s: RTCRtpSender) => s.track).length;
  });
  expect(senders).toBe(1); // só o microfone

  await radio(ana).getByRole('button', { name: /Pular \d/ }).click();
  await expect(radio(host).getByRole('button', { name: /Pular \d/ })).toContainText('1/2');
  await radio(host).getByRole('button', { name: /Pular 1/ }).click();
  await expect.poll(() => playing(ana)).toBe('aaaaaaaaaa2');
});

test('volume e silêncio do rádio são locais; só DJ controla', async () => {
  const { host, ana } = await call();
  await startYouTube(host, 'https://youtu.be/bbbbbbbbbbb');
  await expect.poll(() => playing(ana)).toBe('bbbbbbbbbbb');
  await radio(ana).getByRole('button', { name: 'Silenciar rádio' }).click();
  await expect.poll(() => ana.evaluate(() => (window as any).__player.muted)).toBe(true);
  await expect.poll(() => ana.evaluate(() => (window as any).__player.state)).toBe(2); // parado de verdade
  expect(await host.evaluate(() => (window as any).__player.muted)).toBe(false);
  await radio(ana).getByRole('button', { name: 'Ativar rádio' }).click();
  await expect.poll(() => ana.evaluate(() => (window as any).__player.state)).toBe(1);
  await radio(ana).getByLabel('Volume do rádio').fill('0.2');
  await expect.poll(() => ana.evaluate(() => (window as any).__player.volume)).toBe(20);
  await expect(radio(ana).getByRole('button', { name: 'Encerrar' })).toHaveCount(0);

  await radio(host).getByRole('button', { name: 'Pausar' }).click();
  await expect.poll(() => ana.evaluate(() => (window as any).__player.state)).toBe(2);
  await radio(host).getByRole('button', { name: 'Continuar' }).click();
  await expect.poll(() => ana.evaluate(() => (window as any).__player.state)).toBe(1);

  await radio(host).getByRole('button', { name: 'Encerrar' }).click();
  await expect(radio(ana)).toHaveCount(0);
});

test('fila por voto e vídeo bloqueado pula sozinho', async () => {
  const { host, ana } = await call();
  await startYouTube(host, 'https://youtu.be/ccccccccccc');
  await expect.poll(() => playing(host)).toBe('ccccccccccc');
  for (const id of ['ddddddddddd', 'eeeeeeeeeee']) {
    await radio(ana).getByLabel('Adicionar música').fill(`https://www.youtube.com/watch?v=${id}`);
    await radio(ana).getByRole('button', { name: 'Adicionar à fila' }).click();
    await expect(radio(host)).toContainText(`Título ${id}`);
  }
  await radio(host).getByRole('button', { name: 'Votar em Título eeeeeeeeeee' }).click();
  await host.evaluate(() => (window as any).__player.o.events.onError({ data: 150 }));
  await expect.poll(() => playing(ana)).toBe('eeeeeeeeeee');
  await ana.evaluate(() => (window as any).__player.set(0));
  await expect.poll(() => playing(host)).toBe('ddddddddddd');
});

test('quem entra depois começa no ponto certo e atraso é corrigido', async () => {
  const { host, ana } = await call();
  await startYouTube(host, 'https://youtu.be/fffffffffff');
  await expect.poll(() => playing(host)).toBe('fffffffffff');
  await host.waitForTimeout(2000);
  await ana.getByRole('button', { name: 'Sair do canal de voz' }).first().click();
  await expect(ana.locator('.voice-member')).toHaveCount(1);
  const before = await ana.evaluate(() => (window as any).__players.length);
  await ana.getByRole('button', { name: 'Saguão', exact: true }).click();
  // O player antigo fica no array do falso; só vale o novo, depois de carregar.
  await expect.poll(() => ana.evaluate((n) => { const w = window as any; return w.__players.length > n ? w.__player.video : null; }, before)).toBe('fffffffffff');
  const start = await ana.evaluate(() => (window as any).__player.time);
  expect(start).toBeGreaterThan(1.5);
  await ana.evaluate(() => { (window as any).__player.time = 500; });
  await expect.poll(() => ana.evaluate(() => (window as any).__player.seeked), { timeout: 6000 }).toBeLessThan(30);
});

test('áudio de aba transmite só áudio, em qualidade de música', async () => {
  const { host, ana } = await call();
  await host.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      const canvas = document.createElement('canvas');
      return new MediaStream([...dest.stream.getTracks(), ...canvas.captureStream(5).getTracks()]);
    };
  });
  await host.getByRole('button', { name: 'Rádio', exact: true }).click();
  await host.getByRole('radio', { name: /Áudio de uma aba/ }).check();
  await host.getByLabel('O que está tocando').fill('Lo-fi');
  await host.getByRole('button', { name: 'Iniciar rádio' }).click();
  await expect(radio(ana)).toContainText('Lo-fi');
  await expect(ana.locator('audio')).toHaveCount(2, { timeout: 15_000 });

  const info = await host.evaluate(() => {
    const media = (window as any).session.media;
    const [peer] = media.peers.values();
    return { live: media.radio.getVideoTracks().length, video: peer.pc.getSenders().filter((s: RTCRtpSender) => s.track?.kind === 'video').length };
  });
  expect(info).toEqual({ live: 0, video: 0 });
  await expect.poll(() => host.evaluate(() => {
    const media = (window as any).session.media;
    const [peer] = media.peers.values();
    const track = media.radio.getAudioTracks()[0];
    return peer.pc.getSenders().find((s: RTCRtpSender) => s.track === track)?.getParameters().encodings[0]?.maxBitrate;
  })).toBe(128_000);

  // Silenciar a voz da DJ não cala a música.
  const id = await ana.evaluate(() => (window as any).session.radio && (window as any).session.members.find((m: any) => m.isHost).voice.radio);
  await expect(ana.locator(`audio[data-stream="${id}"]`)).toHaveJSProperty('volume', 0.5);

  await radio(host).getByRole('button', { name: 'Encerrar' }).click();
  await expect(ana.locator('audio')).toHaveCount(1);
  expect(await host.evaluate(() => (window as any).session.media.radio)).toBeNull();
});
