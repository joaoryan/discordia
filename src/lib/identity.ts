// Identidade de amigo: um par de chaves ECDH P-256 gerado e guardado só neste navegador.
// A chave pública vai junto do perfil nas salas; quem a tem consegue mandar mensagens cifradas
// que só este navegador abre. O Worker entrega envelopes que não consegue ler.

export interface Identity {
  /** Chave pública (ponto P-256 sem compressão), em base64url: 87 caracteres. */
  pub: string;
  /** Endereço da caixa de entrada: hash da chave pública, 22 caracteres. */
  address: string;
  /** Segredo que prova ao Worker que a caixa de entrada é sua. */
  inboxKey: string;
  privateJwk: JsonWebKey;
}

/** O que vai cifrado: o Worker vê só `from`, `pub`, `iv` e `data`. */
export interface Envelope {
  from: string;
  pub: string;
  iv: string;
  data: string;
}

export const PUB_KEY = /^[A-Za-z0-9_-]{87}$/;
export const ADDRESS = /^[A-Za-z0-9_-]{22}$/;
const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;
const INFO = new TextEncoder().encode('discordia-dm-v1');

export function toB64u(bytes: ArrayBuffer | Uint8Array) {
  let text = '';
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(text: string) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function addressOf(pub: string) {
  return toB64u(await crypto.subtle.digest('SHA-256', fromB64u(pub))).slice(0, 22);
}

export async function createIdentity(): Promise<Identity> {
  const pair = (await crypto.subtle.generateKey(CURVE, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = toB64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    pub,
    address: await addressOf(pub),
    inboxKey: toB64u(crypto.getRandomValues(new Uint8Array(32))),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
}

const keys = new Map<string, Promise<CryptoKey>>();

/** Chave AES do par (eu, outro): ECDH seguido de HKDF. Fica em cache por par. */
function pairKey(me: Identity, otherPub: string) {
  const cacheKey = `${me.address}:${otherPub}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = (async () => {
      const mine = await crypto.subtle.importKey('jwk', me.privateJwk, CURVE, false, ['deriveBits']);
      const theirs = await crypto.subtle.importKey('raw', fromB64u(otherPub), CURVE, false, []);
      const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, mine, 256);
      const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    })();
    keys.set(cacheKey, key);
  }
  return key;
}

export async function seal(me: Identity, recipientPub: string, payload: unknown): Promise<Omit<Envelope, 'from'>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pairKey(me, recipientPub), new TextEncoder().encode(JSON.stringify(payload)));
  return { pub: me.pub, iv: toB64u(iv), data: toB64u(data) };
}

/**
 * Abre um envelope. `from` é carimbado pelo Worker a partir da caixa autenticada de quem enviou;
 * conferir que a chave pública bate com esse endereço impede alguém de se passar por outro.
 */
export async function unseal<T>(me: Identity, envelope: Envelope): Promise<T | null> {
  try {
    if (!PUB_KEY.test(envelope.pub) || (await addressOf(envelope.pub)) !== envelope.from) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(envelope.iv) }, await pairKey(me, envelope.pub), fromB64u(envelope.data));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
