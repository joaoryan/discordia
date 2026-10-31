import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, person, say, shots } from './helpers';

const room = async (browser: any) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);
  return { host, ana, code };
};

test('texto em tempo real, canais e não lidas', async ({ browser }) => {
  const { host, ana } = await room(browser);
  await say(host, 'oi do host');
  await expect(ana.getByText('oi do host')).toBeVisible();
  await say(ana, 'oi da ana');
  await expect(host.getByText('oi da ana')).toBeVisible();

  await ana.getByRole('button', { name: 'off-topic' }).click();
  await expect(ana.getByText('oi do host')).toHaveCount(0);
  await say(host, 'mensagem em geral');
  await expect(ana.getByRole('button', { name: /geral/ }).locator('b')).toHaveText('1');
  await ana.getByRole('button', { name: /geral/ }).click();
  await expect(ana.getByText('mensagem em geral')).toBeVisible();
});

test('HTML nunca é interpretado', async ({ browser }) => {
  const { host, ana } = await room(browser);
  await say(host, '<img src=x onerror="window.pwned=1"><b>negrito</b>');
  await expect(ana.getByText('<b>negrito</b>', { exact: false })).toBeVisible();
  expect(await ana.evaluate(() => (window as any).pwned)).toBeUndefined();
  await expect(ana.locator('article b')).toHaveCount(0);
});

test('resposta, reação, menção e digitando', async ({ browser }) => {
  const { host, ana } = await room(browser);
  await say(host, 'alguém aí?');
  const message = ana.locator('article').filter({ hasText: 'alguém aí?' });
  await message.hover();
  await message.getByRole('button', { name: 'Reagir com 🔥' }).click();
  await expect(host.locator('.reactions button')).toHaveText(/🔥\s*1/);

  await message.hover();
  await message.getByRole('button', { name: 'Responder' }).click();
  await ana.getByRole('textbox', { name: 'Mensagem' }).pressSequentially('sim');
  await expect(host.getByText('Ana está digitando')).toBeVisible();
  await ana.keyboard.press('Enter');
  await expect(host.locator('.reply')).toContainText('alguém aí?');
  await expect(host.getByText('Ana está digitando')).toHaveCount(0, { timeout: 1000 });

  const box = host.getByRole('textbox', { name: 'Mensagem' });
  await box.pressSequentially('olá @A');
  await host.getByRole('listbox').getByRole('option', { name: '@Ana' }).click();
  await expect(box).toHaveValue('olá @Ana ');
  await host.keyboard.press('Enter');
  await expect(ana.locator('article.mentioned')).toBeVisible();
  await host.screenshot({ path: `${shots}/3-chat.png` });
});

test('imagem e arquivo atravessam o DataChannel inteiros', async ({ browser }) => {
  const { host, ana } = await room(browser);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await ana.locator('input[type=file]').setInputFiles({ name: 'ponto.png', mimeType: 'image/png', buffer: png });
  await ana.keyboard.press('Enter');
  await ana.getByRole('textbox', { name: 'Mensagem' }).press('Enter');
  const img = host.locator('article img[alt="ponto.png"]');
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => el.decode().then(() => el.naturalWidth))).toBe(1);

  // Arquivo próximo do limite: exige fragmentação e controle de fluxo.
  const big = Buffer.alloc(1_900_000, 7);
  await ana.locator('input[type=file]').setInputFiles({ name: 'grande.bin', mimeType: 'application/zip', buffer: big });
  await expect(ana.getByText('Anexo:')).toBeVisible();
  await ana.getByRole('textbox', { name: 'Mensagem' }).press('Enter');
  const link = host.locator('a.file');
  await expect(link).toContainText('grande.bin', { timeout: 20_000 });
  const size = await link.evaluate((a: HTMLAnchorElement) => a.href.length);
  expect(size).toBeGreaterThan(1_900_000 * 1.3);
});

test('quem chega depois recebe o histórico da sessão', async ({ browser }) => {
  const { host, code } = await room(browser);
  await say(host, 'mensagem antiga');
  const bia = await person(browser, 'Bia');
  await joinRoom(bia, code);
  await expect(bia.getByText('mensagem antiga')).toBeVisible();
});

test('canais criados pelo host aparecem para todos', async ({ browser }) => {
  const { host, ana } = await room(browser);
  await host.getByRole('button', { name: 'Criar canal de texto' }).click();
  await host.getByLabel('Nome do canal').fill('Memes Bons');
  await host.getByRole('button', { name: 'Criar canal', exact: true }).click();
  await expect(ana.getByRole('button', { name: 'memes-bons' })).toBeVisible();
  await expect(ana.getByRole('button', { name: 'Criar canal de texto' })).toHaveCount(0);
});
