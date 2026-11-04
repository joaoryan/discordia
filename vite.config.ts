import { readFileSync } from 'node:fs';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { Plugin } from 'vite';
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

// Endereço público do site: o definido à mão ou o domínio de produção que a Vercel informa no build.
const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const SITE = (process.env.VITE_PUBLIC_URL || (vercelDomain ? `https://${vercelDomain}` : '')).replace(/\/$/, '');
const DESCRIPTION = 'Crie uma sala e chame os amigos pelo link: voz com cancelamento de ruído, vídeo, compartilhamento de tela, chat e rádio. Grátis, sem conta e sem servidor.';

/** Busca e compartilhamento: endereços absolutos, dados estruturados, robots.txt e sitemap.xml. */
function seo(): Plugin {
  return {
    name: 'discordia-seo',
    transformIndexHtml(html) {
      const tags: string[] = [];
      if (SITE) {
        const data = {
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebSite', name: 'Discordia', alternateName: ['Discórdia', 'Discordia app'], url: `${SITE}/`, inLanguage: 'pt-BR' },
            {
              '@type': 'WebApplication',
              name: 'Discordia',
              url: `${SITE}/`,
              description: DESCRIPTION,
              image: `${SITE}/og.png`,
              applicationCategory: 'CommunicationApplication',
              operatingSystem: 'Web, Windows, macOS, Linux',
              inLanguage: 'pt-BR',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' },
            },
          ],
        };
        tags.push(
          `<link rel="canonical" href="${SITE}/" />`,
          `<meta property="og:url" content="${SITE}/" />`,
          `<meta property="og:image" content="${SITE}/og.png" />`,
          `<meta name="twitter:image" content="${SITE}/og.png" />`,
          // Bloco de dados, não script executável: a CSP não o bloqueia.
          `<script type="application/ld+json">${JSON.stringify(data)}</script>`,
        );
      }
      const verification = process.env.VITE_GOOGLE_SITE_VERIFICATION;
      if (verification) tags.push(`<meta name="google-site-verification" content="${verification.replace(/"/g, '')}" />`);
      return html.replace(/ *<!-- seo:[^>]*-->/, tags.map((tag) => `    ${tag}`).join('\n'));
    },
    generateBundle() {
      const robots = ['User-agent: *', 'Allow: /', ...(SITE ? [`Sitemap: ${SITE}/sitemap.xml`] : [])].join('\n');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots}\n` });
      if (!SITE) return;
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [svelte(), seo()],
  build: {
    target: 'es2022',
    // A CSP não aceita worklets em data:, então eles nunca são embutidos.
    assetsInlineLimit: (file) => (file.endsWith('.worklet.js') ? false : undefined),
  },
  server: {
    // Em dev a sinalização sai pela mesma origem: assim um único túnel HTTPS serve para tudo.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/ice': 'http://localhost:8787',
      '/ws': { target: 'http://localhost:8787', ws: true },
      '/inbox': { target: 'http://localhost:8787', ws: true },
    },
  },
  preview: { headers },
  test: { include: ['tests/**/*.test.ts'] },
});
