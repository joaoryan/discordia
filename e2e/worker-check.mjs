import { request } from 'node:http';

// Verificação do Worker: rode com um `wrangler dev` em :8788 com ALLOWED_ORIGINS e limite baixo.
const port = process.env.PORT ?? 8788;
const base = `ws://localhost:${port}/ws`;
const origin = 'http://permitido.test';
const key = 'k'.repeat(40);
const open = (path, headers = { Origin: origin }) =>
  new Promise((resolve) => {
    const ws = new WebSocket(`${base}/${path}`, { headers });
    const seen = [];
    ws.onmessage = (e) => seen.push(JSON.parse(e.data));
    ws.onerror = () => resolve({ ws, seen, failed: true });
    ws.onopen = () => setTimeout(() => resolve({ ws, seen }), 200);
  });
const http = (path, headers) =>
  new Promise((resolve, reject) => {
    const req = request(`http://localhost:${port}${path}`, {
      timeout: 3000,
      headers: headers.Upgrade
        ? { ...headers, Connection: 'Upgrade', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' }
        : headers,
    });
    req.on('response', (r) => { r.resume(); resolve(r.statusCode); });
    req.on('upgrade', (r, socket) => { socket.destroy(); resolve(r.statusCode); });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
const log = (label, value) => console.log(label.padEnd(44), JSON.stringify(value));

log('/ice origem permitida', await http('/ice', { Origin: origin }));
log('/ice origem proibida', await http('/ice', { Origin: 'http://mal.test' }));
log('/ice sem origem', await http('/ice', {}));
log('ws código malformado', await http('/ws/abc', { Origin: origin, Upgrade: 'websocket' }));

const host = await open(`QQQ222?role=host&key=${key}`);
log('host cria', host.seen);
const thief = await open(`QQQ222?role=host&key=${'x'.repeat(40)}`);
log('outra chave tenta tomar a sala', thief.seen);
const guest = await open('QQQ222?role=guest');
log('convidado entra', guest.seen);
log('host é avisado', host.seen.at(-1));
guest.ws.send(JSON.stringify({ t: 'signal', to: 'qualquer', data: 1 }));
guest.ws.send(JSON.stringify({ t: 'close-room' }));
await new Promise((r) => setTimeout(r, 200));
log('convidado não fecha a sala; host recebe só o sinal', host.seen.at(-1));

host.ws.close();
await new Promise((r) => setTimeout(r, 300));
const during = await open('QQQ222?role=guest');
log('durante a carência do host', during.seen);
const back = await open(`QQQ222?role=host&key=${key}`);
log('host reconecta com a chave', back.seen);
back.ws.send(JSON.stringify({ t: 'close-room' }));
await new Promise((r) => setTimeout(r, 200));
log('código após encerrar', (await open('QQQ222?role=guest')).seen);

let blocked = 0;
for (let i = 0; i < 12; i++) {
  if ((await http('/ws/ZZZ222', { Origin: origin, Upgrade: 'websocket' })) === 429) blocked++;
}
log('varredura: bloqueadas de 12 tentativas', blocked);
process.exit(0);
