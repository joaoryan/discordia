import { expect, type Page } from '@playwright/test';
import { createRoom, joinRoom, person, shots, test } from './helpers';

const stats = (page: Page) => page.evaluate(() => (window as any).session.media.stats());
const receivedFrom = async (page: Page) => Object.values(await stats(page)).map((s: any) => s.inbound);

test('voz em malha entre três pessoas, mudo e ensurdecer', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);
  const bia = await person(browser, 'Bia');
  await joinRoom(bia, code);

  for (const page of [host, ana, bia]) await page.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect(host.locator('.voice-member')).toHaveCount(3);

  // Cada um conecta aos outros dois, direto.
  for (const page of [host, ana, bia]) {
    await expect.poll(async () => Object.values(await stats(page)).map((s: any) => s.state).join(), { timeout: 20_000 }).toBe('connected,connected');
  }
  const before = await receivedFrom(ana);
  await expect.poll(async () => (await receivedFrom(ana))[0] > before[0] + 2000).toBe(true);
  await expect.poll(() => host.evaluate(() => document.querySelectorAll('audio').length)).toBe(2);
  expect(await stats(ana).then((s) => Object.values(s).some((p: any) => p.relay))).toBe(false);

  // O som de teste do Chromium bipa, então o indicador de fala precisa acender.
  await expect(host.locator('.voice-member .speaking').first()).toBeVisible({ timeout: 10_000 });
  await host.screenshot({ path: `${shots}/4-voz.png` });

  await ana.getByRole('button', { name: 'Silenciar microfone' }).click();
  await expect(host.locator('.voice-member').filter({ hasText: 'Ana' }).locator('svg')).toHaveCount(1);
  expect(await ana.evaluate(() => (window as any).session.media.mic.getAudioTracks()[0].enabled)).toBe(false);

  await bia.getByRole('button', { name: 'Ensurdecer' }).click();
  await expect(bia.locator('audio').first()).toHaveJSProperty('muted', true);

  // Quem sai é retirado da malha dos outros.
  await ana.getByRole('button', { name: 'Sair do canal de voz' }).first().click();
  await expect(host.locator('.voice-member')).toHaveCount(2);
  await expect.poll(async () => Object.keys(await stats(host)).length).toBe(1);
  expect(await ana.evaluate(() => (window as any).session.media.mic)).toBeNull();
});

test('quem está em outro canal de voz não entra na malha', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);
  await host.getByRole('button', { name: 'Saguão', exact: true }).click();
  await ana.getByRole('button', { name: 'Jogos', exact: true }).click();
  await expect(host.locator('.voice-member')).toHaveCount(2);
  await host.waitForTimeout(800);
  expect(Object.keys(await stats(host))).toHaveLength(0);
});

test('trocar de canal mantém o microfone e a voz com quem está lá', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);
  await host.getByRole('button', { name: 'Jogos', exact: true }).click();
  await ana.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect(host.locator('.voice-member')).toHaveCount(2);

  await ana.getByRole('button', { name: 'Jogos', exact: true }).first().click();
  await expect.poll(async () => Object.values(await stats(host)).map((s: any) => s.state).join(), { timeout: 15_000 }).toBe('connected');
  expect(await ana.evaluate(() => (window as any).session.media.mic?.getAudioTracks()[0].readyState)).toBe('live');
  await expect.poll(async () => (await receivedFrom(host))[0] ?? 0, { timeout: 10_000 }).toBeGreaterThan(1000);
});

test('sem microfone a pessoa entra apenas ouvindo', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const context = await browser.newContext();
  const ana = await context.newPage();
  await ana.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('negado', 'NotAllowedError'));
  });
  await ana.goto('/');
  await ana.getByLabel('Nome de usuário').fill('Ana');
  await ana.getByRole('button', { name: 'Continuar' }).click();
  await joinRoom(ana, code);

  await host.getByRole('button', { name: 'Saguão', exact: true }).click();
  await ana.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect(ana.getByText('Microfone indisponível')).toBeVisible();
  // Ouve o host mesmo sem enviar áudio.
  await expect.poll(async () => (await receivedFrom(ana))[0] ?? 0, { timeout: 20_000 }).toBeGreaterThan(1000);
});

test('configurações listam dispositivos e medem o microfone', async ({ browser }) => {
  const page = await person(browser, 'Ana');
  await createRoom(page);
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByRole('combobox', { name: 'Microfone', exact: true }).click();
  await expect(page.getByRole('listbox')).toContainText('Fake');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Configurações' })).toBeVisible(); // Esc fechou só a lista
  // O microfone falso só bipa: observa o pico em vez de torcer para amostrar no bipe.
  const peak = await page.getByRole('meter').evaluate((el) => new Promise<number>((resolve) => {
    let max = 0;
    const timer = setInterval(() => (max = Math.max(max, Number(el.getAttribute('aria-valuenow')))), 20);
    setTimeout(() => (clearInterval(timer), resolve(max)), 3000);
  }));
  expect(peak).toBeGreaterThan(0);
  await page.screenshot({ path: `${shots}/4-config.png` });
});

test('a voz enviada passa pelo tratamento e os ajustes valem na hora', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);
  for (const page of [host, ana]) await page.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect.poll(async () => Object.values(await stats(ana)).map((s: any) => s.state).join(), { timeout: 20_000 }).toBe('connected');

  // O que vai para a rede é a saída do tratamento, não a captura crua.
  const processed = () => ana.evaluate(() => {
    const media = (window as any).session.media;
    const [peer] = media.peers.values();
    const sent = peer.pc.getSenders().find((s: RTCRtpSender) => s.track?.kind === 'audio')?.track;
    return Boolean(media.chain) && sent === media.mic.getAudioTracks()[0] && sent !== media.micRaw.getAudioTracks()[0];
  });
  await expect.poll(processed).toBe(true);

  // O bipe acende o indicador por ~0,4 s a cada 1 s: amostra rápido em vez de depender da fase do polling.
  const anaSpoke = () => host.evaluate(() => new Promise<boolean>((resolve) => {
    const lit = () => [...document.querySelectorAll('.voice-member')].some((el) => el.textContent?.includes('Ana') && el.querySelector('.speaking'));
    const timer = setInterval(() => lit() && (clearInterval(timer), resolve(true)), 20);
    setTimeout(() => (clearInterval(timer), resolve(false)), 3000);
  }));
  await expect.poll(anaSpoke, { timeout: 15_000 }).toBe(true);

  // Volume zero: nada passa da porta, então o indicador apaga sem reabrir o microfone.
  const raw = await ana.evaluate(() => (window as any).session.media.micRaw.getAudioTracks()[0].id);
  await ana.evaluate(() => (window as any).session.updateSettings({ micVolume: 0 }));
  await expect.poll(anaSpoke, { timeout: 10_000 }).toBe(false);
  await ana.evaluate(() => (window as any).session.updateSettings({ micVolume: 1 }));
  await expect.poll(anaSpoke, { timeout: 15_000 }).toBe(true);
  expect(await ana.evaluate(() => (window as any).session.media.micRaw.getAudioTracks()[0].id)).toBe(raw);
});
