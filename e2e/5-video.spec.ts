import { expect, test, type Page } from '@playwright/test';
import { createRoom, joinRoom, person, shots } from './helpers';

const liveVideo = (page: Page, label: string) =>
  page.locator(`[data-label="${label}"] video`).evaluate(
    (v: HTMLVideoElement) => new Promise<boolean>((resolve) => {
      const first = v.currentTime;
      setTimeout(() => resolve(v.videoWidth > 0 && v.currentTime > first), 700);
    }),
  );

async function voiceRoom(browser: any, names: string[]) {
  const pages: Page[] = [];
  let code = '';
  for (const [i, name] of names.entries()) {
    const page = await person(browser, name);
    if (i === 0) code = await createRoom(page);
    else await joinRoom(page, code);
    pages.push(page);
  }
  for (const page of pages) await page.getByRole('button', { name: 'Saguão', exact: true }).click();
  for (const page of pages) await expect(page.locator('.voice-member')).toHaveCount(names.length);
  return pages;
}

test('câmera liga e desliga no meio da chamada', async ({ browser }) => {
  const [host, ana] = await voiceRoom(browser, ['Host', 'Ana']);
  await ana.getByRole('button', { name: 'Ligar câmera' }).click();
  await expect(host.locator('[data-label="Ana"] video')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => liveVideo(host, 'Ana'), { timeout: 10_000 }).toBe(true);

  // Os dois ao mesmo tempo: força a colisão de ofertas que o Perfect Negotiation resolve.
  await host.getByRole('button', { name: 'Ligar câmera' }).click();
  await ana.getByRole('button', { name: 'Desligar câmera' }).click();
  await ana.getByRole('button', { name: 'Ligar câmera' }).click();
  await expect(ana.locator('[data-label="Host"] video')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => liveVideo(ana, 'Host'), { timeout: 10_000 }).toBe(true);
  await expect.poll(() => liveVideo(host, 'Ana'), { timeout: 10_000 }).toBe(true);
  await host.screenshot({ path: `${shots}/5-video.png` });

  await ana.getByRole('button', { name: 'Desligar câmera' }).click();
  await expect(host.locator('[data-label="Ana"] video')).toHaveCount(0);
});

test('tela só é enviada para quem clica em Assistir', async ({ browser }) => {
  const [host, ana, bia] = await voiceRoom(browser, ['Host', 'Ana', 'Bia']);
  await host.getByRole('button', { name: 'Compartilhar tela' }).click();
  await host.getByRole('button', { name: 'Escolher o que compartilhar' }).click();
  await expect(host.locator('[data-label="Sua tela"] video')).toBeVisible({ timeout: 15_000 });
  await expect(ana.getByText('Host está ao vivo')).toBeVisible();
  await expect(bia.getByText('Host está ao vivo')).toBeVisible();
  await host.screenshot({ path: `${shots}/5-tela-transmissor.png` });

  await ana.getByRole('button', { name: 'Assistir' }).click();
  const screen = '[data-label="Tela de Host"] video';
  await expect(ana.locator(screen)).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => liveVideo(ana, 'Tela de Host'), { timeout: 10_000 }).toBe(true);
  await ana.screenshot({ path: `${shots}/5-tela-espectador.png` });

  const senders = await host.evaluate(() => {
    const media = (window as any).session.media;
    const out: Record<string, number> = {};
    for (const [id, peer] of media.peers) {
      out[id] = peer.pc.getSenders().filter((s: RTCRtpSender) => s.track?.kind === 'video').length;
    }
    return Object.values(out).sort();
  });
  expect(senders).toEqual([0, 1]); // um espectador, um não
  await expect(bia.locator(screen)).toHaveCount(0);

  await ana.getByRole('button', { name: 'Parar de assistir' }).click();
  await expect(ana.locator(screen)).toHaveCount(0);
  await expect(ana.getByRole('button', { name: 'Assistir' })).toBeVisible();

  await host.getByRole('button', { name: 'Parar de compartilhar' }).click();
  await expect(ana.locator('[data-label="Tela de Host"]')).toHaveCount(0);
  await expect(ana.getByRole('button', { name: 'Assistir' })).toHaveCount(0);
});

test('limite de bitrate da câmera é aplicado na conexão', async ({ browser }) => {
  const [host] = await voiceRoom(browser, ['Host', 'Ana']);
  await host.getByRole('button', { name: 'Ligar câmera' }).click();
  await expect.poll(() => host.evaluate(() => {
    const [peer] = (window as any).session.media.peers.values();
    const sender = peer.pc.getSenders().find((s: RTCRtpSender) => s.track?.kind === 'video');
    return sender?.getParameters().encodings[0]?.maxBitrate;
  }), { timeout: 15_000 }).toBe(500_000);
});
