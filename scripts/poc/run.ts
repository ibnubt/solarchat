/**
 * Uji perbandingan supplier Tokenku.
 *   bun scripts/poc/run.ts --session=S1 [--keys=path.json] [--only=glm-5.3-flash]
 * Hasil ditambahkan ke data/poc-suppliers.json; sesi berikutnya digabungkan, bukan menimpa.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  BUDGET_USD, CRITERIA, LOAD_WAVE, LONG_ANSWER_MAX_TOKENS, MATRIX, MAX_TOKENS,
  PLAN, PLAN_SINGLE, SUPPLIER_RATIO, THRESHOLD, type Supplier
} from './config';
import { ACCURACY, CHART_PROMPTS, LONG_ANSWER_PROMPTS, PLANTED_FACT_CODE, buildLongContext, isCorrect } from './fixtures';
import { accountUsageUsd, streamChat, type Msg } from './client';

type Sample = {
  session: string; model: string; supplier: Supplier; scenario: string; index: number;
  ok: boolean; status: number; error?: string;
  ttftAnyMs: number | null; ttftMs: number | null; latencyMs: number;
  inputTokens: number; outputTokens: number; reasoningTokens: number;
  finishReason: string; emptyContent: boolean;
  failureKind?: 'upstream' | 'transport'; transportRetries?: number;
  correct?: boolean; chartValid?: boolean; factFound?: boolean; truncated?: boolean;
  /** Potongan jawaban untuk ditinjau ulang bila penilaian dipersoalkan. */
  answerPreview?: string;
};

const arg = (name: string, fallback = '') =>
  (process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')) ?? fallback;

const SESSION = arg('session', `S${new Date().toISOString().slice(11, 16).replace(':', '')}`);
const OUT = resolve(arg('out', 'data/poc-suppliers.json'));
const ONLY = arg('only');
/** Tanpa --scenarios, semua skenario dijalankan. Dengan daftar, hanya itu yang diulang. */
const SCENARIOS = arg('scenarios').split(',').map((x) => x.trim()).filter(Boolean);
const wants = (name: string) => SCENARIOS.length === 0 || SCENARIOS.includes(name);
const preview = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 160);
const LATENCY_PROMPT = 'Sebutkan ibu kota Indonesia. Jawab satu kata saja.';

const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadKeys(): Promise<Record<Supplier, string>> {
  const file = arg('keys');
  if (file) return JSON.parse(await readFile(resolve(file), 'utf8'));
  const keys = {} as Record<Supplier, string>;
  for (const s of Object.keys(SUPPLIER_RATIO) as Supplier[]) {
    const value = process.env[`TOKENKU_KEY_${s.toUpperCase()}`];
    if (!value) throw new Error(`Kunci untuk ${s} tidak ada (TOKENKU_KEY_${s.toUpperCase()}).`);
    keys[s] = value;
  }
  return keys;
}

const pairs = () => MATRIX.filter((m) => !ONLY || m.model === ONLY)
  .flatMap((m) => m.suppliers.map((supplier) => ({ model: m.model, supplier, plan: m.suppliers.length > 1 ? PLAN : PLAN_SINGLE })));

/** Harga terukur per model: dua profil token dipakai menyelesaikan tarif masukan dan keluaran. */
async function calibrate(keys: Record<Supplier, string>) {
  const rates: Record<string, { usdPerKIn: number; usdPerKOut: number; samples: number }> = {};
  for (const entry of MATRIX) {
    if (ONLY && entry.model !== ONLY) continue;
    const supplier = entry.suppliers[0];
    const ratio = SUPPLIER_RATIO[supplier];
    const filler = 'Sistem kelistrikan nasional memerlukan perencanaan jaringan yang cermat. '.repeat(420);
    const profiles: Array<{ messages: Msg[]; max: number }> = [
      { messages: [{ role: 'user', content: 'Tulis satu paragraf pendek tentang listrik.' }], max: 220 },
      { messages: [{ role: 'user', content: `${filler}\n\nJawab satu kata: selesai.` }], max: 48 }
    ];
    const points: Array<{ in: number; out: number; usd: number }> = [];
    for (const profile of profiles) {
      await sleep(2500);
      const before = await accountUsageUsd(keys[supplier]);
      let inTok = 0, outTok = 0;
      for (let i = 0; i < 2; i++) {
        const r = await streamChat(keys[supplier], entry.model, profile.messages, profile.max);
        inTok += r.inputTokens; outTok += r.outputTokens;
      }
      await sleep(4000);
      const after = await accountUsageUsd(keys[supplier]);
      if (before === null || after === null || after <= before || !inTok) continue;
      points.push({ in: inTok / 1000, out: outTok / 1000, usd: (after - before) / ratio });
    }
    if (points.length === 2) {
      const [a, b] = points;
      const det = a.in * b.out - b.in * a.out;
      if (Math.abs(det) > 1e-9) {
        const rin = (a.usd * b.out - b.usd * a.out) / det;
        const rout = (a.in * b.usd - b.in * a.usd) / det;
        if (rin >= 0 && rout >= 0) {
          rates[entry.model] = { usdPerKIn: rin, usdPerKOut: rout, samples: points.length };
          log(`kalibrasi ${entry.model}: $${rin.toFixed(6)}/1k masuk, $${rout.toFixed(6)}/1k keluar (sebelum pengali supplier)`);
          continue;
        }
      }
    }
    log(`kalibrasi ${entry.model}: gagal, biaya pasangan ini dihitung dari total sesi`);
  }
  return rates;
}

