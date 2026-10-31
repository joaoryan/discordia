import { expect, test, type Browser, type Page } from '@playwright/test';

export const shots = 'test-results/screens';

// Cada pessoa abre sua própria sessão; sem fechar, chamadas de um teste pesam no seguinte.
const open: { close: () => Promise<void> }[] = [];
test.afterEach(async () => {
  await Promise.all(open.splice(0).map((context) => context.close().catch(() => {})));
});

export async function person(browser: Browser, name: string) {
  const context = await browser.newContext({ permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'] });
  open.push(context);
  const page = await context.newPage();
  page.on('console', (m) => m.text().includes('microfone indisponível') && console.log(`[${name}]`, m.text().slice(0, 160)));
  page.on('pageerror', (err) => console.log(`[${name}] erro:`, err.message));
  await page.goto('/');
  await page.getByLabel('Nome de usuário').fill(name);
  await page.getByRole('button', { name: 'Continuar' }).click();
  return page;
}

export async function createRoom(page: Page) {
  await page.getByRole('button', { name: 'Criar sala' }).click();
  const code = page.locator('main header .code code');
  await expect(code).toHaveText(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/, { timeout: 15_000 });
  return (await code.textContent())!;
}

export async function joinRoom(page: Page, code: string) {
  await page.getByLabel('Código da sala').fill(code);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Mensagem' })).toBeVisible({ timeout: 20_000 });
}

export async function say(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Mensagem' }).fill(text);
  await page.keyboard.press('Enter');
}

export const memberList = (page: Page) => page.getByRole('complementary', { name: 'Membros' });
