// Nenhum site lê a porcentagem de CPU do computador; o navegador informa só um estado de pressão.
export type Pressure = 'nominal' | 'fair' | 'serious' | 'critical';

export function watchPressure(update: (state: Pressure) => void) {
  const Observer = (window as any).PressureObserver;
  if (!Observer) return () => {};
  const observer = new Observer((records: { state: Pressure }[]) => update(records[records.length - 1].state));
  observer.observe('cpu', { sampleInterval: 2000 }).catch(() => {});
  return () => observer.disconnect();
}

/** Memória do JavaScript desta aba. Só existe em navegadores Chromium. */
export function jsHeap() {
  const memory = (performance as any).memory;
  return memory ? { used: memory.usedJSHeapSize as number, limit: memory.jsHeapSizeLimit as number } : null;
}