/** Ambil blok ```chart dan periksa apakah isinya spesifikasi grafik yang bisa dipakai. */
function chartIsValid(text: string) {
  const block = /```(?:chart|json)?\s*([\s\S]*?)```/.exec(text);
  const raw = (block ? block[1] : text).trim();
  try {
    const spec = JSON.parse(raw);
    const series = spec.series ?? spec.datasets ?? spec.data;
    return Boolean(spec && typeof spec === 'object' && Array.isArray(series) && series.length > 0);
  } catch { return false; }
}

async function runScenario(key: string, model: string, supplier: Supplier, scenario: string, index: number, messages: Msg[], max: number) {
  const r = await streamChat(key, model, messages, max);
  const sample: Sample = {
    session: SESSION, model, supplier, scenario, index,
    ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}),
    ...(r.failureKind ? { failureKind: r.failureKind } : {}),
    ...(r.transportRetries ? { transportRetries: r.transportRetries } : {}),
    ttftAnyMs: r.ttftAnyMs === null ? null : Math.round(r.ttftAnyMs),
    ttftMs: r.ttftMs === null ? null : Math.round(r.ttftMs),
    latencyMs: Math.round(r.latencyMs),
    inputTokens: r.inputTokens, outputTokens: r.outputTokens, reasoningTokens: r.reasoningTokens,
    finishReason: r.finishReason, emptyContent: r.emptyContent
  };
  return { sample, text: r.text };
}

async function latencyBlock(key: string, model: string, supplier: Supplier, n: number) {
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) out.push((await runScenario(key, model, supplier, 'latensi', i, [{ role: 'user', content: LATENCY_PROMPT }], MAX_TOKENS.latency)).sample);
  return out;
}

async function restBlock(key: string, model: string, supplier: Supplier, plan: typeof PLAN | typeof PLAN_SINGLE) {
  const out: Sample[] = [];

  if (wants('beban')) for (let wave = 0; wave < Math.ceil(plan.load / LOAD_WAVE); wave++) {
    const size = Math.min(LOAD_WAVE, plan.load - wave * LOAD_WAVE);
    const wavePart = await Promise.all(Array.from({ length: size }, (_, i) =>
      runScenario(key, model, supplier, 'beban', wave * LOAD_WAVE + i, [{ role: 'user', content: LATENCY_PROMPT }], MAX_TOKENS.load)));
    out.push(...wavePart.map((w) => w.sample));
  }

  if (wants('akurasi')) for (let i = 0; i < plan.accuracy; i++) {
    const q = ACCURACY[i % ACCURACY.length];
    const { sample, text } = await runScenario(key, model, supplier, 'akurasi', i, [{ role: 'user', content: q.prompt }], MAX_TOKENS.accuracy);
    out.push({ ...sample, correct: sample.ok && isCorrect(q, text), answerPreview: preview(text) });
  }

  if (wants('format-chart')) for (let i = 0; i < plan.chart; i++) {
    const prompt = `${CHART_PROMPTS[i % CHART_PROMPTS.length]}\nJawab hanya dengan blok kode \`\`\`chart berisi JSON {"type":"bar|line|pie","labels":[],"series":[{"name":"","data":[]}]}.`;
    const { sample, text } = await runScenario(key, model, supplier, 'format-chart', i, [{ role: 'user', content: prompt }], MAX_TOKENS.chart);
    out.push({ ...sample, chartValid: sample.ok && chartIsValid(text), answerPreview: preview(text) });
  }

  if (wants('jawaban-panjang')) for (let i = 0; i < plan.longAnswer; i++) {
    const { sample } = await runScenario(key, model, supplier, 'jawaban-panjang', i, [{ role: 'user', content: LONG_ANSWER_PROMPTS[i % LONG_ANSWER_PROMPTS.length] }], LONG_ANSWER_MAX_TOKENS);
    out.push({ ...sample, truncated: sample.finishReason === 'length' });
  }

  if (wants('konteks-panjang')) for (let i = 0; i < plan.longContext; i++) {
    const ctx = buildLongContext(i);
    const { sample, text } = await runScenario(key, model, supplier, 'konteks-panjang', i, ctx.messages as Msg[], MAX_TOKENS.longContext);
    out.push({ ...sample, factFound: sample.ok && text.toUpperCase().includes(PLANTED_FACT_CODE), answerPreview: preview(text) });
  }

  return out;
}

