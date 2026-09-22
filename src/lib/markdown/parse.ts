import DOMPurify from 'dompurify';
import { Marked, type Token, type Tokens, type TokenizerAndRendererExtension } from 'marked';

export type TableData = {
  header: string[];
  headerHtml: string[];
  rows: string[][];
  rowsHtml: string[][];
  align: Tokens.Table['align'];
};

export type Block =
  | { kind: 'html'; tag: string; html: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'chart'; source: string }
  | { kind: 'mermaid'; source: string }
  | { kind: 'table'; table: TableData };

const CHART_LANGS = new Set(['chart', 'echarts', 'chartjs']);

export const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const mathHtml = (tex: string, display: boolean) => {
  const tag = display ? 'div' : 'span';
  return `<${tag} class="math" data-tex="${escapeHtml(tex)}" data-display="${display}">${escapeHtml(tex)}</${tag}>`;
};

// `$5 dan $10` bukan rumus: tolak isi yang berupa kalimat biasa tanpa penanda TeX.
const looksLikeProse = (text: string) => /\s$/.test(text) || (/[A-Za-z]{4,}/.test(text) && /\s/.test(text) && !/[\\^_{}=]/.test(text));

const mathExtensions: TokenizerAndRendererExtension[] = [
  {
    name: 'mathBlock',
    level: 'block',
    start(src) {
      const index = src.search(/\$\$|\\\[/);
      return index < 0 ? undefined : index;
    },
    tokenizer(src) {
      const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/.exec(src);
      if (match) return { type: 'mathBlock', raw: match[0], text: (match[1] ?? match[2]).trim() };
    },
    renderer: (token) => mathHtml(token.text, true)
  },
  {
    name: 'mathInline',
    level: 'inline',
    start(src) {
      const index = src.search(/\$|\\\(/);
      return index < 0 ? undefined : index;
    },
    tokenizer(src) {
      const display = /^\$\$([^$]+?)\$\$/.exec(src);
      if (display) return { type: 'mathInline', raw: display[0], text: display[1].trim(), display: true };
      const paren = /^\\\(([\s\S]+?)\\\)/.exec(src);
      if (paren) return { type: 'mathInline', raw: paren[0], text: paren[1].trim(), display: false };
      const dollar = /^\$(?=[^\s$])((?:\\.|[^\\$\n])+?)\$(?!\d)/.exec(src);
      if (dollar && !looksLikeProse(dollar[1])) return { type: 'mathInline', raw: dollar[0], text: dollar[1], display: false };
    },
    renderer: (token) => mathHtml(token.text, Boolean(token.display))
  }
];

let insideLink = false;

const md = new Marked({
  gfm: true,
  breaks: true,
  extensions: mathExtensions,
  renderer: {
    link({ href, title, tokens }) {
      insideLink = true;
      const text = this.parser.parseInline(tokens);
      insideLink = false;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<a href="${escapeHtml(href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image({ href, title, text }) {
      const img = `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy" decoding="async" />`;
      // Tombol membuat gambar bisa dibuka di penampil; di dalam tautan cukup gambar biasa.
      return insideLink ? img : `<button type="button" class="md-image" aria-label="Perbesar gambar">${img}</button>`;
    }
  }
});

export function sanitize(html: string) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'loading', 'decoding']
  });
}

export function htmlToText(html: string) {
  if (!html) return '';
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent || '').trim();
}

function tableData(token: Tokens.Table): TableData {
  const cellHtml = (cell: Tokens.TableCell) => sanitize(md.Parser.parseInline(cell.tokens, md.defaults));
  const headerHtml = token.header.map(cellHtml);
  const rowsHtml = token.rows.map((row) => row.map(cellHtml));
  return {
    headerHtml,
    rowsHtml,
    header: headerHtml.map(htmlToText),
    rows: rowsHtml.map((row) => row.map(htmlToText)),
    align: token.align
  };
}

/** Pecah Markdown menjadi blok tingkat atas agar tabel, grafik, diagram, dan kode dirender sebagai komponen. */
export function toBlocks(content: string): Block[] {
  if (!content) return [];
  const blocks: Block[] = [];
  for (const token of md.lexer(content) as Token[]) {
    if (token.type === 'space' || token.type === 'def') continue;
    if (token.type === 'code') {
      const code = token as Tokens.Code;
      const lang = (code.lang || '').trim().split(/\s+/)[0].toLowerCase();
      if (CHART_LANGS.has(lang)) blocks.push({ kind: 'chart', source: code.text });
      else if (lang === 'mermaid') blocks.push({ kind: 'mermaid', source: code.text });
      else blocks.push({ kind: 'code', lang, code: code.text });
      continue;
    }
    if (token.type === 'table') {
      blocks.push({ kind: 'table', table: tableData(token as Tokens.Table) });
      continue;
    }
    blocks.push({ kind: 'html', tag: token.type, html: sanitize(md.parser([token])) });
  }
  return blocks;
}

/** Baca angka dari sel tabel: `1.234,5` (ID), `1,234.5` (EN), `Rp 2.000`, `12%`, `(300)`. */
export function parseNumber(raw: string): number | null {
  let text = raw.trim().replace(/−/g, '-');
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text);
  text = text
    .replace(/^\((.*)\)$/, '$1')
    .replace(/^(?:rp\.?|idr|usd|us\$|\$|€|£)\s*/i, '')
    .replace(/\s*%$/, '')
    .replace(/\s+/g, '');
  let value: number;
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) value = Number(text.replace(/\./g, '').replace(',', '.'));
  else if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) value = Number(text.replace(/,/g, ''));
  else if (/^-?\d+,\d+$/.test(text)) value = Number(text.replace(',', '.'));
  else if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) value = Number(text);
  else return null;
  if (!Number.isFinite(value)) return null;
  return negative ? -Math.abs(value) : value;
}
