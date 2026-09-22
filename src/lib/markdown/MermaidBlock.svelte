<script lang="ts">
  import { Code2, Maximize2, Workflow } from 'lucide-svelte';
  import { openImage } from '$lib/viewer.svelte';
  import CopyButton from './CopyButton.svelte';

  type MermaidApi = typeof import('mermaid')['default'];
  let { source, streaming = false }: { source: string; streaming?: boolean } = $props();

  let loader: Promise<MermaidApi> | null = null;
  const loadMermaid = () =>
    (loader ??= import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'Manrope, sans-serif',
        themeVariables: {
          primaryColor: '#eef5e3',
          primaryBorderColor: '#8fbd34',
          primaryTextColor: '#20241f',
          lineColor: '#7e867b',
          secondaryColor: '#f2f4ee',
          tertiaryColor: '#ffffff',
          fontSize: '14px'
        }
      });
      return mermaid;
    }));

  let svg = $state('');
  let error = $state('');
  let view: 'diagram' | 'code' = $state('diagram');

  $effect(() => {
    const text = source;
    if (streaming) return;
    let cancelled = false;
    error = '';
    (async () => {
      const mermaid = await loadMermaid();
      if (!(await mermaid.parse(text, { suppressErrors: true }))) throw new Error('Sintaks diagram tidak valid.');
      const result = await mermaid.render(`mmd-${crypto.randomUUID()}`, text);
      if (!cancelled) svg = result.svg;
    })().catch((reason) => {
      if (!cancelled) { svg = ''; error = (reason as Error).message || 'Diagram gagal dirender.'; }
    });
    return () => { cancelled = true; };
  });

  function enlarge() {
    if (svg) openImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, 'Diagram', 'diagram.svg');
  }
</script>

{#if streaming || (!svg && !error)}
  <div class="rb rb-pending"><Workflow size={16} /><span>{streaming ? 'Diagram akan tampil setelah jawaban selesai…' : 'Merender diagram…'}</span></div>
{:else}
  <figure class="rb rb-diagram">
    <figcaption class="rb-toolbar">
      <span class="rb-title">Diagram{#if error}<em> · {error}</em>{/if}</span>
      <div class="rb-actions">
        {#if svg}
          <div class="rb-segment" role="tablist" aria-label="Tampilan diagram">
            <button type="button" role="tab" aria-selected={view === 'diagram'} class:active={view === 'diagram'} onclick={() => (view = 'diagram')}><Workflow size={14} /><span>Diagram</span></button>
            <button type="button" role="tab" aria-selected={view === 'code'} class:active={view === 'code'} onclick={() => (view = 'code')}><Code2 size={14} /><span>Kode</span></button>
          </div>
          <button type="button" class="rb-action icon" onclick={enlarge} aria-label="Perbesar" title="Perbesar"><Maximize2 size={14} /></button>
        {:else}
          <CopyButton text={() => source} label="Salin kode" />
        {/if}
      </div>
    </figcaption>
    {#if svg && view === 'diagram'}
      <div class="rb-scroll rb-svg">{@html svg}</div>
    {:else}
      <pre class="rb-json"><code>{source}</code></pre>
    {/if}
  </figure>
{/if}
