<script lang="ts">
  import { initials } from '../lib/format';

  let {
    name,
    avatar = '',
    color = '#e8a33d',
    size = 40,
    speaking = false,
    online = false,
  }: { name: string; avatar?: string; color?: string; size?: number; speaking?: boolean; online?: boolean } = $props();
</script>

<span class="wrap" style:--size="{size}px" style:--color={color}>
  <span class="avatar" class:speaking>
    {#if avatar}
      <img src={avatar} alt="" />
    {:else}
      {initials(name)}
    {/if}
  </span>
  {#if online}<i class="dot"></i>{/if}
</span>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
    flex: none;
  }

  .dot {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 12px;
    height: 12px;
    border: 2.5px solid var(--bg-side);
    border-radius: 50%;
    background: var(--ok);
  }

  .avatar {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: var(--size);
    height: var(--size);
    overflow: hidden;
    border-radius: 50%;
    background: linear-gradient(145deg, color-mix(in srgb, var(--color) 88%, #fff), var(--color));
    color: #15141c;
    font-size: calc(var(--size) * 0.38);
    font-weight: 700;
    user-select: none;
  }

  .speaking {
    box-shadow: 0 0 0 2px var(--bg-side), 0 0 0 4px var(--ok);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
