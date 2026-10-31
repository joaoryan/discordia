import { expect, test } from '@playwright/test';
import { createRoom, joinRoom, memberList, person, say, shots } from './helpers';

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

  for (const page of [host, ana, bia]) await expect(memberList(page).getByRole('heading')).toHaveText('Online — 3');
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
  await expect(page.getByText('Códigos têm 6 caracteres')).toBeVisible();
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
  await host.getByRole('navigation', { name: 'Servidores' }).getByRole('button', { name: 'Encerrar sala' }).click();
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

  await memberList(host).getByRole('button', { name: /Ana/ }).click();
  await host.getByRole('menuitem', { name: 'Banir' }).click();
  await expect(ana.getByRole('alert')).toHaveText('Você foi banido da sala pelo host.');
  await expect(memberList(host).getByRole('heading')).toHaveText('Online — 1');

  await ana.getByLabel('Código da sala').fill(code);
  await ana.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(ana.getByRole('alert')).toHaveText('Você foi banido desta sala.');

  const bia = await person(browser, 'Bia');
  await joinRoom(bia, code);
  await memberList(host).getByRole('button', { name: /Bia/ }).click();
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
  await expect(memberList(host).getByRole('heading')).toHaveText('Online — 2');
});
