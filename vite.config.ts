import { readFileSync } from 'node:fs';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// `vite preview` usa os mesmos cabeçalhos da Vercel, para a CSP ser testada antes do deploy.
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const headers = Object.fromEntries(vercel.headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]));

// Só o preview local fala com o Worker em HTTP; produção segue exigindo https/wss.
headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(
  'connect-src',
  'connect-src http://localhost:8787 ws://localhost:8787',
);

if (process.env.VERCEL && !process.env.VITE_SIGNAL_URL) {
  throw new Error('Defina VITE_SIGNAL_URL com o endereço do Worker de sinalização.');
}

export default defineConfig({
  plugins: [svelte()],
  build: { target: 'es2022' },
  server: {
    // Em dev a sinalização sai pela mesma origem: assim um único túnel HTTPS serve para tudo.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/ice': 'http://localhost:8787',
      '/ws': { target: 'http://localhost:8787', ws: true },
    },
  },
  preview: { headers },
  test: { include: ['tests/**/*.test.ts'] },
});
