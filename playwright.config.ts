import { defineConfig } from '@playwright/test';

const FAKE_MEDIA = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--auto-select-desktop-capture-source=Entire screen',
  '--autoplay-policy=no-user-gesture-required',
  // Salas de teste na mesma máquina, sem depender de mDNS.
  '--disable-features=WebRtcHideLocalIpsWithMdns',
];

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1280, height: 760 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: /6-producao/, use: { launchOptions: { args: FAKE_MEDIA } } },
    { name: 'producao', testMatch: /6-producao/, use: { baseURL: 'http://localhost:4173', launchOptions: { args: FAKE_MEDIA } } },
  ],
  webServer: [
    {
      command: 'npx wrangler dev --config worker/wrangler.toml --port 8787 --var RATE_LIMIT_PER_MIN:1000 --var ALLOWED_ORIGINS:*',
      url: 'http://localhost:8787/ice',
      reuseExistingServer: true,
      env: { WRANGLER_SEND_METRICS: 'false' },
    },
    { command: 'npx vite --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true },
    {
      command: 'npx vite build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      env: { VITE_SIGNAL_URL: 'http://localhost:8787' },
    },
  ],
});
