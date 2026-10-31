import { expect, test } from '@playwright/test';
import { createRoom, person, say, shots } from './helpers';

test('primeiro acesso, sala do host e responsividade', async ({ browser }) => {
  const page = await person(browser, 'Ana');
  await expect(page.getByRole('heading', { name: 'Discordia', exact: true })).toBeVisible();
  await page.screenshot({ path: `${shots}/1-inicio.png` });

  await page.getByRole('radio', { name: 'Tema Miami Neon' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'miami');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'miami');
  await expect(page.getByRole('button', { name: 'Criar sala' })).toBeVisible(); // perfil persistiu

  await createRoom(page);
  await expect(page.getByRole('button', { name: 'geral', exact: true })).toBeVisible();
  await say(page, 'Olá, @Ana! veja https://exemplo.com');
  await expect(page.locator('article')).toHaveCount(1);
  await page.screenshot({ path: `${shots}/1-sala.png` });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);

  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(250); // gaveta termina de recolher
  await page.screenshot({ path: `${shots}/1-celular.png` });
  await expect(page.locator('main').getByRole('button', { name: 'Encerrar sala' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'Abrir canais' }).click();
  await expect(page.getByRole('button', { name: 'off-topic' })).toBeInViewport();
});
