<script lang="ts">
  import { renderMath } from './math';

  let { html, tag }: { html: string; tag: string } = $props();
  let node: HTMLDivElement | undefined = $state();

  $effect(() => {
    html;
    if (node?.querySelector('.math')) void renderMath(node);
  });
</script>

<div class={`md-block md-${tag}`} bind:this={node}>{@html html}</div>
