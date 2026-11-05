// Pede um relay de verdade a cada TURN que o Worker entrega ao site, sem mostrar credenciais.
// Uso: node scripts/turn-check.mjs
import { chromium } from 'playwright';
const res = await fetch('https://discordia-signal.discordia-call.workers.dev/ice', { headers: { Origin: 'https://discordia-six.vercel.app' } });
const { iceServers } = await res.json();
const browser = await chromium.launch();
const page = await browser.newPage();
const results = await page.evaluate(async (servers) => {
  const out = [];
  for (const srv of servers) {
    const urls = Array.isArray(srv.urls) ? srv.urls : [srv.urls];
    for (const url of urls) {
      if (!url.startsWith('turn')) continue;
      const pc = new RTCPeerConnection({ iceServers: [{ ...srv, urls: url }], iceTransportPolicy: 'relay' });
      const t0 = performance.now();
      const found = [];
      const errors = [];
      pc.onicecandidateerror = (e) => errors.push(`${e.errorCode} ${e.errorText}`);
      pc.createDataChannel('x');
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((r) => {
        const done = setTimeout(r, 8000);
        pc.onicecandidate = (e) => {
          if (e.candidate?.type === 'relay') found.push(`${e.candidate.address} (${Math.round(performance.now() - t0)} ms)`);
          if (!e.candidate) { clearTimeout(done); r(); }
        };
      });
      pc.close();
      out.push({ url: url.split('?')[0] + (url.includes('tcp') ? ' tcp' : ''), relay: found[0] ?? null, errors: [...new Set(errors)] });
    }
  }
  return out;
}, iceServers);
for (const r of results) console.log(`${r.url.padEnd(46)} ${r.relay ? 'OK, relay ' + r.relay : 'FALHOU ' + r.errors.join('; ')}`);
await browser.close();
