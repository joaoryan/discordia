import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, person, say } from './helpers';

test('build de produção funciona sob a CSP real', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const violations: string[] = [];
  const watch = (p: typeof host) => p.on('console', (m) => /Content.Security.Policy|indisponível/i.test(m.text()) && !/microfone indisponível/i.test(m.text()) && violations.push(m.text()));
  watch(host);
  const response = await host.goto('/');
  expect(response!.headers()['content-security-policy']).toContain("script-src 'self'");

  // Busca: título descritivo, descrição, robots.txt liberando tudo e imagem de compartilhamento.
  await expect(host).toHaveTitle(/^Discordia · /);
  await expect(host.locator('meta[name="description"]')).toHaveAttribute('content', /chame os amigos pelo link/);
  const robots = await host.request.get('/robots.txt');
  expect(await robots.text()).toContain('Allow: /');
  expect((await host.request.get('/og.png')).headers()['content-type']).toBe('image/png');

  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  watch(ana);
  await joinRoom(ana, code);
  await say(host, 'produção');
  await expect(ana.getByText('produção')).toBeVisible();

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await ana.locator('input[type=file]').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: png });
  await expect(ana.getByText('Anexo:')).toBeVisible();
  await ana.getByRole('textbox', { name: 'Mensagem' }).press('Enter');
  await expect(host.locator('article img')).toBeVisible();

  await host.getByRole('button', { name: 'Saguão', exact: true }).click();
  await ana.getByRole('button', { name: 'Saguão', exact: true }).click();
  await ana.getByRole('button', { name: 'Ligar câmera' }).click();
  await expect(host.locator('[data-label="Ana"] video')).toBeVisible({ timeout: 15_000 });
  expect(violations).toEqual([]);
  expect(await host.evaluate(() => (window as any).session)).toBeUndefined();
});
