/** Hasil objektif per model dan per supplier, dihitung langsung dari sampel. */
import { USD_TO_IDR, type Sample, type SupplierReport } from './suppliers';

const quantile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * (p / 100);
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] === undefined ? sorted[base] : Math.round(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
};
const median = (v: number[]) => quantile(v, 50);

/** Definisi singkat kolom yang dipakai di halaman. */
export const METRICS = [
  { id: 'ttft', label: 'Waktu tunggu (TTFT)', how: 'Dari permintaan dikirim sampai token pertama keluar; p50 dan p95. Prompt pendek 43 token.' },
  { id: 'reasoning', label: 'Berpikir', how: 'Pada prompt pendek 43 token: berapa persen token keluaran dipakai model menalar sebelum menulis jawaban, dan berapa median token keluarnya. Token berpikir ikut ditagih. Kolom reasoning_effort: low = prompt yang sama dikirim dengan parameter itu; kalau persen dan jumlah tokennya tidak turun, model mengabaikannya.' },
  { id: 'success', label: 'Berhasil', how: 'Permintaan yang dilayani sampai selesai. Gagal = ditolak Tokenku, putus, atau habis waktu 5 menit. Gangguan jaringan penguji tidak dihitung.' },
  { id: 'availability', label: 'Probe tiap 2 menit', how: 'Selama 60 menit, tiap 2 menit satu permintaan ringan (38 token) dikirim ke setiap pasangan. 30/30 berarti semua dijawab. Dibuat untuk menangkap error sesaat seperti "Failed to get available channel" yang tidak terlihat pada uji singkat.' },
  { id: 'cost', label: 'Biaya', how: 'Tarif per token diukur dari tagihan akun (median 3 putaran), dikali token yang terpakai pada uji, dikali pengali harga supplier. Per 1.000 permintaan; ukuran token tiap jenis permintaan tertulis di bagian Harga.' }
] as const;

export type ModelRow = {
  model: string;
  suppliers: string[];
  requests: number;
  successRate: number;
  failures: number;
  ttftP50: number | null;
  ttftP95: number | null;
  tokensPerSecond: number | null;
  rateLimited: number;
  accuracy: { right: number; total: number };
  chart: { ok: number; total: number };
  longAnswer: { intact: number; total: number };
  context: { found: number; total: number; tokens: number };
  reasoningShare: number | null;
  cheapestSupplier: string;
  costShortIdr: number | null;
  costLongIdr: number | null;
  /** Lebar rentang tarif keluaran antar putaran kalibrasi, sebagai persen dari median. 0 = stabil. */
  costUncertainty: number | null;
};

export type SupplierRow = {
  model: string;
  supplier: string;
  ratio: number;
  requests: number;
  failures: number;
  successRate: number;
  ttftP50: number | null;
  ttftP95: number | null;
  tokensPerSecond: number | null;
  /** Porsi token berpikir dan median token keluar pada prompt pendek (skenario latensi). */
  reasoningShare: number | null;
  shortOutTokens: number | null;
  /** Prompt pendek yang sama dengan reasoning_effort: low. */
  noReasoning: { supported: boolean; ttftP50: number | null; ttftP95: number | null; reasoningShare: number | null; outTokens: number | null } | null;
  /** Probe ketersediaan berjangka: berapa probe berhasil dari total. */
  availability: { ok: number; total: number; errors: string[] } | null;
  costShortIdr: number | null;
  costLongIdr: number | null;
};

const count = (rows: Sample[], hit: (s: Sample) => boolean) => rows.filter(hit).length;

/**
 * Biaya 1.000 permintaan. Token diambil dari rata-rata seluruh supplier untuk model yang sama,
 * supaya perbandingan antar supplier hanya mencerminkan pengali harga, bukan panjang berpikir
 * yang kebetulan berbeda pada tiap sampel.
 */
