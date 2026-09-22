<script lang="ts">
  import { Check, Copy } from 'lucide-svelte';

  let { text, label = 'Salin' }: { text: () => string; label?: string } = $props();
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text());
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch { /* Clipboard ditolak browser; biarkan tanpa umpan balik. */ }
  }
</script>

<button type="button" class="rb-action" onclick={copy} aria-label={label} title={label}>
  {#if copied}<Check size={14} /><span>Tersalin</span>{:else}<Copy size={14} /><span>{label}</span>{/if}
</button>
