<script lang="ts">
  import { browser } from '$app/environment';
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';

  let { content }: { content: string } = $props();

  function renderMarkdown(value: string) {
    if (!browser || !value) return '';
    const rendered = marked.parse(value, { breaks: true, gfm: true });
    return DOMPurify.sanitize(String(rendered), {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel']
    });
  }

  let html = $derived(renderMarkdown(content));
</script>

<div class="markdown">{@html html}</div>

<style>
  .markdown :global(p) { margin: 0 0 12px; }
  .markdown :global(p:last-child) { margin-bottom: 0; }
  .markdown :global(h1), .markdown :global(h2), .markdown :global(h3) { margin: 22px 0 10px; line-height: 1.25; letter-spacing: -.025em; }
  .markdown :global(h1:first-child), .markdown :global(h2:first-child), .markdown :global(h3:first-child) { margin-top: 0; }
  .markdown :global(h1) { font-size: 1.35rem; }
  .markdown :global(h2) { font-size: 1.18rem; }
  .markdown :global(h3) { font-size: 1.05rem; }
  .markdown :global(ul), .markdown :global(ol) { margin: 8px 0 14px; padding-left: 22px; }
  .markdown :global(li) { margin: 5px 0; }
  .markdown :global(blockquote) { margin: 14px 0; padding: 8px 14px; border-left: 3px solid #8fbd34; background: #f2f5ec; color: #586052; }
  .markdown :global(code) { padding: 2px 5px; border-radius: 5px; background: #edf0e8; color: #496b0d; font-family: 'DM Mono', monospace; font-size: .88em; }
  .markdown :global(pre) { margin: 14px 0; padding: 15px 16px; overflow-x: auto; border: 1px solid #dce1d7; border-radius: 11px; background: #20241f; color: #eef2e9; }
  .markdown :global(pre code) { padding: 0; background: transparent; color: inherit; }
  .markdown :global(a) { color: #5d870d; text-underline-offset: 3px; }
  .markdown :global(hr) { margin: 20px 0; border: 0; border-top: 1px solid #dfe3da; }
  .markdown :global(table) { width: 100%; margin: 14px 0; border-collapse: collapse; font-size: .92em; }
  .markdown :global(th), .markdown :global(td) { padding: 8px 10px; border: 1px solid #dce1d7; text-align: left; }
  .markdown :global(th) { background: #f0f3eb; }
</style>
