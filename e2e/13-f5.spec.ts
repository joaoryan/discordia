import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { createRoom, joinRoom, memberList, person, say } from './helpers';

let browsers: Browser[] = [];
test.beforeEach(async () => {
  browsers = await Promise.all([0, 1, 2].map(() => chromium.launch(test.info().project.use.launchOptions)));
});
test.afterEach(async () => {
  await Promise.all(browsers.map((b) => b.close()));
});

async function room() {
  const host = await person(browsers[0], 'Host');
  host.on('dialog', (d) => d.accept()); // aviso do navegador ao recarregar
  const code = await createRoom(host);
  const ana = await person(browsers[1], 'Ana');
  await joinRoom(ana, code);
  const bia = await person(browsers[2], 'Bia');
  await joinRoom(bia, code);
  return { host, ana, bia, code };
}

const enterVoice = async (pages: Page[]) => {
  for (const page of pages) await page.getByRole('button', { name: 'Saguão', exact: true }).click();
  await expect(pages[0].locator('.voice-member')).toHaveCount(pages.length);
};
const peerBytes = (page: Page, name: string) => page.evaluate(async (who) => {
  const s = (window as any).session;
  const id = s.members.find((m: any) => m.name === who)?.id;
  return (await s.media.stats())[id] ?? null;
}, name);

test('F5 do host: mesma sala, mesmo código, histórico e todos de volta', async () => {
  const { host, ana, bia, code } = await room();
  await say(ana, 'mensagem antes do F5');
  await expect(host.getByText('mensagem antes do F5')).toBeVisible();
  await host.getByRole('button', { name: 'Trancar sala' }).click();

  await host.reload();
  await expect(host.locator('main header .code code')).toHaveText(code, { timeout: 15_000 });
  await expect(host.getByText('mensagem antes do F5')).toBeVisible();
  await expect(host.getByRole('button', { name: 'Destrancar sala' })).toBeVisible();
  await expect(memberList(host).getByRole('heading')).toHaveText('Online — 3', { timeout: 20_000 });
  await expect(ana.getByRole('alert')).toHaveCount(0);

  await say(host, 'voltei');
  await expect(ana.getByText('voltei')).toBeVisible();
  await expect(bia.getByText('voltei')).toBeVisible();
  await expect(ana.getByText('Ana entrou na sala.')).toHaveCount(1); // sem repetir a entrada
});

test('voz entre convidados não cai no F5 e o host volta para a chamada', async () => {
  const { host, ana, bia } = await room();
  await enterVoice([host, ana, bia]);
  await expect.poll(async () => (await peerBytes(ana, 'Bia'))?.state, { timeout: 15_000 }).toBe('connected');
  await expect.poll(async () => (await peerBytes(ana, 'Host'))?.state, { timeout: 15_000 }).toBe('connected');
  const id = await ana.evaluate(() => {
    const s = (window as any).session;
    (window as any).biaPc = s.media.peers.get(s.members.find((m: any) => m.name === 'Bia').id).pc;
    return s.selfId;
  });

  await host.reload();
  await expect(ana.getByText('O host está recarregando')).toBeVisible({ timeout: 5000 });
  const before = (await peerBytes(ana, 'Bia')).inbound;
  await expect(memberList(host).getByRole('heading')).toHaveText('Online — 3', { timeout: 20_000 });
  await expect.poll(async () => (await peerBytes(ana, 'Bia'))?.inbound ?? 0).toBeGreaterThan(before);

  expect(await ana.evaluate(() => (window as any).session.selfId)).toBe(id); // mesmo id
  expect(await ana.evaluate(() => {
    const s = (window as any).session;
    return s.media.peers.get(s.members.find((m: any) => m.name === 'Bia').id).pc === (window as any).biaPc;
  })).toBe(true); // a mesma conexão, sem renegociar

  await expect(host.locator('.voice-member')).toHaveCount(3, { timeout: 15_000 });
  await expect.poll(async () => (await peerBytes(ana, 'Host'))?.state, { timeout: 20_000 }).toBe('connected');
  await expect.poll(async () => (await peerBytes(host, 'Ana'))?.inbound ?? 0, { timeout: 15_000 }).toBeGreaterThan(1000);
  await expect(ana.locator('.voice-member')).toHaveCount(3);
});

test('encerrar depois do F5 acaba de verdade e não volta sozinho', async () => {
  const { host, ana, code } = await room();
  await host.reload();
  await expect(memberList(host).getByRole('heading')).toHaveText('Online — 3', { timeout: 20_000 });
  await host.getByRole('navigation', { name: 'Servidores' }).getByRole('button', { name: 'Encerrar sala' }).click();
  await host.getByRole('dialog').getByRole('button', { name: 'Encerrar sala' }).click();
  await expect(ana.getByRole('alert')).toHaveText('A sala foi encerrada pelo host.');
  await host.reload();
  await expect(host.getByRole('button', { name: 'Criar sala' })).toBeVisible();
  await ana.getByLabel('Código da sala').fill(code);
  await ana.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(ana.getByRole('alert')).toHaveText('Não existe sala com esse código.');
});

test('nova aba do mesmo navegador não vira host da sala', async () => {
  const { host, code } = await room();
  await host.reload();
  await expect(memberList(host).getByRole('heading')).toHaveText('Online — 3', { timeout: 20_000 });
  const tab = await host.context().newPage();
  await tab.goto('/');
  await expect(tab.getByRole('button', { name: 'Criar sala' })).toBeVisible();
  await tab.close();
  await expect(host.locator('main header .code code')).toHaveText(code);
});

test('dois F5 seguidos', async () => {
  const { host, ana } = await room();
  await host.reload();
  await expect(host.locator('main header .code code')).toBeVisible({ timeout: 15_000 });
  await host.reload();
  await expect(memberList(host).getByRole('heading')).toHaveText('Online — 3', { timeout: 30_000 });
  await say(ana, 'ainda aqui');
  await expect(host.getByText('ainda aqui')).toBeVisible();
});
