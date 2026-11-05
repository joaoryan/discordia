import { expect } from '@playwright/test';
import { createRoom, joinRoom, members, person, say, shots, test } from './helpers';

test('amigos entram pelo código e o Worker sai do caminho', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  const sockets: string[] = [];
  let closed = 0;
  ana.on('websocket', (ws) => {
    if (!ws.url().includes('/ws/')) return;
    sockets.push(ws.url());
    ws.on('close', () => closed++);
  });
  await joinRoom(ana, code);
  const bia = await person(browser, 'Bia');
  await joinRoom(bia, code.toLowerCase().replace('-', ''));

  for (const page of [host, ana, bia]) await expect((await members(page)).getByRole('heading')).toHaveText('Online — 3');
  await host.screenshot({ path: `${shots}/2-membros.png` });
  expect(sockets).toHaveLength(1);
  // Convidado fecha a sinalização: daqui em diante o chat não depende do servidor.
  await expect.poll(() => closed).toBe(1);
  await say(ana, 'sem servidor no meio');
  await expect(bia.getByText('sem servidor no meio')).toBeVisible();
});

test('código inexistente e código malformado', async ({ browser }) => {
  const page = await person(browser, 'Ana');
  await page.getByLabel('Código da sala').fill('ABCDEF');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Não existe sala com esse código.');
  await page.getByLabel('Código da sala').fill('123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('digite o código de 6 caracteres')).toBeVisible();
});

test('link de sala que não existe volta para o início com o motivo', async ({ browser }) => {
  const page = await person(browser, 'Ana');
  await page.goto('/#AB7-K2Q');
  await expect(page.getByRole('alert')).toHaveText('Não existe sala com esse código.');
});

test('host encerra a sala: todos saem e o código morre', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);
  await host.locator('main header').getByRole('button', { name: 'Encerrar sala' }).click();
  await host.getByRole('dialog').getByRole('button', { name: 'Encerrar sala' }).click();
  await expect(ana.getByRole('alert')).toHaveText('A sala foi encerrada pelo host.');
  await ana.getByLabel('Código da sala').fill(code);
  await ana.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(ana.getByRole('alert')).toHaveText('Não existe sala com esse código.');
});

test('aba do host cai sem aviso: convidado é informado', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);
  await host.close({ runBeforeUnload: false });
  await expect(ana.getByRole('alert')).toHaveText('O host não voltou e a sala foi encerrada.', { timeout: 50_000 });
});

test('expulsar, banir e trancar', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);

  await (await members(host)).getByRole('button', { name: /Ana/ }).click();
  await host.getByRole('menuitem', { name: 'Banir' }).click();
  await expect(ana.getByRole('alert')).toHaveText('Você foi banido da sala pelo host.');
  await expect((await members(host)).getByRole('heading')).toHaveText('Online — 1');

  await ana.getByLabel('Código da sala').fill(code);
  await ana.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(ana.getByRole('alert')).toHaveText('Você foi banido desta sala.');

  const bia = await person(browser, 'Bia');
  await joinRoom(bia, code);
  await (await members(host)).getByRole('button', { name: /Bia/ }).click();
  await host.getByRole('menuitem', { name: 'Expulsar' }).click();
  await expect(bia.getByRole('alert')).toHaveText('Você foi expulso da sala pelo host.');

  await host.getByRole('button', { name: 'Trancar sala' }).click();
  await bia.getByLabel('Código da sala').fill(code);
  await bia.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(bia.getByRole('alert')).toHaveText('O host trancou esta sala.');
});

test('convidado que recarrega volta para a sala com o histórico', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);
  await say(host, 'antes de recarregar');
  await expect(ana.getByText('antes de recarregar')).toBeVisible();

  await ana.reload();
  await ana.getByLabel('Código da sala').fill(code);
  await ana.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(ana.getByText('antes de recarregar')).toBeVisible({ timeout: 20_000 });
  await expect((await members(host)).getByRole('heading')).toHaveText('Online — 2');
});

test('sala recente que eu criei reabre com o mesmo código depois de fechar a aba', async ({ browser }) => {
  const ana = await person(browser, 'Ana');
  const code = await createRoom(ana);
  const tab = await ana.context().newPage();
  await ana.close(); // a sala vivia nessa aba
  await tab.goto('/');
  await tab.getByRole('button', { name: new RegExp(code) }).click();

  // Volta como host, com o mesmo código: o link antigo dos amigos funciona de novo.
  await expect(tab.locator('main header .code code')).toHaveText(code, { timeout: 15_000 });
  await expect(tab.locator('main header').getByRole('button', { name: 'Encerrar sala' })).toBeVisible();
  const bia = await person(browser, 'Bia');
  await joinRoom(bia, code);
  await expect((await members(bia)).getByRole('heading')).toHaveText('Online — 2');
});

test('sala recente ainda aberta em outra aba: entra como convidado, sem tomar a sala', async ({ browser }) => {
  const ana = await person(browser, 'Ana');
  const code = await createRoom(ana);
  const tab = await ana.context().newPage();
  await tab.goto('/');
  await tab.getByRole('button', { name: new RegExp(code) }).click();
  await expect(tab.getByRole('textbox', { name: 'Mensagem' })).toBeVisible({ timeout: 20_000 });
  await expect(tab.locator('main header').getByRole('button', { name: 'Encerrar sala' })).toHaveCount(0);
  await expect((await members(ana)).getByRole('heading')).toHaveText('Online — 2');
  await expect(ana.locator('main header').getByRole('button', { name: 'Encerrar sala' })).toBeVisible();
});

test('sala recente que eu encerrei também reabre', async ({ browser }) => {
  const ana = await person(browser, 'Ana');
  const code = await createRoom(ana);
  await ana.locator('main header').getByRole('button', { name: 'Encerrar sala' }).click();
  await ana.getByRole('dialog').getByRole('button', { name: 'Encerrar sala' }).click();
  await ana.getByRole('button', { name: new RegExp(code) }).click();
  await expect(ana.locator('main header .code code')).toHaveText(code, { timeout: 15_000 });
  await expect(ana.locator('main header').getByRole('button', { name: 'Encerrar sala' })).toBeVisible();
});
