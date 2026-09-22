import type { HLJSApi } from 'highlight.js';

let loader: Promise<HLJSApi> | null = null;
const loadHighlighter = () => (loader ??= import('highlight.js/lib/common').then((module) => module.default));

const ALIASES: Record<string, string> = { sh: 'bash', shell: 'bash', zsh: 'bash', js: 'javascript', ts: 'typescript', py: 'python', yml: 'yaml', html: 'xml', svelte: 'xml', vue: 'xml' };

/** Kembalikan HTML ter-highlight (sudah di-escape oleh highlight.js) atau `null` bila tidak perlu. */
export async function highlightCode(code: string, lang: string) {
  if (!code || code.length > 60_000) return null;
  const hljs = await loadHighlighter();
  const language = ALIASES[lang] || lang;
  if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  if (code.length > 6_000) return null;
  return hljs.highlightAuto(code).value;
}
