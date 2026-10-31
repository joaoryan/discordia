import { chromium, expect, test, type Browser } from '@playwright/test';
import { memberList } from './helpers';

let browser: Browser;
test.beforeEach(async () => {
  browser = await chromium.launch(test.info().project.use.launchOptions);
});
test.afterEach(async () => {
  await browser.close();
});

const setup = async (context: any, name: string, url = '/') => {
  const page = await context.newPage();
  await page.goto(url);
  await page.getByLabel('Nome de usuário').fill(name);
  await page.getByRole('button', { name: 'Continuar' }).click();
  return page;
};

test('três abas do mesmo navegador são três pessoas', async () => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173', permissions: ['microphone'] });
  const host = await setup(context, 'Host');
  await host.getByRole('button', { name: 'Criar sala' }).click();
  const code = await host.locator('main header .code code').textContent();
  for (let i = 0; i < 3; i++) {
    const tab = await context.newPage();
    await tab.goto(`/#${code}`);
    await expect(tab.getByRole('textbox', { name: 'Mensagem' })).toBeVisible({ timeout: 20_000 });
  }
  await expect(memberList(host).getByRole('heading')).toHaveText('Online — 4');
  await expect(host.getByRole('textbox', { name: 'Mensagem' })).toBeVisible();
});

test('link de convite entra direto, mesmo no primeiro acesso', async () => {
  const hostContext = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const host = await setup(hostContext, 'Host');
  await host.getByRole('button', { name: 'Criar sala' }).click();
  const code = await host.locator('main header .code code').textContent();

  for (const name of ['Ana', 'Bia', 'Caio']) {
    const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    const page = await setup(context, name, `/#${code}`);
    await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeVisible({ timeout: 20_000 });
  }
  await expect(memberList(host).getByRole('heading')).toHaveText('Online — 4');
});

test('banimento vale para outras abas do mesmo navegador', async () => {
  const hostContext = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const host = await setup(hostContext, 'Host');
  await host.getByRole('button', { name: 'Criar sala' }).click();
  const code = await host.locator('main header .code code').textContent();
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const ana = await setup(context, 'Ana', `/#${code}`);
  await expect(ana.getByRole('textbox', { name: 'Mensagem' })).toBeVisible({ timeout: 20_000 });
  await memberList(host).getByRole('button', { name: /Ana/ }).click();
  await host.getByRole('menuitem', { name: 'Banir' }).click();
  const tab = await context.newPage();
  await tab.goto(`/#${code}`);
  await expect(tab.getByRole('alert')).toHaveText('Você foi banido desta sala.');
});
