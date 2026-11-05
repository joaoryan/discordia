import { test as base, expect, type Browser, type Page } from '@playwright/test';

export const shots = 'test-results/screens';

// Cada pessoa abre sua própria sessão; sem fechar, chamadas de um teste pesam no seguinte
// e, depois de algumas dezenas, o Chromium esgota as capturas de áudio (NotReadableError).
// Precisa ser fixture: um `test.afterEach` aqui só valeria no primeiro arquivo que importa
// este módulo, porque ele é avaliado uma vez por worker.
const open: { close: () => Promise<void> }[] = [];
export const test = base.extend<{ closeContexts: void }>({
  closeContexts: [
    async ({ browser }, use) => {
      await use();
      // Também fecha os contextos criados à mão no navegador compartilhado.
      const all = [...open.splice(0), ...browser.contexts()];
      await Promise.all(all.map((context) => context.close().catch(() => {})));
    },
    { auto: true },
  ],
});

export async function person(browser: Browser, name: string) {
  const context = await browser.newContext({ permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'] });
  open.push(context);
  // O botão de baixar consulta o último Release; os testes não dependem do GitHub.
  await context.route('https://api.github.com/**', (route) => route.abort());
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

/** A lista de membros agora é um painel sob demanda: abre se estiver fechada. */
export async function members(page: Page) {
  const list = page.getByRole('complementary', { name: 'Membros' });
  if (!(await list.isVisible())) await page.getByRole('button', { name: 'Mostrar ou ocultar membros' }).click();
  return list;
}
