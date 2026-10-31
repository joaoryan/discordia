import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { createRoom, joinRoom, person } from './helpers';

const report = (page: Page) => page.evaluate(async () => {
  const media = (window as any).session.media;
  return { mic: !!media.mic, peers: Object.values(await media.stats()) as { state: string; inbound: number }[] };
});

test('10 pessoas falando: todas com microfone e áudio chegando de todas para todas', async () => {
  test.setTimeout(180_000);
  // Um processo por pessoa, como 10 computadores: um só Chromium limita capturas simultâneas.
  const options = test.info().project.use.launchOptions;
  const browsers: Browser[] = await Promise.all(Array.from({ length: 11 }, () => chromium.launch(options)));
  try {
    const pages: Page[] = [];
    let code = '';
    for (let i = 0; i < 10; i++) {
      const page = await person(browsers[i], `P${i}`);
      if (i === 0) code = await createRoom(page);
      else await joinRoom(page, code);
      pages.push(page);
    }

    const started = Date.now();
    await Promise.all(pages.map((p) => p.getByRole('button', { name: 'Saguão', exact: true }).click()));
    for (const page of pages) {
      await expect.poll(async () => {
        const { mic, peers } = await report(page);
        return mic && peers.length === 9 && peers.every((p) => p.state === 'connected' && p.inbound > 1000);
      }, { timeout: 60_000 }).toBe(true);
    }
    console.log(`10 pessoas com áudio em todos os 90 sentidos após ${Date.now() - started} ms`);

    const extra = await person(browsers[10], 'P10');
    await joinRoom(extra, code);
    await extra.getByRole('button', { name: 'Saguão', exact: true }).click();
    await expect(extra.getByText('O canal Saguão está cheio.')).toBeVisible();
    await expect(extra.getByRole('button', { name: 'Sair do canal de voz' })).toHaveCount(0);
    expect(await extra.evaluate(() => (window as any).session.media.mic)).toBeNull();
  } finally {
    await Promise.all(browsers.map((b) => b.close()));
  }
});
