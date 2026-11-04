// Copia a CSP de vercel.json para o app, para os dois nunca divergirem,
// e guarda o endereço do site (VITE_PUBLIC_URL), que o YouTube recebe como Referer.
import { readFileSync, writeFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const csp = vercel.headers[0].headers.find((h) => h.key === 'Content-Security-Policy').value;
writeFileSync('desktop/dist/csp.json', JSON.stringify(csp));
writeFileSync('desktop/dist/site.json', JSON.stringify(process.env.VITE_PUBLIC_URL ?? null));
