import { expect, type Page } from '@playwright/test';
import { createRoom, joinRoom, person, say, test } from './helpers';

// Registra cada som pedido, depois de passar pelas preferências da pessoa.
const record = (page: Page) => page.evaluate(() => {
  const s = (window as any).session;
  s.played = [];
  const original = s.play.bind(s);
  s.play = (id: string) => {
    const { sounds, mutedSounds } = s.settings;
    if (sounds && !mutedSounds.includes(id)) s.played.push(id);
    original(id);
  };
});
const played = (page: Page) => page.evaluate(() => (window as any).session.played as string[]);

test('cada ação da voz, do chat e da sala tem seu som', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  await record(host);

  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);
  await expect.poll(() => played(host)).toContain('memberEnter');
  await record(ana);

  await host.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect.poll(() => played(host)).toContain('join');
  await ana.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect.poll(() => played(host)).toContain('userJoin');
  await expect.poll(() => played(ana)).toContain('join');

  // O host está na tela da chamada com o chat recolhido: a menção chega em segundo plano e precisa tocar.
  await host.getByRole('button', { name: 'Chat', exact: true }).click();
  await ana.getByRole('button', { name: 'geral', exact: true }).click();
  await say(ana, '@Host chegou');
  await expect.poll(() => played(host)).toContain('mention');

  await ana.getByRole('button', { name: 'Silenciar microfone' }).click();
  await expect.poll(() => played(ana)).toContain('mute');
  await ana.getByRole('button', { name: 'Ensurdecer' }).click();
  await expect.poll(() => played(ana)).toContain('deafen');

  await ana.getByRole('button', { name: 'Sair do canal de voz' }).first().click();
  await expect.poll(() => played(ana)).toContain('leave');
  await expect.poll(() => played(host)).toContain('userLeave');
});

test('aba Sons desliga um som por vez e lembra a escolha', async ({ browser }) => {
  const page = await person(browser, 'Ana');
  await createRoom(page);
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByRole('tab', { name: 'Sons' }).click();
  await expect(page.getByRole('button', { name: /^Ouvir:/ })).toHaveCount(21);

  await page.getByRole('checkbox', { name: 'Nova mensagem' }).uncheck();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('discordia.settings')!).mutedSounds);
  expect(saved).toEqual(['message']);

  await page.getByRole('checkbox', { name: 'Tocar sons do app' }).uncheck();
  await expect(page.getByRole('checkbox', { name: 'Menção a você' })).toBeDisabled();
});
