import type katexModule from 'katex';

let loader: Promise<typeof katexModule> | null = null;
const loadKatex = () =>
  (loader ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([module]) => module.default));

/** Render placeholder `.math` (dibuat oleh parser) dengan KaTeX yang dimuat saat pertama dibutuhkan. */
export async function renderMath(root: HTMLElement) {
  const nodes = root.querySelectorAll<HTMLElement>('.math:not([data-rendered])');
  if (!nodes.length) return;
  const katex = await loadKatex();
  for (const node of nodes) {
    if (!node.isConnected || node.dataset.rendered) continue;
    try {
      katex.render(node.dataset.tex || '', node, {
        displayMode: node.dataset.display === 'true',
        throwOnError: false,
        strict: 'ignore',
        trust: false,
        output: 'htmlAndMathml'
      });
      node.dataset.rendered = 'true';
    } catch {
      node.classList.add('math-error');
    }
  }
}