async function main() {
  const keys = await loadKeys();
  const all = pairs();
  log(`sesi ${SESSION}: ${all.length} pasangan, target ${all.reduce((a, p) => a + Object.values(p.plan).reduce((x, y) => x + y, 0), 0)} request`);

  const usageStart = await accountUsageUsd(keys.Enterprise);
  const rates = wants('kalibrasi') ? await calibrate(keys) : {};

  const samples: Sample[] = [];
  const models = [...new Set(all.map((p) => p.model))];

  if (wants('latensi')) {
  log('— tahap 1: latensi (model berurutan, supplier paralel)');
  for (const model of models) {
    const group = all.filter((p) => p.model === model);
    const started = Date.now();
    const res = await Promise.all(group.map((p) => latencyBlock(keys[p.supplier], model, p.supplier, p.plan.latency)));
    res.forEach((r) => samples.push(...r));
    const flat = res.flat();
    const okRate = flat.filter((s) => s.ok).length / Math.max(flat.length, 1);
    log(`  ${model.padEnd(28)} ${flat.length} request, berhasil ${(okRate * 100).toFixed(0)}%, ${Math.round((Date.now() - started) / 1000)} dtk`);
    const spent = await accountUsageUsd(keys.Enterprise);
    if (usageStart !== null && spent !== null && spent - usageStart > BUDGET_USD) { log('batas biaya tercapai, uji dihentikan'); break; }
  }
  }

  log('— tahap 2: beban, akurasi, format, jawaban panjang, konteks panjang (paralel penuh)');
  const started = Date.now();
  const rest = await Promise.all(all.map((p) => restBlock(keys[p.supplier], p.model, p.supplier, p.plan)));
  rest.forEach((r) => samples.push(...r));
  log(`  selesai dalam ${Math.round((Date.now() - started) / 60000)} menit`);

  const usageEnd = await accountUsageUsd(keys.Enterprise);
  const report = {
    schemaVersion: 2,
    criteria: CRITERIA,
    threshold: THRESHOLD,
    supplierRatio: SUPPLIER_RATIO,
    sessions: [{ id: SESSION, startedAt: new Date().toISOString(), usageStartUsd: usageStart, usageEndUsd: usageEnd }],
    rates,
    samples
  };
  const ranScenarios = new Set(samples.map((s) => s.scenario));
  await mkdir(dirname(OUT), { recursive: true });
  let merged = report;
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    if (prev.schemaVersion === 2) {
      // Hanya skenario yang baru dijalankan yang digantikan; sisanya dipertahankan.
      const kept = prev.samples.filter((s: any) => !(s.session === SESSION && ranScenarios.has(s.scenario)));
      const sessions = SCENARIOS.length
        ? prev.sessions.map((s: any) => (s.id === SESSION ? s : s))
        : [...prev.sessions.filter((s: any) => s.id !== SESSION), ...report.sessions];
      merged = { ...report, sessions: sessions.length ? sessions : report.sessions, rates: { ...prev.rates, ...rates }, samples: [...kept, ...samples] };
    }
  } catch { /* berkas belum ada */ }
  await writeFile(OUT, JSON.stringify(merged, null, 2), 'utf8');
  log(`${samples.length} sampel ditulis ke ${OUT}. Biaya sesi: $${usageStart !== null && usageEnd !== null ? (usageEnd - usageStart).toFixed(4) : '?'}`);
}

await main();
