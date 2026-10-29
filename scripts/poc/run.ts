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
  /** Model menolak parameter uji (mis. reasoning_effort); bukan kegagalan supplier. */
  unsupported?: boolean;
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

/**
 * Harga terukur per model. Dua profil token berbeda dipakai menyelesaikan tarif masukan dan keluaran.
 * Setiap permintaan memakai teks unik agar tidak kena cache prompt, yang tarifnya jauh lebih murah
 * dan sempat membuat tarif masukan tercatat terlalu rendah.
 */
const uniqueFiller = (approxTokens: number) => {
  const words = ['gardu', 'trafo', 'jaringan', 'pelanggan', 'beban', 'tegangan', 'pemeliharaan', 'inspeksi', 'laporan', 'wilayah', 'cabang', 'operasi'];
  const parts: string[] = [];
  let count = 0;
  while (count < approxTokens) {
    const n = Math.floor(Math.random() * 1_000_000);
    parts.push(`${words[n % words.length]} ${n} ${words[(n >> 3) % words.length]} ${(n * 7) % 9973}.`);
    count += 8;
  }
  return parts.join(' ');
};

async function calibrate(keys: Record<Supplier, string>) {
  // Tagihan akun bisa tercampur pemakaian lain selama pengukuran, jadi tiap model diukur
  // beberapa putaran dan diambil mediannya; rentang antar putaran ikut disimpan.
  const ROUNDS = 3;
  const REPEAT = 3;
  const rates: Record<string, { usdPerKIn: number; usdPerKOut: number; samples: number; spreadIn?: [number, number]; spreadOut?: [number, number] }> = {};
  const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

  for (const entry of MATRIX) {
    if (ONLY && entry.model !== ONLY) continue;
    const supplier = entry.suppliers[0];
    const ratio = SUPPLIER_RATIO[supplier];
    const ins: number[] = [], outs: number[] = [];

    for (let round = 0; round < ROUNDS; round++) {
      const profiles: Array<{ make: () => Msg[]; max: number }> = [
        { make: () => [{ role: 'user', content: `Tulis satu paragraf pendek tentang listrik. Kode: ${Math.random().toString(36).slice(2)}` }], max: 220 },
        { make: () => [{ role: 'user', content: `${uniqueFiller(6000)}\n\nJawab satu kata: selesai.` }], max: 48 }
      ];
      const points: Array<{ in: number; out: number; usd: number }> = [];
      for (const profile of profiles) {
        await sleep(2500);
        const before = await accountUsageUsd(keys[supplier]);
        let inTok = 0, outTok = 0;
        for (let i = 0; i < REPEAT; i++) {
          const r = await streamChat(keys[supplier], entry.model, profile.make(), profile.max);
          inTok += r.inputTokens; outTok += r.outputTokens;
        }
        await sleep(4000);
        const after = await accountUsageUsd(keys[supplier]);
        if (before === null || after === null || after <= before || !inTok) continue;
        points.push({ in: inTok / 1000, out: outTok / 1000, usd: (after - before) / ratio });
      }
      if (points.length !== 2) continue;
      const [a, b] = points;
      const det = a.in * b.out - b.in * a.out;
      if (Math.abs(det) < 1e-9) continue;
      const rin = (a.usd * b.out - b.usd * a.out) / det;
      const rout = (a.in * b.usd - b.in * a.usd) / det;
      if (rin >= 0 && rout >= 0) { ins.push(rin); outs.push(rout); }
    }

    if (ins.length) {
      rates[entry.model] = {
        usdPerKIn: median(ins), usdPerKOut: median(outs), samples: ins.length * REPEAT * 2,
        spreadIn: [Math.min(...ins), Math.max(...ins)], spreadOut: [Math.min(...outs), Math.max(...outs)]
      };
      log(`kalibrasi ${entry.model}: masuk $${median(ins).toFixed(6)} [${Math.min(...ins).toFixed(6)}-${Math.max(...ins).toFixed(6)}], keluar $${median(outs).toFixed(6)} [${Math.min(...outs).toFixed(6)}-${Math.max(...outs).toFixed(6)}] per 1k, ${ins.length} putaran`);
    } else {
      log(`kalibrasi ${entry.model}: gagal`);
    }
  }
  return rates;
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

  // Prompt yang sama dengan uji latensi, tetapi meminta model tidak menalar. Status 400 berarti
  // model tidak mendukung permintaan itu; dicatat apa adanya, bukan sebagai kegagalan supplier.
  if (wants('tanpa-nalar')) for (let i = 0; i < plan.noReasoning; i++) {
    const r = await streamChat(key, model, [{ role: 'user', content: LATENCY_PROMPT }], MAX_TOKENS.latency, 300_000, { reasoning_effort: 'low' });
    const unsupported = !r.ok && r.status === 400;
    out.push({
      session: SESSION, model, supplier, scenario: 'tanpa-nalar', index: i,
      ok: r.ok || unsupported, status: r.status, ...(r.error && !unsupported ? { error: r.error } : {}),
      ...(unsupported ? { error: 'tidak didukung model (400)', unsupported: true } : {}),
      ...(r.failureKind && !unsupported ? { failureKind: r.failureKind } : {}),
      ttftAnyMs: r.ttftAnyMs === null ? null : Math.round(r.ttftAnyMs),
      ttftMs: r.ttftMs === null ? null : Math.round(r.ttftMs),
      latencyMs: Math.round(r.latencyMs),
      inputTokens: r.inputTokens, outputTokens: r.outputTokens, reasoningTokens: r.reasoningTokens,
      finishReason: r.finishReason, emptyContent: r.emptyContent
    });
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
      // Sesi baru tetap dicatat walau hanya sebagian skenario yang dijalankan.
      const sessions = prev.sessions.some((s: any) => s.id === SESSION)
        ? prev.sessions
        : [...prev.sessions, ...report.sessions];
      merged = { ...report, sessions: sessions.length ? sessions : report.sessions, rates: { ...prev.rates, ...rates }, samples: [...kept, ...samples] };
    }
  } catch { /* berkas belum ada */ }
  await writeFile(OUT, JSON.stringify(merged, null, 2), 'utf8');
  log(`${samples.length} sampel ditulis ke ${OUT}. Biaya sesi: $${usageStart !== null && usageEnd !== null ? (usageEnd - usageStart).toFixed(4) : '?'}`);
}

await main();
