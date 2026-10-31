import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, person, say } from './helpers';

test('build de produção funciona sob a CSP real', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const violations: string[] = [];
  for (const p of [host]) p.on('console', (m) => /Content.Security.Policy/i.test(m.text()) && violations.push(m.text()));
  const response = await host.goto('/');
  expect(response!.headers()['content-security-policy']).toContain("script-src 'self'");

  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
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
