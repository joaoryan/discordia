// Temas são só variáveis CSS: trocar não custa nada em tempo de execução.
export type ThemeId = 'discordia' | 'miami' | 'tactical' | 'fantasy';

export const THEMES: { id: ThemeId; name: string; mood: string; colors: [string, string, string] }[] = [
  { id: 'discordia', name: 'Discordia', mood: 'Dourado e violeta', colors: ['#17171f', '#f7b23b', '#8f73f2'] },
  { id: 'miami', name: 'Miami Neon', mood: 'Pôr do sol, rosa e ciano', colors: ['#1c0f2b', '#ff4fa3', '#2ce0e6'] },
  { id: 'tactical', name: 'Operação Tática', mood: 'Verde militar e laranja', colors: ['#141914', '#f2711c', '#8aa35f'] },
  { id: 'fantasy', name: 'Reino Épico', mood: 'Azul arcano e ouro', colors: ['#111a30', '#e8c15a', '#4da8ff'] },
];

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES.find((t) => t.id === theme)!.colors[0]);
}
