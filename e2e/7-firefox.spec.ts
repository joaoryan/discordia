import { expect, firefox, test } from '@playwright/test';
import { createRoom, joinRoom, person, say } from './helpers';

test('Chromium e Firefox na mesma sala, com o Firefox como convidado e como host', async ({ browser }) => {
  const gecko = await firefox.launch({
    firefoxUserPrefs: {
      'media.navigator.streams.fake': true,
      'media.navigator.permission.disabled': true,
      'media.peerconnection.ice.obfuscate_host_addresses': false,
    },
  });
  try {
    const open = async (name: string) => {
      const page = await gecko.newPage({ baseURL: 'http://localhost:5173' });
      await page.goto('/');
      await page.getByLabel('Nome de usuário').fill(name);
      await page.getByRole('button', { name: 'Continuar' }).click();
      return page;
    };

    const cr = await person(browser, 'Chrome');
    const code = await createRoom(cr);
    const fx = await open('Fox');
    await joinRoom(fx, code);
    await say(fx, 'oi do firefox');
    await expect(cr.getByText('oi do firefox')).toBeVisible();

    for (const page of [cr, fx]) await page.getByRole('button', { name: 'Saguão', exact: true }).click();
    const inbound = (page: typeof cr) => page.evaluate(async () => {
      const stats = await (window as any).session.media.stats();
      return Object.values(stats).map((s: any) => s.inbound)[0] ?? 0;
    });
    await expect.poll(() => inbound(cr), { timeout: 20_000 }).toBeGreaterThan(1000);
    await expect.poll(() => inbound(fx), { timeout: 20_000 }).toBeGreaterThan(1000);

    await fx.getByRole('button', { name: 'Ligar câmera' }).click();
    await expect(cr.locator('[data-label="Fox"] video')).toBeVisible({ timeout: 15_000 });
    await cr.getByRole('button', { name: 'Ligar câmera' }).click();
    await expect(fx.locator('[data-label="Chrome"] video')).toBeVisible({ timeout: 15_000 });

    // Firefox não captura áudio de tela: a opção precisa aparecer desligada.
    await fx.getByRole('button', { name: 'Compartilhar tela' }).click();
    await expect(fx.getByLabel(/Compartilhar áudio/)).toBeDisabled();
    await fx.keyboard.press('Escape');

    const fxHost = await open('FoxHost');
    const code2 = await createRoom(fxHost);
    const cr2 = await person(browser, 'Chrome2');
    await joinRoom(cr2, code2);
    await say(cr2, 'oi host firefox');
    await expect(fxHost.getByText('oi host firefox')).toBeVisible();
  } finally {
    await gecko.close();
  }
});
