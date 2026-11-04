// Ações reutilizáveis dos componentes.

/** Preenche o trilho do slider até o valor atual (o Chromium não tem pseudo-elemento para isso). */
export function rangeFill(node: HTMLInputElement, _value?: number) {
  const set = () => {
    const min = Number(node.min || 0);
    const max = Number(node.max || 100);
    const pct = max > min ? ((Number(node.value) - min) / (max - min)) * 100 : 0;
    node.style.setProperty('--fill', `${pct}%`);
  };
  set();
  node.addEventListener('input', set);
  return {
    update: set,
    destroy: () => node.removeEventListener('input', set),
  };
}
