// Sem I, L, O, 0 e 1: o código costuma ser ditado ou digitado à mão.
export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 6;

export function generateCode() {
  let code = '';
  while (code.length < LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(LENGTH * 2))) {
      // Rejeita o resto para não favorecer os primeiros símbolos.
      if (byte < 248 && code.length < LENGTH) code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
}

export const formatCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

export function normalizeCode(input: string) {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== LENGTH) return null;
  return [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}
