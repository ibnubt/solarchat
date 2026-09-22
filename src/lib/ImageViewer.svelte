<script lang="ts">
  import { Download, X, ZoomIn, ZoomOut } from 'lucide-svelte';
  import { closeImage, viewer } from '$lib/viewer.svelte';

  let zoomed = $state(false);

  $effect(() => {
    if (!viewer.src) zoomed = false;
  });

  function handleKeydown(event: KeyboardEvent) {
    if (viewer.src && event.key === 'Escape') closeImage();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if viewer.src}
  <div class="viewer" role="dialog" aria-modal="true" aria-label={viewer.alt || 'Pratinjau gambar'}>
    <button class="viewer-backdrop" onclick={closeImage} aria-label="Tutup pratinjau"></button>
    <div class="viewer-bar">
      <span>{viewer.alt || 'Gambar'}</span>
      <button onclick={() => (zoomed = !zoomed)} aria-label={zoomed ? 'Sesuaikan layar' : 'Ukuran asli'} title={zoomed ? 'Sesuaikan layar' : 'Ukuran asli'}>{#if zoomed}<ZoomOut size={17} />{:else}<ZoomIn size={17} />{/if}</button>
      <a href={viewer.src} download={viewer.filename || ''} target="_blank" rel="noreferrer" aria-label="Unduh" title="Unduh"><Download size={17} /></a>
      <button onclick={closeImage} aria-label="Tutup" title="Tutup (Esc)"><X size={18} /></button>
    </div>
    <div class="viewer-stage" class:zoomed>
      <img src={viewer.src} alt={viewer.alt} />
    </div>
  </div>
{/if}

<style>
  .viewer { position: fixed; inset: 0; z-index: 60; display: flex; flex-direction: column; }
  .viewer-backdrop { position: absolute; inset: 0; border: 0; background: rgba(18, 21, 17, .88); cursor: zoom-out; }
  .viewer-bar { position: relative; display: flex; align-items: center; gap: 4px; padding: max(10px, env(safe-area-inset-top)) 12px 10px 18px; color: #eef2e9; }
  .viewer-bar span { min-width: 0; flex: 1; overflow: hidden; font-size: 13px; white-space: nowrap; text-overflow: ellipsis; }
  .viewer-bar button, .viewer-bar a { width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 10px; background: transparent; color: inherit; cursor: pointer; }
  .viewer-bar button:hover, .viewer-bar a:hover { background: rgba(255, 255, 255, .12); }
  .viewer-stage { position: relative; min-height: 0; flex: 1; display: grid; place-items: center; padding: 8px 16px max(20px, env(safe-area-inset-bottom)); overflow: hidden; pointer-events: none; }
  .viewer-stage img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; background: #fff; box-shadow: 0 20px 60px rgba(0, 0, 0, .35); pointer-events: auto; }
  .viewer-stage.zoomed { place-items: start center; overflow: auto; pointer-events: auto; }
  .viewer-stage.zoomed img { max-width: none; max-height: none; }
</style>