function costIdr(report: SupplierReport, model: string, supplier: string, rows: Sample[]) {
  const rate = report.rates[model];
  const ratio = report.supplierRatio[supplier] ?? 1;
  const done = rows.filter((s) => s.ok && s.outputTokens > 0);
  if (!rate || !done.length) return null;
  const perRequest = done.reduce((sum, s) => sum + (s.inputTokens / 1000) * rate.usdPerKIn + (s.outputTokens / 1000) * rate.usdPerKOut, 0) / done.length;
  return Math.round(perRequest * ratio * 1000 * USD_TO_IDR);
}

export function summarise(report: SupplierReport) {
  const samples = report.samples;
  const models = [...new Set(samples.map((s) => s.model))];
  const ratio = report.supplierRatio;

  const supplierRows: SupplierRow[] = [];
  const modelRows: ModelRow[] = models.map((model) => {
    const rows = samples.filter((s) => s.model === model);
    const counted = rows.filter((s) => (s.ok || s.failureKind !== 'transport') && s.scenario !== 'tanpa-nalar' && s.scenario !== 'ketersediaan');
    const failures = count(counted, (s) => !s.ok);
    const latency = rows.filter((s) => s.scenario === 'latensi' && s.ok);
    const ttft = latency.map((s) => s.ttftAnyMs).filter((v): v is number => v !== null);
    const speeds = rows
      .filter((s) => s.ok && s.outputTokens >= 100 && s.ttftAnyMs !== null && s.latencyMs > s.ttftAnyMs + 200)
      .map((s) => s.outputTokens / ((s.latencyMs - (s.ttftAnyMs as number)) / 1000));
    const acc = rows.filter((s) => s.scenario === 'akurasi');
    const chart = rows.filter((s) => s.scenario === 'format-chart');
    const long = rows.filter((s) => s.scenario === 'jawaban-panjang');
    const ctx = rows.filter((s) => s.scenario === 'konteks-panjang');
    const done = rows.filter((s) => s.ok && s.outputTokens > 0 && s.scenario !== 'tanpa-nalar');
    const outTok = done.reduce((a, s) => a + s.outputTokens, 0);
    const suppliers = [...new Set(rows.map((s) => s.supplier))].sort((a, b) => (ratio[a] ?? 1) - (ratio[b] ?? 1));
    const cheapest = suppliers[0];

    for (const supplier of suppliers) {
      const sr = rows.filter((s) => s.supplier === supplier);
      const srCounted = sr.filter((s) => (s.ok || s.failureKind !== 'transport') && s.scenario !== 'tanpa-nalar' && s.scenario !== 'ketersediaan');
      const srFail = count(srCounted, (s) => !s.ok);
      const srLat = sr.filter((s) => s.scenario === 'latensi' && s.ok);
      const srTtft = srLat.map((s) => s.ttftAnyMs).filter((v): v is number => v !== null);
      const srSpeeds = sr.filter((s) => s.ok && s.outputTokens >= 100 && s.ttftAnyMs !== null && s.latencyMs > s.ttftAnyMs + 200)
        .map((s) => s.outputTokens / ((s.latencyMs - (s.ttftAnyMs as number)) / 1000));
      // Porsi berpikir diambil dari prompt pendek saja agar sebanding dengan kolom reasoning_effort: low.
      const srDone = srLat.filter((s) => s.outputTokens > 0);
      const srOut = srDone.reduce((a, s) => a + s.outputTokens, 0);
      const nr = sr.filter((s) => s.scenario === 'tanpa-nalar');
      const nrOk = nr.filter((s) => s.ok && !s.unsupported);
      const nrOut = nrOk.reduce((a, s) => a + s.outputTokens, 0);
      const av = sr.filter((s) => s.scenario === 'ketersediaan' && (s.ok || s.failureKind !== 'transport'));
      supplierRows.push({
        model, supplier, ratio: ratio[supplier] ?? 1,
        requests: srCounted.length,
        failures: srFail,
        successRate: srCounted.length ? (srCounted.length - srFail) / srCounted.length : 0,
        ttftP50: median(srTtft), ttftP95: quantile(srTtft, 95),
        tokensPerSecond: srSpeeds.length ? Math.round(median(srSpeeds) as number) : null,
        reasoningShare: srOut ? srDone.reduce((a, s) => a + s.reasoningTokens, 0) / srOut : null,
        shortOutTokens: median(srDone.map((s) => s.outputTokens)),
        noReasoning: nr.length
          ? {
              supported: nrOk.length > 0 && count(nr, (s) => s.unsupported === true) === 0,
              ttftP50: median(nrOk.map((s) => s.ttftAnyMs).filter((v): v is number => v !== null)),
              ttftP95: quantile(nrOk.map((s) => s.ttftAnyMs).filter((v): v is number => v !== null), 95),
              reasoningShare: nrOut ? nrOk.reduce((a, s) => a + s.reasoningTokens, 0) / nrOut : null,
              outTokens: median(nrOk.filter((s) => s.outputTokens > 0).map((s) => s.outputTokens))
            }
          : null,
        availability: av.length
          ? { ok: count(av, (s) => s.ok), total: av.length, errors: [...new Set(av.filter((s) => !s.ok).map((s) => `${s.status} ${(s.error || '').slice(0, 90)}`))] }
          : null,
        costShortIdr: costIdr(report, model, supplier, rows.filter((s) => s.scenario === 'akurasi')),
        costLongIdr: costIdr(report, model, supplier, rows.filter((s) => s.scenario === 'jawaban-panjang'))
      });
    }

    return {
      model, suppliers,
      requests: counted.length,
      successRate: counted.length ? (counted.length - failures) / counted.length : 0,
      failures,
      ttftP50: median(ttft), ttftP95: quantile(ttft, 95),
      tokensPerSecond: speeds.length ? Math.round(median(speeds) as number) : null,
      rateLimited: count(rows, (s) => s.status === 429),
      accuracy: { right: count(acc, (s) => s.correct === true), total: acc.length },
      chart: { ok: count(chart, (s) => s.chartValid === true), total: chart.length },
      longAnswer: { intact: count(long, (s) => s.ok && !s.truncated), total: long.length },
      context: { found: count(ctx, (s) => s.factFound === true), total: ctx.length, tokens: median(ctx.filter((s) => s.inputTokens > 0).map((s) => s.inputTokens)) ?? 0 },
      reasoningShare: outTok ? done.reduce((a, s) => a + s.reasoningTokens, 0) / outTok : null,
      cheapestSupplier: cheapest,
      costShortIdr: costIdr(report, model, cheapest, rows.filter((s) => s.scenario === 'akurasi')),
      costLongIdr: costIdr(report, model, cheapest, rows.filter((s) => s.scenario === 'jawaban-panjang')),
      costUncertainty: (() => {
        const r = report.rates[model];
        if (!r?.spreadOut || !r.usdPerKOut) return null;
        return Math.round(((r.spreadOut[1] - r.spreadOut[0]) / r.usdPerKOut) * 100);
      })()
    };
  });

  const scenarioSizes = [...new Set(samples.map((s) => s.scenario))].map((name) => {
    const rows = samples.filter((s) => s.scenario === name && s.ok && s.inputTokens > 0);
    return {
      name, total: samples.filter((s) => s.scenario === name).length,
      contextTokens: median(rows.map((s) => s.inputTokens)) ?? 0,
      outputTokens: median(rows.map((s) => s.outputTokens)) ?? 0
    };
  });

  return {
    models: modelRows.sort((a, b) => (a.ttftP95 ?? Infinity) - (b.ttftP95 ?? Infinity)),
    suppliers: supplierRows.sort((a, b) => a.model.localeCompare(b.model) || a.ratio - b.ratio),
    scenarios: scenarioSizes,
    totals: {
      requests: samples.length,
      sessions: report.sessions.length,
      costUsd: report.sessions.reduce((sum, s) => sum + ((s.usageEndUsd ?? 0) - (s.usageStartUsd ?? 0)), 0),
      transportFailures: count(samples, (s) => !s.ok && s.failureKind === 'transport'),
      emptyAnswers: count(samples, (s) => s.ok && s.emptyContent)
    }
  };
}
