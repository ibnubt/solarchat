<script lang="ts">
  import 'highlight.js/styles/github-dark.css';
  import CopyButton from './CopyButton.svelte';
  import { highlightCode } from './highlight';

  let { code, lang = '', streaming = false }: { code: string; lang?: string; streaming?: boolean } = $props();
  let highlighted: string | null = $state(null);

  $effect(() => {
    const source = code;
    const language = lang;
    if (streaming) {
      highlighted = null;
      return;
    }
    let cancelled = false;
    highlightCode(source, language)
      .then((html) => { if (!cancelled) highlighted = html; })
      .catch(() => { if (!cancelled) highlighted = null; });
    return () => { cancelled = true; };
  });
</script>

<figure class="rb rb-code">
  <figcaption class="rb-toolbar dark">
    <span class="rb-label">{lang || 'teks'}</span>
    <div class="rb-actions"><CopyButton text={() => code} label="Salin kode" /></div>
  </figcaption>
  <pre><code class="hljs">{#if highlighted}{@html highlighted}{:else}{code}{/if}</code></pre>
</figure>
