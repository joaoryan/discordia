<script lang="ts">
  // Bate-boca: dois balões de fala discutindo, com uma faísca no meio.
  // `badge` desenha o fundo arredondado, para quando a logo faz papel de ícone do app.
  let { size = 48, badge = false }: { size?: number; badge?: boolean } = $props();
  const spark = $derived(size >= 24);
</script>

<svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label="Discordia">
  {#if badge}<rect width="96" height="96" rx="26" fill="var(--logo-bg)" />{/if}
  <g transform={badge ? 'translate(48 48) scale(.78) translate(-48 -52)' : undefined}>
    <rect x="6" y="14" width="54" height="40" rx="15" fill="var(--accent)" />
    <path d="M16 50 10 70 32 53Z" fill="var(--accent)" />
    <rect x="36" y="38" width="54" height="40" rx="15" fill="var(--violet)" stroke={badge ? 'var(--logo-bg)' : 'var(--bg-deep)'} stroke-width={spark ? 5 : 9} />
    <path d="M80 74 86 90 64 77Z" fill="var(--violet)" />
    {#if spark}
      <path d="M51 30 40 49h9l-5 16 15-21h-9l5-14Z" fill="#fff3d1" stroke={badge ? 'var(--logo-bg)' : 'var(--bg-deep)'} stroke-width="3" stroke-linejoin="round" />
    {/if}
  </g>
</svg>
