// Chamada de teste entre aparelhos: sobe sinalização, app e um túnel HTTPS temporário.
// Câmera e microfone exigem HTTPS fora do localhost. Ctrl+C encerra tudo.
import { spawn } from 'node:child_process';

const children = [];
function run(args, env = {}) {
  const child = spawn('npx', args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  return child;
}

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log('Iniciando sinalização, app e túnel...');
run(['wrangler', 'dev', '--config', 'worker/wrangler.toml', '--port', '8787', '--var', 'RATE_LIMIT_PER_MIN:300'], {
  WRANGLER_SEND_METRICS: 'false',
});
run(['vite', '--port', '5173', '--strictPort']);

const tunnel = run(['-y', 'cloudflared', 'tunnel', '--no-autoupdate', '--url', 'http://localhost:5173']);
let shown = false;
tunnel.stderr.on('data', (chunk) => {
  const url = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (!url || shown) return;
  shown = true;
  console.log(`\nAbra nos dois aparelhos:\n\n  ${url}\n\nCtrl+C encerra a sala e o link.\n`);
});
tunnel.on('exit', (code) => {
  if (!shown) console.error(`O túnel não abriu (código ${code}). Verifique a internet e tente de novo.`);
  stop();
});
