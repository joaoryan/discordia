import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { createRoom, joinRoom, memberList, person, shots } from './helpers';

// Navegador próprio: a suíte passa dezenas de pessoas pelo mesmo processo e esgota as capturas de áudio.
let own: Browser;
test.beforeAll(async () => {
  own = await chromium.launch(test.info().project.use.launchOptions);
});
test.afterAll(async () => {
  await own.close();
});

async function call(browser: Browser) {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);
  for (const page of [host, ana]) await page.getByRole('button', { name: 'Saguão', exact: true }).click();
  try {
    await expect(host.locator('audio')).toHaveCount(1, { timeout: 8_000 });
    await expect(ana.locator('audio')).toHaveCount(1, { timeout: 8_000 });
  } catch (err) {
    for (const [n, p] of [['HOST', host], ['ANA', ana]] as const) {
      console.log('DUMP', n, await p.evaluate(() => {
        const s = (window as any).session; const m = s.media;
        return JSON.stringify({ self: s.selfId, voice: s.voice.channel, inside: s.members.map((x: any) => x.voice.channel), mic: !!m.mic, peers: [...m.peers].map(([id, x]: any) => [id, x.open, x.pc.signalingState, x.pc.iceConnectionState, x.pc.getTransceivers().length, x.streams.length]) });
      }));
    }
    throw err;
  }
  return { host, ana };
}

const anaMenu = async (page: Page) => {
  await memberList(page).getByRole('button', { name: /Ana/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();
};

test('volume e mudo por pessoa valem só para quem ajustou e são lembrados', async () => {
  const { host, ana } = await call(own);
  await anaMenu(host);
  await host.getByLabel('Volume de Ana').fill('0.3');
  await expect(host.locator('audio')).toHaveJSProperty('volume', 0.3);
  await host.screenshot({ path: `${shots}/9-menu.png` });

  await host.getByLabel('Silenciar para mim').check();
  await expect(host.locator('audio')).toHaveJSProperty('muted', true);
  await expect(ana.locator('audio')).toHaveJSProperty('muted', false);
  await expect(ana.locator('audio')).toHaveJSProperty('volume', 1);

  const saved = await host.evaluate(() => JSON.parse(localStorage.getItem('discordia.settings')!).userAudio.Ana);
  expect(saved).toMatchObject({ volume: 0.3, muted: true });
});

test('convidado também tem o menu, mas sem moderação; tile abre o menu', async () => {
  const { ana } = await call(own);
  await ana.getByRole('button', { name: 'Opções de Host' }).click();
  await expect(ana.getByLabel('Volume de Host')).toBeVisible();
  await expect(ana.getByRole('menuitem', { name: 'Expulsar' })).toHaveCount(0);
});

test('ocultar câmera volta para o avatar só para mim', async () => {
  const { host, ana } = await call(own);
  await ana.getByRole('button', { name: 'Ligar câmera' }).click();
  await expect(host.locator('[data-label="Ana"] video')).toBeVisible({ timeout: 15_000 });
  await anaMenu(host);
  await host.getByLabel('Ocultar câmera').check();
  await expect(host.locator('[data-label="Ana"] video')).toHaveCount(0);
});

test('host desconecta da voz e a pessoa continua na sala', async () => {
  const { host, ana } = await call(own);
  await anaMenu(host);
  await host.getByRole('menuitem', { name: 'Desconectar da voz' }).click();
  await expect(ana.getByText('O host desconectou você da voz.')).toBeVisible();
  await expect.poll(() => ana.evaluate(() => (window as any).session.media.mic)).toBeNull();
  await expect(ana.getByRole('textbox', { name: 'Mensagem' })).toBeVisible();
  await expect(memberList(host).getByRole('heading')).toHaveText('Online — 2');
});

test('apertar para falar abre o microfone só com a tecla', async () => {
  const { ana } = await call(own);
  const enabled = () => ana.evaluate(() => (window as any).session.media.mic.getAudioTracks()[0].enabled);
  await ana.getByRole('button', { name: 'Configurações' }).click();
  await ana.getByRole('checkbox', { name: 'Apertar para falar' }).check();
  await ana.getByRole('dialog').getByRole('button', { name: 'Fechar' }).click();
  await ana.evaluate(() => (document.activeElement as HTMLElement).blur());
  expect(await enabled()).toBe(false);
  await ana.keyboard.down('v');
  expect(await enabled()).toBe(true);
  await ana.keyboard.up('v');
  expect(await enabled()).toBe(false);
});

test('atalhos de mudo e ensurdecer', async () => {
  const { ana } = await call(own);
  await ana.keyboard.press('Alt+Shift+M');
  await expect(ana.getByRole('button', { name: 'Ativar microfone' }).first()).toBeVisible();
  await ana.keyboard.press('Alt+Shift+M');
  await ana.keyboard.press('Alt+Shift+D');
  await expect(ana.locator('audio')).toHaveJSProperty('muted', true);
});

test('tela aplica o limite do preset, mostra o upload e tem volume próprio', async () => {
  const { host, ana } = await call(own);
  await host.getByRole('button', { name: 'Compartilhar tela' }).click();
  await host.getByRole('radio', { name: /Alta qualidade/ }).check();
  await expect(host.getByText('até 4,5 Mbps')).toBeVisible();
  await host.screenshot({ path: `${shots}/9-tela.png` });
  await host.getByRole('button', { name: 'Escolher o que compartilhar' }).click();
  await ana.getByRole('button', { name: 'Assistir' }).click({ timeout: 15_000 });
  await expect(ana.locator('[data-label="Tela de Host"] video')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => host.evaluate(() => {
    const media = (window as any).session.media;
    const [peer] = media.peers.values();
    const track = media.screen.getVideoTracks()[0];
    const encoding = peer.pc.getSenders().find((s: RTCRtpSender) => s.track === track).getParameters().encodings[0];
    return `${encoding.maxBitrate}/${encoding.maxFramerate}`;
  }), { timeout: 10_000 }).toBe('4500000/30');

  await anaMenuForScreen(ana);
});

async function anaMenuForScreen(page: Page) {
  await page.getByRole('button', { name: 'Opções de Host' }).click();
  await page.getByLabel('Volume da transmissão de Host').fill('0.5');
  const id = await page.evaluate(() => (window as any).session.members.find((m: any) => m.isHost).voice.screen);
  // Voz e transmissão são elementos separados: só o da tela muda.
  await expect(page.locator('audio')).toHaveCount(2);
  await expect(page.locator(`audio[data-stream="${id}"]`)).toHaveJSProperty('volume', 0.5);
  await expect(page.locator(`audio:not([data-stream="${id}"])`)).toHaveJSProperty('volume', 1);
}
