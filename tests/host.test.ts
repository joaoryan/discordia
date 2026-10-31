import { beforeEach, describe, expect, it } from 'vitest';
import { RoomHost } from '../src/lib/host';
import { LIMITS, emptyVoice, type HostMsg, type VoiceState } from '../src/lib/protocol';

const profile = (name: string) => ({ name, avatar: '', color: '#123456' });

function setup() {
  const sent: { to: string; msg: HostMsg }[] = [];
  const dropped: string[] = [];
  let clock = 1000;
  const host = new RoomHost({
    code: 'ABCDEF',
    name: 'Sala',
    hostId: 'h',
    send: (to, msg) => sent.push({ to, msg }),
    drop: (id) => dropped.push(id),
    now: () => clock,
  });
  host.admit('h', profile('Host'), 'c-h');
  host.admit('a', profile('Ana'), 'c-a');
  host.admit('b', profile('Bia'), 'c-b');
  sent.length = 0;
  const to = (id: string, t: HostMsg['t']) => sent.filter((s) => s.to === id && s.msg.t === t);
  return { host, sent, dropped, to, tick: (ms: number) => (clock += ms) };
}

const voice = (channel: string | null, extra: Partial<VoiceState> = {}) => ({ ...emptyVoice(), channel, ...extra });

describe('RoomHost', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => (t = setup()));

  it('carimba o autor: ninguém fala em nome de outro', () => {
    t.host.handle('a', { t: 'chat', channel: 'geral', text: 'oi', author: 'b', authorName: 'Bia' } as any);
    const msg = t.to('b', 'chat')[0].msg as Extract<HostMsg, { t: 'chat' }>;
    expect(msg.message.author).toBe('a');
    expect(msg.message.authorName).toBe('Ana');
  });

  it('mantém a mensagem como texto puro e aplica limite de tamanho', () => {
    t.host.handle('a', { t: 'chat', channel: 'geral', text: 'x'.repeat(5000) });
    const msg = t.to('b', 'chat')[0].msg as Extract<HostMsg, { t: 'chat' }>;
    expect(msg.message.text).toHaveLength(LIMITS.text);
  });

  it('entrega o histórico da sessão para quem chega depois', () => {
    t.host.handle('a', { t: 'chat', channel: 'geral', text: 'primeira' });
    t.host.admit('c', profile('Caio'), 'c-c');
    const welcome = t.to('c', 'welcome')[0].msg as Extract<HostMsg, { t: 'welcome' }>;
    expect(welcome.room.history.some((m) => m.text === 'primeira')).toBe(true);
  });

  it('só o host modera', () => {
    t.host.handle('a', { t: 'mod', mod: { action: 'kick', id: 'b' } });
    expect(t.host.members.has('b')).toBe(true);
    t.host.handle('h', { t: 'mod', mod: { action: 'kick', id: 'b' } });
    expect(t.host.members.has('b')).toBe(false);
    expect(t.dropped).toContain('b');
  });

  it('banido não volta, mesmo com nova conexão', () => {
    t.host.handle('h', { t: 'mod', mod: { action: 'ban', id: 'a' } });
    t.host.admit('a2', profile('Ana'), 'c-a');
    expect(t.host.members.has('a2')).toBe(false);
    expect(t.to('a2', 'refused')).toHaveLength(1);
  });

  it('host desconecta da voz sem tirar da sala; outros não podem', () => {
    t.host.handle('a', { t: 'voice', state: voice('saguao') });
    t.host.handle('b', { t: 'mod', mod: { action: 'disconnect', id: 'a' } });
    expect(t.host.members.get('a')!.voice.channel).toBe('saguao');
    t.host.handle('h', { t: 'mod', mod: { action: 'disconnect', id: 'a' } });
    expect(t.host.members.get('a')!.voice.channel).toBeNull();
    expect(t.host.members.has('a')).toBe(true);
  });

  describe('rádio', () => {
    const song = (n: number) => ({ videoId: `abcdefghij${n}`, title: `Música ${n}` });
    const radio = (from: string, cmd: any) => t.host.handle(from, { t: 'radio', radio: cmd });
    beforeEach(() => {
      for (const id of ['h', 'a', 'b']) t.host.handle(id, { t: 'voice', state: voice('saguao') });
      radio('a', { cmd: 'start', mode: 'youtube' });
      radio('a', { cmd: 'add', tracks: [song(1), song(2), song(3)] });
    });

    it('fila começa a tocar e recusa link inválido', () => {
      expect(t.host.radio!.current!.title).toBe('Música 1');
      radio('a', { cmd: 'add', tracks: [{ videoId: '"><script>', title: 'x' }] });
      expect(t.host.radio!.queue).toHaveLength(2);
    });

    it('quem está fora do canal não mexe no rádio', () => {
      t.host.admit('c', profile('Caio'), 'c-c');
      radio('c', { cmd: 'skip' });
      radio('c', { cmd: 'add', tracks: [song(4)] });
      expect(t.host.radio!.skipVotes).toEqual([]);
      expect(t.host.radio!.queue).toHaveLength(2);
    });

    it('pular exige maioria e o voto pode ser retirado', () => {
      radio('b', { cmd: 'skip' });
      radio('b', { cmd: 'skip' });
      radio('b', { cmd: 'skip' });
      expect(t.host.radio!.current!.title).toBe('Música 1');
      radio('h', { cmd: 'skip' });
      expect(t.host.radio!.current!.title).toBe('Música 2');
      expect(t.host.radio!.skipVotes).toEqual([]);
    });

    it('música mais votada passa na frente', () => {
      radio('b', { cmd: 'vote', id: t.host.radio!.queue[1].id });
      radio('a', { cmd: 'force-skip' });
      expect(t.host.radio!.current!.title).toBe('Música 3');
    });

    it('vários avisos de fim avançam uma faixa só', () => {
      const id = t.host.radio!.current!.id;
      radio('a', { cmd: 'ended', id });
      radio('b', { cmd: 'ended', id });
      radio('h', { cmd: 'ended', id });
      expect(t.host.radio!.current!.title).toBe('Música 2');
    });

    it('só DJ e host controlam pausa e parada', () => {
      radio('b', { cmd: 'pause', paused: true });
      expect(t.host.radio!.paused).toBe(false);
      radio('b', { cmd: 'stop' });
      expect(t.host.radio).not.toBeNull();
      radio('a', { cmd: 'pause', paused: true });
      t.tick(5000);
      expect(t.host.radioView()!.position).toBe(0);
      radio('h', { cmd: 'stop' });
      expect(t.host.radio).toBeNull();
    });

    it('posição continua de onde pausou', () => {
      t.tick(10_000);
      radio('a', { cmd: 'pause', paused: true });
      t.tick(60_000);
      radio('a', { cmd: 'pause', paused: false });
      t.tick(1000);
      expect(t.host.radioView()!.position).toBe(11);
    });

    it('DJ sai: passa para o host; canal vazio: rádio acaba', () => {
      t.host.handle('a', { t: 'voice', state: voice(null) });
      expect(t.host.radio!.dj).toBe('h');
      t.host.handle('h', { t: 'voice', state: voice(null) });
      t.host.handle('b', { t: 'voice', state: voice(null) });
      expect(t.host.radio).toBeNull();
    });

    it('quem saiu perde o voto e a maioria é recalculada', () => {
      radio('b', { cmd: 'skip' });
      t.host.handle('h', { t: 'voice', state: voice(null) });
      expect(t.host.radio!.current!.title).toBe('Música 1');
      radio('a', { cmd: 'skip' });
      expect(t.host.radio!.current!.title).toBe('Música 2');
    });

    it('rádio de aba acaba quando a DJ sai', () => {
      radio('h', { cmd: 'stop' });
      radio('a', { cmd: 'start', mode: 'tab', title: 'Som' });
      expect(t.host.radio!.current!.title).toBe('Som');
      t.host.handle('a', { t: 'voice', state: voice(null) });
      expect(t.host.radio).toBeNull();
    });

    it('novo participante recebe o rádio em andamento', () => {
      t.host.admit('c', profile('Caio'), 'c-c');
      const welcome = t.to('c', 'welcome')[0].msg as Extract<HostMsg, { t: 'welcome' }>;
      expect(welcome.room.radio!.current!.title).toBe('Música 1');
    });
  });

  it('só o autor edita; autor e host apagam', () => {
    t.host.handle('a', { t: 'chat', channel: 'geral', text: 'oi' });
    const id = t.host.history.get('geral')!.at(-1)!.id;
    t.host.handle('b', { t: 'edit', channel: 'geral', message: id, text: 'hackeado' });
    t.host.handle('h', { t: 'edit', channel: 'geral', message: id, text: 'host' });
    expect(t.host.history.get('geral')!.at(-1)!.text).toBe('oi');
    t.host.handle('a', { t: 'edit', channel: 'geral', message: id, text: 'olá' });
    expect(t.host.history.get('geral')!.at(-1)).toMatchObject({ text: 'olá', edited: true });
    t.host.handle('b', { t: 'delete', channel: 'geral', message: id });
    expect(t.host.history.get('geral')!.some((m) => m.id === id)).toBe(true);
    t.host.handle('h', { t: 'delete', channel: 'geral', message: id });
    expect(t.host.history.get('geral')!.some((m) => m.id === id)).toBe(false);
  });

  describe('F5 do host', () => {
    const restore = (saved: ReturnType<RoomHost['snapshot']>) => {
      const sent: { to: string; msg: HostMsg }[] = [];
      const host = new RoomHost({ code: 'ABCDEF', name: 'Sala', hostId: 'h', send: (to, msg) => sent.push({ to, msg }), drop: () => {}, saved, now: () => 5000 });
      host.admit('h', profile('Host'), 'c-h');
      return { host, sent };
    };

    it('histórico, canais, tranca e banimento continuam', () => {
      t.host.handle('a', { t: 'chat', channel: 'geral', text: 'antes do F5' });
      t.host.handle('h', { t: 'mod', mod: { action: 'add-channel', kind: 'text', name: 'novo' } });
      t.host.handle('h', { t: 'mod', mod: { action: 'ban', id: 'b' } });
      t.host.handle('h', { t: 'mod', mod: { action: 'lock', locked: true } });
      const { host, sent } = restore(t.host.snapshot());
      expect(host.history.get('geral')!.some((m) => m.text === 'antes do F5')).toBe(true);
      expect(host.channels.some((c) => c.name === 'novo')).toBe(true);
      host.admit('b', profile('Bia'), 'c-b');
      expect(host.members.has('b')).toBe(false);
      host.admit('z', profile('Zé'), 'c-z');
      expect(host.members.has('z')).toBe(false);
      host.admit('a', profile('Ana'), 'c-a'); // já era da sala: entra mesmo trancada
      expect(host.members.has('a')).toBe(true);
      expect(sent.filter((s) => s.msg.t === 'chat')).toHaveLength(0); // sem "entrou na sala" de novo
    });

    it('rádio sobrevive enquanto os membros voltam e reavalia ao fim da carência', () => {
      for (const id of ['a', 'b']) t.host.handle(id, { t: 'voice', state: voice('saguao') });
      t.host.handle('a', { t: 'radio', radio: { cmd: 'start', mode: 'youtube' } });
      t.host.handle('a', { t: 'radio', radio: { cmd: 'add', tracks: [{ videoId: 'abcdefghij1', title: 'Música' }] } });
      const { host } = restore(t.host.snapshot());
      host.handle('h', { t: 'voice', state: voice(null) });
      expect(host.radio?.current?.title).toBe('Música');
      host.endGrace();
      expect(host.radio).toBeNull(); // ninguém voltou ao canal
    });

    it('expulso não aproveita a passagem de quem já era da sala', () => {
      t.host.handle('h', { t: 'mod', mod: { action: 'kick', id: 'a' } });
      t.host.handle('h', { t: 'mod', mod: { action: 'lock', locked: true } });
      t.host.admit('a2', profile('Ana'), 'c-a');
      expect(t.host.members.has('a2')).toBe(false);
    });

    it('duas abas do mesmo navegador são pessoas diferentes', () => {
      t.host.admit('x', profile('Aba 1'), 'pc', 'aba-1');
      t.host.admit('y', profile('Aba 2'), 'pc', 'aba-2');
      expect(t.host.members.has('x') && t.host.members.has('y')).toBe(true);
      t.host.admit('z', profile('Aba 1'), 'pc', 'aba-1'); // a mesma aba reconectando
      expect(t.host.members.has('x')).toBe(false);
    });

    it('um id só é retomado pelo cliente dono dele', () => {
      expect(t.host.ownsId('a', 'c-a')).toBe(true);
      expect(t.host.ownsId('a', 'invasor')).toBe(false);
      expect(t.host.ownsId('novo', 'qualquer')).toBe(true);
    });
  });

  it('sala trancada recusa novos membros', () => {
    t.host.handle('h', { t: 'mod', mod: { action: 'lock', locked: true } });
    t.host.admit('c', profile('Caio'), 'c-c');
    expect(t.host.members.has('c')).toBe(false);
  });

  it('respeita o limite da sala', () => {
    for (let i = 0; i < LIMITS.members + 5; i++) t.host.admit(`m${i}`, profile(`M${i}`), `c${i}`);
    expect(t.host.members.size).toBe(LIMITS.members);
  });

  it('reconexão do mesmo cliente substitui a conexão antiga', () => {
    t.host.admit('a2', profile('Ana'), 'c-a');
    expect(t.host.members.has('a')).toBe(false);
    expect(t.host.members.has('a2')).toBe(true);
  });

  it('limita rajadas de mensagens e recupera com o tempo', () => {
    for (let i = 0; i < 20; i++) t.host.handle('a', { t: 'chat', channel: 'geral', text: `${i}` });
    const chats = t.host.history.get('geral')!.filter((m) => !m.system);
    expect(chats).toHaveLength(10);
    t.tick(3000);
    t.host.handle('a', { t: 'chat', channel: 'geral', text: 'depois' });
    expect(t.host.history.get('geral')!.at(-1)!.text).toBe('depois');
  });

  it('reação alterna e usa o usuário real', () => {
    t.host.handle('a', { t: 'chat', channel: 'geral', text: 'oi' });
    const id = t.host.history.get('geral')!.at(-1)!.id;
    t.host.handle('b', { t: 'react', channel: 'geral', message: id, emoji: '👍' });
    expect(t.host.history.get('geral')!.at(-1)!.reactions['👍']).toEqual(['b']);
    t.host.handle('b', { t: 'react', channel: 'geral', message: id, emoji: '👍' });
    expect(t.host.history.get('geral')!.at(-1)!.reactions['👍']).toBeUndefined();
  });

  it('só repassa sinalização de mídia dentro do mesmo canal de voz', () => {
    t.host.handle('a', { t: 'rtc', to: 'b', data: 1 });
    expect(t.to('b', 'rtc')).toHaveLength(0);
    t.host.handle('a', { t: 'voice', state: voice('saguao') });
    t.host.handle('b', { t: 'voice', state: voice('saguao') });
    t.host.handle('a', { t: 'rtc', to: 'b', data: 1 });
    expect(t.to('b', 'rtc')).toHaveLength(1);
  });

  it('respeita a lotação do canal de voz', () => {
    for (let i = 0; i < LIMITS.voice; i++) {
      t.host.admit(`m${i}`, profile(`M${i}`), `c${i}`);
      t.host.handle(`m${i}`, { t: 'voice', state: voice('saguao') });
    }
    t.host.handle('a', { t: 'voice', state: voice('saguao') });
    expect(t.host.members.get('a')!.voice.channel).toBeNull();
  });

  it('recusa avatar e cor que não sejam imagem válida', () => {
    t.host.admit('c', { name: 'Caio', avatar: 'javascript:alert(1)', color: 'url(x)' }, 'c-c');
    const member = t.host.members.get('c')!;
    expect(member.avatar).toBe('');
    expect(member.color).toBe('#e8a33d');
    t.host.admit('d', { name: 'Davi', avatar: 'data:image/svg+xml;base64,AAAA', color: '#000000' }, 'c-d');
    expect(t.host.members.get('d')!.avatar).toBe('');
  });

  it('neutraliza anexo que tenta se passar por imagem exibível', () => {
    t.host.handle('a', {
      t: 'chat',
      channel: 'geral',
      text: '',
      attachment: { name: 'x.svg', type: 'image/svg+xml', size: 10, data: 'data:image/svg+xml;base64,AAAA' },
    });
    const attachment = t.host.history.get('geral')!.at(-1)!.attachment!;
    expect(attachment.type).toBe('application/octet-stream');
    expect(attachment.data!.startsWith('data:application/octet-stream')).toBe(true);
  });

  it('preserva o tipo de imagens legítimas', () => {
    t.host.handle('a', {
      t: 'chat',
      channel: 'geral',
      text: '',
      attachment: { name: 'x.png', type: 'image/png', size: 4, data: 'data:image/png;base64,AAAA' },
    });
    const attachment = t.host.history.get('geral')!.at(-1)!.attachment!;
    expect(attachment.type).toBe('image/png');
    expect(attachment.data).toBe('data:image/png;base64,AAAA');
  });

  it('expira anexos antigos quando passa do orçamento de memória', () => {
    const data = 'data:image/png;base64,' + 'A'.repeat(LIMITS.file);
    for (let i = 0; i < 20; i++) {
      t.tick(2000);
      t.host.handle('a', {
        t: 'chat',
        channel: 'geral',
        text: `${i}`,
        attachment: { name: 'a.png', type: 'image/png', size: LIMITS.file, data },
      });
    }
    const stored = t.host.history.get('geral')!.filter((m) => m.attachment);
    expect(stored[0].attachment!.data).toBeNull();
    expect(stored.at(-1)!.attachment!.data).not.toBeNull();
  });
});
