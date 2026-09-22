<script lang="ts">
  import { browser } from '$app/environment';
  import { openImage } from '$lib/viewer.svelte';
  import ChartBlock from './markdown/ChartBlock.svelte';
  import CodeBlock from './markdown/CodeBlock.svelte';
  import HtmlBlock from './markdown/HtmlBlock.svelte';
  import MermaidBlock from './markdown/MermaidBlock.svelte';
  import TableBlock from './markdown/TableBlock.svelte';
  import { toBlocks } from './markdown/parse';
  import './markdown/blocks.css';

  let { content, streaming = false }: { content: string; streaming?: boolean } = $props();
  let root: HTMLDivElement | undefined = $state();

  // Setiap blok tingkat atas dirender terpisah: saat streaming hanya blok terakhir yang berubah.
  const blocks = $derived(browser ? toBlocks(content) : []);

  $effect(() => {
    if (!root) return;
    const element = root;
    const openFromMarkdown = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button.md-image');
      const image = button?.querySelector('img');
      if (image?.src) openImage(image.src, image.alt);
    };
    element.addEventListener('click', openFromMarkdown);
    return () => element.removeEventListener('click', openFromMarkdown);
  });
</script>

<div class="markdown" bind:this={root}>
  {#each blocks as block, index (index)}
    {#if block.kind === 'code'}
      <CodeBlock code={block.code} lang={block.lang} streaming={streaming && index === blocks.length - 1} />
    {:else if block.kind === 'chart'}
      <ChartBlock source={block.source} streaming={streaming && index === blocks.length - 1} />
    {:else if block.kind === 'mermaid'}
      <MermaidBlock source={block.source} streaming={streaming && index === blocks.length - 1} />
    {:else if block.kind === 'table'}
      <TableBlock table={block.table} />
    {:else}
      <HtmlBlock html={block.html} tag={block.tag} />
    {/if}
  {/each}
</div>
