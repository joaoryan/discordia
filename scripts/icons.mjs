// Gera os ícones (site e app) e a imagem de compartilhamento a partir de public/logo.svg.
// Rode depois de mudar a logo: node scripts/icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/logo.svg', 'utf8');
const browser = await chromium.launch();

async function shot(width, height, html, path) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({ path, omitBackground: true });
  await page.close();
}

const icon = (size) => `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`;
for (const [size, path] of [[192, 'public/icon-192.png'], [512, 'public/icon-512.png'], [512, 'desktop/build/icon.png'], [32, 'desktop/build/tray.png']]) {
  await shot(size, size, icon(size), path);
}

// Cartão que aparece ao compartilhar o link (WhatsApp, Discord, X, buscadores).
await shot(
  1200,
  630,
  `<style>
    html,body{margin:0;width:1200px;height:630px;font-family:'Inter','Segoe UI',system-ui,sans-serif}
    body{display:flex;align-items:center;gap:64px;padding:0 96px;box-sizing:border-box;color:#f2eff8;
      background:radial-gradient(700px 420px at 12% 10%,rgb(247 178 59 / 22%),transparent 70%),radial-gradient(640px 420px at 100% 100%,rgb(143 115 242 / 26%),transparent 70%),#0f0d16}
    svg{flex:none;width:260px;height:260px;filter:drop-shadow(0 20px 50px rgb(0 0 0 / 45%))}
    h1{margin:0;font-size:96px;font-weight:800;letter-spacing:-0.04em}
    p{margin:14px 0 0;font-size:38px;line-height:1.2;color:#cfc8e0}
    small{display:block;margin-top:28px;font-size:26px;color:#f7b23b;font-weight:700}
  </style>${svg}<div><h1>Discordia</h1><p>Salas de voz, vídeo e chat<br>entre amigos, direto pelo link.</p><small>Grátis · sem conta · sem servidor</small></div>`,
  'public/og.png',
);

await browser.close();
console.log('ícones e public/og.png gerados');
