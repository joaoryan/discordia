import { expect } from '@playwright/test';
import { createRoom, joinRoom, person, shots, test } from './helpers';

test('amigos recentes: mensagem direta e sala nova com convite', async ({ browser }) => {
  const host = await person(browser, 'Host');
  const code = await createRoom(host);
  const ana = await person(browser, 'Ana');
  await joinRoom(ana, code);

  // Estar na mesma sala basta para virar amigo recente.
  await ana.getByRole('button', { name: 'Amigos', exact: true }).click();
  const panel = ana.getByRole('complementary', { name: 'Amigos' });
  await panel.locator('.person', { hasText: 'Host' }).click();
  await panel.getByRole('textbox', { name: 'Mensagem para Host' }).fill('bora jogar depois?');
  await panel.getByRole('textbox', { name: 'Mensagem para Host' }).press('Enter');
  await expect(panel.locator('.bubble')).toHaveText('bora jogar depois?');

  // Chega para o host como aviso, e "Responder" abre a conversa.
  const card = host.getByRole('status').filter({ hasText: 'bora jogar depois?' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.getByRole('button', { name: 'Responder' }).click();
  const hostPanel = host.getByRole('complementary', { name: 'Amigos' });
  await expect(hostPanel.locator('.bubble')).toHaveText('bora jogar depois?');
  await hostPanel.getByRole('textbox', { name: 'Mensagem para Ana' }).fill('fechou');
  await hostPanel.getByRole('textbox', { name: 'Mensagem para Ana' }).press('Enter');
  await expect(panel.locator('.bubble').last()).toHaveText('fechou');
  await host.screenshot({ path: `${shots}/17-conversa.png` });
  await host.keyboard.press('Escape');
  await ana.keyboard.press('Escape');

  // A sala acaba; na tela inicial a Ana chama o host para uma sala nova.
  await host.locator('main header').getByRole('button', { name: 'Encerrar sala' }).click();
  await host.getByRole('dialog').getByRole('button', { name: 'Encerrar sala' }).click();
  await expect(ana.getByRole('button', { name: 'Criar sala', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(ana.getByText('online').first()).toBeVisible({ timeout: 60_000 });
  await ana.getByRole('checkbox', { name: 'Chamar Host' }).check();
  await ana.screenshot({ path: `${shots}/17-inicio-amigos.png` });
  await ana.getByRole('button', { name: 'Criar sala e chamar Host' }).click();
  await expect(ana.locator('main header .code code')).toHaveText(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/, { timeout: 15_000 });
  const newCode = await ana.locator('main header .code code').textContent();

  const invite = host.getByRole('status').filter({ hasText: 'te chamou para' });
  await expect(invite).toContainText('Sala de Ana', { timeout: 10_000 });
  await host.screenshot({ path: `${shots}/17-convite.png` });
  await invite.getByRole('button', { name: 'Entrar' }).click();
  await expect(host.locator('main header .code code')).toHaveText(newCode!, { timeout: 20_000 });
  await expect(host.getByRole('textbox', { name: 'Mensagem' })).toBeVisible();
});
