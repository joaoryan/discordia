<script lang="ts">
  import type { ThemeId } from '../lib/theme';

  // Desenhos próprios: lembram o clima de cada tema sem usar logo ou marca de jogo nenhum.
  const PATHS: Record<ThemeId, string> = {
    discordia: 'M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-6l-5 4v-4H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm7 2-4 6h3l-1 5 4-6h-3l1-5Z',
    miami: 'M12 22V10m0 0C10 6 6 5 3 7m9 3c2-4 6-5 9-3m-9 3c-3-1-6 0-8 3m8-3c3-1 6 0 8 3m-8-3c0-3-1-6-4-7m4 7c0-3 1-6 4-7M5 22h14',
    tactical: 'M12 2v5m0 10v5M2 12h5m10 0h5M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    fantasy: 'M14 3h7v7L9 22l-3-3L4 21l-1-1 2-2-3-3L14 3Zm-8 9 6 6m5-11-8 8',
  };
  let { theme, size = 22 }: { theme: ThemeId; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={PATHS[theme]} />
</svg>
