import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, person, shots } from './helpers';

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

  await ana.getByRole('complementary').first().getByRole('button', { name: 'Silenciar microfone' }).click();
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
  await expect(page.getByLabel('Microfone', { exact: true })).toContainText('Fake');
  // O microfone falso só bipa: observa o pico em vez de torcer para amostrar no bipe.
  const peak = await page.getByRole('meter').evaluate((el) => new Promise<number>((resolve) => {
    let max = 0;
    const timer = setInterval(() => (max = Math.max(max, Number(el.getAttribute('aria-valuenow')))), 20);
    setTimeout(() => (clearInterval(timer), resolve(max)), 3000);
  }));
  expect(peak).toBeGreaterThan(0);
  await page.screenshot({ path: `${shots}/4-config.png` });
});
