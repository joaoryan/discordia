import { expect, type Page } from '@playwright/test';
import { createRoom, joinRoom, person, shots, test } from './helpers';

// Ana e Bia fingem estar atrás do mesmo CGNAT: o caminho direto entre elas nunca conecta.
const blockAnaBia = (page: Page) => page.evaluate(() => localStorage.setItem('discordia.testBlock', JSON.stringify(['Ana', 'Bia'])));

const idOf = (page: Page, name: string) => page.evaluate((n) => (window as any).session.members.find((m: any) => m.name === n)?.id, name);
const statsOf = (page: Page, id: string) => page.evaluate(async (peer) => (await (window as any).session.media.stats())[peer] ?? null, id);
const planOf = (page: Page) => page.evaluate(() => (window as any).session.media.plan);

/** Nível do áudio que esta página toca de uma pessoa: o microfone falso do Chromium bipa sem parar. */
const levelFrom = (page: Page, id: string) =>
  page.evaluate(async (peer) => {
    const stream: MediaStream | undefined = (window as any).session.remote[peer]?.find((s: MediaStream) => s.getAudioTracks().length);
    if (!stream) return 0;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let peak = 0;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 100));
      analyser.getFloatTimeDomainData(data);
      for (const v of data) peak = Math.max(peak, Math.abs(v));
    }
    await ctx.close();
    return peak;
  }, id);

async function enterVoice(...pages: Page[]) {
  for (const page of pages) await page.getByRole('button', { name: 'Saguão', exact: true }).click();
}

test('bloqueadas entre si, Ana e Bia se ouvem pelo host; sem ele, o par vai para o TURN', async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await blockAnaBia(ana);
  await joinRoom(ana, code);
  const bia = await person(browser, 'Bia');
  await blockAnaBia(bia);
  await joinRoom(bia, code);
  await enterVoice(host, ana, bia);
  await expect(host.locator('.voice-member')).toHaveCount(3);

  const biaId = await idOf(ana, 'Bia');
  const anaId = await idOf(bia, 'Ana');

  // O direto entre as duas falha, e o host, que alcança as duas, passa a repassar.
  await expect.poll(async () => (await statsOf(ana, biaId))?.via, { timeout: 30_000 }).toBe('host');
  await expect.poll(async () => (await statsOf(bia, anaId))?.via, { timeout: 15_000 }).toBe('host');
  expect((await statsOf(ana, biaId)).path).toBe('failed');
  expect(await host.evaluate(() => (window as any).session.media.helping)).toBe(1);

  // Com o host, o caminho é direto: ele não depende de ninguém.
  expect((await statsOf(ana, 'host')).path).toBe('direct');

  // A voz de Bia chega de verdade, e uma vez só.
  await expect.poll(() => levelFrom(ana, biaId), { timeout: 15_000 }).toBeGreaterThan(0.01);
  await expect.poll(() => levelFrom(bia, anaId), { timeout: 15_000 }).toBeGreaterThan(0.01);
  expect(await ana.evaluate(() => document.querySelectorAll('audio').length)).toBe(2);

  // O painel de Métricas mostra quem está repassando.
  await ana.evaluate(() => (window as any).session.updateSettings({ metrics: true }));
  await ana.screenshot({ path: `${shots}/18-repetidor.png` });

  // O repetidor sai: ninguém mais alcança as duas, então o par libera o TURN (aqui não há TURN).
  await host.getByRole('button', { name: 'Sair do canal de voz' }).first().click();
  await expect.poll(() => planOf(ana), { timeout: 10_000 }).toEqual([{ a: [anaId, biaId].sort()[0], b: [anaId, biaId].sort()[1], via: null }]);
  await expect.poll(async () => (await statsOf(ana, biaId))?.via).toBeNull();
  await expect.poll(() => levelFrom(ana, biaId), { timeout: 10_000 }).toBeLessThan(0.01);
});

test('par que começou no TURN passa para o amigo que chega depois', async ({ browser }) => {
  test.setTimeout(90_000);
  const ana = await person(browser, 'Ana');
  await blockAnaBia(ana);
  const code = await createRoom(ana);
  const bia = await person(browser, 'Bia');
  await blockAnaBia(bia);
  await joinRoom(bia, code);
  const caio = await person(browser, 'Caio');
  await joinRoom(caio, code);
  await enterVoice(ana, bia);

  const biaId = await idOf(ana, 'Bia');
  // Só as duas: sem repetidor possível, o plano manda usar o TURN.
  await expect.poll(async () => (await planOf(ana))[0]?.via, { timeout: 30_000 }).toBeNull();
  expect((await planOf(ana))).toHaveLength(1);

  // Caio, de outra rede, entra: passa a repassar entre as duas.
  await enterVoice(caio);
  const caioId = await idOf(ana, 'Caio');
  await expect.poll(async () => (await statsOf(ana, biaId))?.via, { timeout: 30_000 }).toBe(caioId);
  await expect.poll(() => levelFrom(ana, biaId), { timeout: 15_000 }).toBeGreaterThan(0.01);
  expect(await caio.evaluate(() => (window as any).session.media.helping)).toBe(1);
});

test('quem desliga "Ajudar a conectar" não vira repetidor', async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  await host.evaluate(() => (window as any).session.updateSettings({ helpRelay: false }));
  const ana = await person(browser, 'Ana');
  await blockAnaBia(ana);
  await joinRoom(ana, code);
  const bia = await person(browser, 'Bia');
  await blockAnaBia(bia);
  await joinRoom(bia, code);
  await enterVoice(host, ana, bia);

  await expect.poll(async () => (await planOf(ana))[0]?.via, { timeout: 30_000 }).toBeNull();
  expect(await host.evaluate(() => (window as any).session.media.helping)).toBe(0);
});
