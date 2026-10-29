/**
 * Merekam satu contoh nyata per skenario: badan permintaan yang dikirim apa adanya
 * dan jawaban yang diterima, lalu menyimpannya ke laporan supaya pembaca bisa
 * melihat yang diuji, bukan membaca ringkasannya.
 *   bun scripts/poc/capture-examples.ts --keys=keys.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LONG_ANSWER_MAX_TOKENS, MAX_TOKENS, SUPPLIER_RATIO, type Supplier } from './config';
import { ACCURACY, CHART_PROMPTS, LONG_ANSWER_PROMPTS, buildLongContext } from './fixtures';
import { streamChat, type Msg } from './client';

const arg = (name: string, fallback = '') =>
  (process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')) ?? fallback;

const OUT = resolve(arg('out', 'data/poc-suppliers.json'));
const MODEL = arg('model', 'glm-5.3-flash');
const SUPPLIER = (arg('supplier', 'ChinaLLM') as Supplier);
const LATENCY_PROMPT = 'Sebutkan ibu kota Indonesia. Jawab satu kata saja.';

/** Riwayat panjang dipendekkan agar terbaca; jumlah pesan asli tetap dicatat. */
function trimMessages(messages: Msg[]) {
  if (messages.length <= 3) return messages;
  return [messages[0], { role: 'system' as const, content: `… ${messages.length - 2} pesan riwayat dipotong untuk ditampilkan …` }, messages[messages.length - 1]];
}

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)}…`);

async function main() {
  const keys: Record<Supplier, string> = arg('keys')
    ? JSON.parse(await readFile(resolve(arg('keys')), 'utf8'))
    : Object.fromEntries(Object.keys(SUPPLIER_RATIO).map((s) => [s, process.env[`TOKENKU_KEY_${s.toUpperCase()}`] ?? '']));
  const key = keys[SUPPLIER];
  if (!key) throw new Error(`Kunci ${SUPPLIER} tidak ada.`);

  const question = ACCURACY.find((q) => q.id === 'E03')!;
  const longContext = buildLongContext(0);
  const cases: Array<{ scenario: string; judge: string; messages: Msg[]; max: number }> = [
    { scenario: 'latensi', judge: 'Dicatat waktu token pertama dan lama total; isi jawaban tidak dinilai.', messages: [{ role: 'user', content: LATENCY_PROMPT }], max: MAX_TOKENS.latency },
    { scenario: 'beban', judge: 'Permintaan yang sama dikirim 16 sekaligus; dihitung penolakan rate limit dan pelebaran latensi.', messages: [{ role: 'user', content: LATENCY_PROMPT }], max: MAX_TOKENS.load },
    { scenario: 'akurasi', judge: `Benar bila jawaban memuat angka ${question.expect}. Kunci dihitung manual, bukan dari model.`, messages: [{ role: 'user', content: question.prompt }], max: MAX_TOKENS.accuracy },
    { scenario: 'format-chart', judge: 'Lulus bila blok ```chart berisi JSON yang terbaca dan punya larik series tidak kosong.', messages: [{ role: 'user', content: `${CHART_PROMPTS[0]}\nJawab hanya dengan blok kode \`\`\`chart berisi JSON {"type":"bar|line|pie","labels":[],"series":[{"name":"","data":[]}]}.` }], max: MAX_TOKENS.chart },
    { scenario: 'jawaban-panjang', judge: 'Gagal bila finish_reason bernilai "length", yang berarti jawaban terpotong batas token.', messages: [{ role: 'user', content: LONG_ANSWER_PROMPTS[0] }], max: LONG_ANSWER_MAX_TOKENS },
    { scenario: 'konteks-panjang', judge: 'Lulus bila jawaban memuat kode ZX-4719 yang ditanam di pesan pertama, membuktikan konteks tidak dipotong.', messages: longContext.messages as Msg[], max: MAX_TOKENS.longContext }
  ];

  const examples = [];
  for (const c of cases) {
    process.stdout.write(`${c.scenario}… `);
    const r = await streamChat(key, MODEL, c.messages, c.max);
    examples.push({
      scenario: c.scenario,
      model: MODEL,
      supplier: SUPPLIER,
      judge: c.judge,
      request: {
        model: MODEL,
        messages: trimMessages(c.messages).map((m) => ({ role: m.role, content: cut(m.content, 420) })),
        max_tokens: c.max,
        stream: true,
        ...(c.messages.length > 3 ? { _catatan: `${c.messages.length} pesan, ±${longContext.approxTokens.toLocaleString('id-ID')} token` } : {})
      },
      response: {
        finish_reason: r.finishReason,
        prompt_tokens: r.inputTokens,
        completion_tokens: r.outputTokens,
        reasoning_tokens: r.reasoningTokens,
        latency_ms: Math.round(r.latencyMs),
        ttft_any_ms: r.ttftAnyMs === null ? null : Math.round(r.ttftAnyMs),
        ttft_content_ms: r.ttftMs === null ? null : Math.round(r.ttftMs),
        content: cut(r.text.replace(/\s+\n/g, '\n').trim(), 460)
      }
    });
    console.log(r.ok ? `ok (${r.outputTokens} token)` : `gagal: ${r.error}`);
  }

  const report = JSON.parse(await readFile(OUT, 'utf8'));
  report.examples = examples;
  await writeFile(OUT, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n${examples.length} contoh disimpan ke ${OUT}`);
}

await main();
