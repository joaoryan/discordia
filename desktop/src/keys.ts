// Converte a tecla salva pelo site (`KeyboardEvent.code`) no nome que o uiohook usa.
// Sem dependências: é testado direto pelo vitest.

const NAMED: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
  CapsLock: 'CapsLock',
  Backquote: 'Backquote',
  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  ControlLeft: 'Ctrl',
  ControlRight: 'CtrlRight',
  AltLeft: 'Alt',
  AltRight: 'AltRight',
  ShiftLeft: 'Shift',
  ShiftRight: 'ShiftRight',
  MetaLeft: 'Meta',
  MetaRight: 'MetaRight',
  NumpadAdd: 'NumpadAdd',
  NumpadSubtract: 'NumpadSubtract',
  NumpadMultiply: 'NumpadMultiply',
  NumpadDivide: 'NumpadDivide',
  NumpadDecimal: 'NumpadDecimal',
  NumpadEnter: 'NumpadEnter',
  ScrollLock: 'ScrollLock',
  PrintScreen: 'PrintScreen',
};

export function keyName(code: string): string | null {
  const letter = code.match(/^Key([A-Z])$/);
  if (letter) return letter[1];
  const digit = code.match(/^(Digit|Numpad)(\d)$/);
  if (digit) return digit[1] === 'Digit' ? digit[2] : `Numpad${digit[2]}`;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return NAMED[code] ?? null;
}

/** Extrai o código de um link `discordia://AB7-K2Q` (ou `discordia://join/AB7-K2Q`). */
export function codeFromArgs(args: string[]): string | null {
  for (const arg of args) {
    const match = arg.match(/^discordia:\/\/(?:join\/)?([A-Za-z0-9]{3}-?[A-Za-z0-9]{3})\/?$/i);
    if (match) return match[1].toUpperCase().replace('-', '');
  }
  return null;
}
