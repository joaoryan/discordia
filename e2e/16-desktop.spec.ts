import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { shots } from './helpers';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

// App de computador de verdade: a mesma build do site (gerada pelo webServer de produção,
// apontando para a sinalização local) dentro do Electron.
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  execSync('npm run desktop:compile', { stdio: 'ignore' });
  app = await electron.launch({
    // Sem --use-fake-ui-for-media-stream: ela aceitaria a captura de tela sem passar pelo seletor do app.
    args: ['desktop/dist/main.js', '--use-fake-device-for-media-stream'],
    // O sandbox SUID do Chromium exige root no Linux; só os testes rodam sem ele.
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1', DISCORDIA_PROFILE: mkdtempSync(path.join(tmpdir(), 'discordia-')) },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app?.close();
});

const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), url: w.webContents.getURL() })));

test('app abre o site em app://, cria sala e expõe só a ponte do app', async () => {
  expect(page.url()).toBe('app://discordia/');
  const bridge = await page.evaluate(() => ({ platform: (window as any).desktop?.platform, node: typeof (window as any).require }));
  expect(bridge).toEqual({ platform: process.platform, node: 'undefined' });

  await page.getByLabel('Nome de usuário').fill('Ana');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Criar sala' }).click();
  await expect(page.locator('main header .code code')).toHaveText(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/, { timeout: 15_000 });

  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByRole('tab', { name: 'App de computador' }).click();
  await expect(page.getByText(/^Versão /)).toBeVisible();
  await page.getByRole('button', { name: 'Fechar' }).click();
});

test('compartilhar tela passa pelo seletor do app', async () => {
  await page.getByRole('button', { name: 'Saguão', exact: true }).click();
  await page.getByRole('button', { name: 'Compartilhar tela' }).click();
  await page.getByRole('button', { name: 'Escolher o que compartilhar' }).click();
  const picker = page.getByRole('dialog', { name: 'O que compartilhar?' });
  await expect(picker).toBeVisible();
  await picker.locator('button.source').first().click();
  await expect(page.locator('[data-label="Sua tela"] video')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Parar de compartilhar' }).click();
});

const { UiohookKey } = createRequire(import.meta.url)('uiohook-napi');

test('fora de foco, a mini janela aparece e apertar para falar arma o hook global', async () => {
  await page.getByRole('button', { name: 'Configurações' }).click();
  await page.getByRole('tab', { name: 'Atalhos' }).click();
  await page.getByRole('checkbox', { name: 'Apertar para falar' }).check();
  await page.getByRole('button', { name: 'Fechar' }).click();
  // A build de produção não expõe `session`: escuta o mesmo evento que a sala recebe da ponte.
  await page.evaluate(() => (window as any).desktop.onPushToTalk((held: boolean) => ((window as any).__ptt = held)));
  const held = () => page.evaluate(() => (window as any).__ptt ?? null);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await expect.poll(async () => (await windows()).find((w) => w.url.endsWith('mini.html'))?.visible).toBe(true);

  // Compacta por padrão, para não atrapalhar o jogo; expande e recolhe sem sair do lugar.
  const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('mini.html'))!.getBounds());
  const miniPage = app.windows().find((w) => w.url().endsWith('mini.html'))!;
  await expect(miniPage.locator('#faces li')).toHaveCount(1);
  await expect.poll(async () => { const b = await bounds(); return b.width <= 120 && b.height <= 40; }).toBe(true);
  const compact = await bounds();
  await miniPage.screenshot({ path: `${shots}/16-mini-compacta.png` });
  await miniPage.getByRole('button', { name: 'Expandir' }).click();
  await expect.poll(async () => (await bounds()).height).toBeGreaterThan(80);
  const open = await bounds();
  expect(open.x + open.width).toBe(compact.x + compact.width);
  await expect(miniPage.locator('#people')).toContainText('Ana (você)');
  await miniPage.screenshot({ path: `${shots}/16-mini-expandida.png` });
  await miniPage.getByRole('button', { name: 'Recolher' }).click();
  await expect.poll(async () => (await bounds()).height).toBeLessThanOrEqual(40);

  // O hook global fica armado com a tecla escolhida (V)...
  const armed = () => app.evaluate(() => (globalThis as any).discordiaPtt());
  await expect.poll(armed).toEqual({ key: UiohookKey.V, running: true });
  // ...e o que ele manda chega à página pela ponte. Não simulamos a tecla no sistema:
  // num ambiente com tela de verdade isso digitaria na janela em foco de quem roda os testes.
  for (const value of [true, false]) {
    await app.evaluate(({ BrowserWindow }, v) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('app://'))!.webContents.send('ptt', v), value);
    await expect.poll(held).toBe(value);
  }

  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('app://'))!;
    main.show();
    main.focus();
  });
  await page.getByRole('button', { name: 'Sair do canal de voz' }).first().click();
  await expect.poll(async () => (await windows()).find((w) => w.url.endsWith('mini.html'))?.visible ?? false).toBe(false);
  // O host precisa encerrar a sala antes, senão o app pergunta antes de fechar.
  await page.locator('main header').getByRole('button', { name: 'Encerrar sala' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Encerrar sala' }).click();
});
