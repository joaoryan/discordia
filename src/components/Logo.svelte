<script lang="ts">
  let { size = 48 }: { size?: number } = $props();
</script>

<!-- Inline para herdar as cores do tema; o raio é um recorte, então funciona em qualquer fundo. -->
<svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label="Discordia">
  <rect width="96" height="96" rx="26" fill="var(--logo-bg)" />
  <path
    fill="var(--accent)"
    fill-rule="evenodd"
    d="M28 14h40a16 16 0 0 1 16 16v28a16 16 0 0 1-16 16H47L30 87c-3 2-6 0-6-3v-10.500A16 16 0 0 1 12 58V30a16 16 0 0 1 16-16Zm24 9L34 47h11l-7 21 23-27H49l9-18Z"
  />
</svg>
