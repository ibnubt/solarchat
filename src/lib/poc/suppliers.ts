/** Skema laporan perbandingan supplier (schemaVersion 2) dan perhitungan turunannya. */

export type Sample = {
  session: string; model: string; supplier: string; scenario: string; index: number;
  ok: boolean; status: number; error?: string;
  failureKind?: 'upstream' | 'transport'; transportRetries?: number;
  ttftAnyMs: number | null; ttftMs: number | null; latencyMs: number;
  inputTokens: number; outputTokens: number; reasoningTokens: number;
  finishReason: string; emptyContent: boolean;
  correct?: boolean; chartValid?: boolean; factFound?: boolean; truncated?: boolean;
  answerPreview?: string;
};

export type SupplierReport = {
  schemaVersion: 2;
  criteria: ReadonlyArray<{ id: string; label: string; detail: string }>;
  threshold: { ttftAnyP95Ms: number; ttftContentP95Ms: number; tokensPerSecond: number; accuracy: number; chart: number };
  supplierRatio: Record<string, number>;
  sessions: Array<{ id: string; startedAt: string; usageStartUsd: number | null; usageEndUsd: number | null }>;
  rates: Record<string, { usdPerKIn: number; usdPerKOut: number; samples: number }>;
  /** Satu contoh nyata per skenario: badan permintaan dan jawaban apa adanya. */
  examples?: Array<{
    scenario: string; model: string; supplier: string; judge: string;
    request: Record<string, unknown>;
    response: { finish_reason: string; prompt_tokens: number; completion_tokens: number; reasoning_tokens: number; latency_ms: number; ttft_any_ms: number | null; ttft_content_ms: number | null; content: string };
  }>;
  samples: Sample[];
};

/** Satu giliran percakapan khas dipakai menghitung biaya; dicantumkan di laporan agar bisa diperiksa. */
export const CHAT_PROFILE = { inputTokens: 1500, outputTokens: 600 };
export const USD_TO_IDR = 16_500;

export type Verdict = 'lulus' | 'gagal' | 'tak-diuji';

export type PairMetrics = {
  model: string;
  supplier: string;
  requests: number;
  /** Kegagalan jaringan sisi penguji dikeluarkan: itu bukan cacat supplier. */
  transportFailures: number;
  upstreamFailures: number;
  reliability: number;
  ttftAnyP50: number | null; ttftAnyP95: number | null;
  ttftContentP50: number | null; ttftContentP95: number | null;
  tokensPerSecond: number | null;
  accuracy: number | null; accuracyCount: number;
  chartValid: number | null;
  factFound: number | null;
  truncated: number;
  rateLimited: number;
  emptyAnswers: number;
  costPer1000ChatsUsd: number | null;
  verdicts: Record<string, Verdict>;
  passed: number;
  failedCriteria: string[];
};

const quantile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * (p / 100);
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] === undefined ? sorted[base] : Math.round(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
};

const median = (values: number[]) => quantile(values, 50);
const share = (rows: unknown[], hit: (row: never) => boolean) =>
  rows.length ? rows.filter(hit as (row: unknown) => boolean).length / rows.length : null;

export function pairKey(model: string, supplier: string) {
  return `${model}::${supplier}`;
}

export function analysePair(report: SupplierReport, model: string, supplier: string, samples: Sample[]): PairMetrics {
  const scenario = (name: string) => samples.filter((s) => s.scenario === name);
  const transportFailures = samples.filter((s) => !s.ok && s.failureKind === 'transport').length;
  const counted = samples.filter((s) => s.ok || s.failureKind !== 'transport');
  const upstreamFailures = counted.filter((s) => !s.ok).length;
  const reliability = counted.length ? (counted.length - upstreamFailures) / counted.length : 0;

  const latency = scenario('latensi').filter((s) => s.ok);
  const ttftAny = latency.map((s) => s.ttftAnyMs).filter((v): v is number => v !== null);
  const ttftContent = latency.map((s) => s.ttftMs).filter((v): v is number => v !== null);

  // Model penalar memancarkan token nalar sebelum teks jawaban, jadi laju dihitung sejak token pertama apa pun.
  // Jawaban sangat pendek dibuang: membagi 5 token dengan jendela beberapa milidetik menghasilkan laju semu.
  const rates = samples
    .filter((s) => s.ok && s.outputTokens >= 100 && s.ttftAnyMs !== null && s.latencyMs > s.ttftAnyMs + 200)
    .map((s) => s.outputTokens / ((s.latencyMs - (s.ttftAnyMs as number)) / 1000));

  const accuracy = scenario('akurasi');
  const chart = scenario('format-chart');
  const context = scenario('konteks-panjang');
  const long = scenario('jawaban-panjang');

  const rate = report.rates[model];
  const ratio = report.supplierRatio[supplier] ?? 1;
  const costPer1000ChatsUsd = rate
    ? ((CHAT_PROFILE.inputTokens / 1000) * rate.usdPerKIn + (CHAT_PROFILE.outputTokens / 1000) * rate.usdPerKOut) * ratio * 1000
    : null;

  const t = report.threshold;
  const metrics = {
    model, supplier,
    requests: samples.length,
    transportFailures, upstreamFailures, reliability,
    ttftAnyP50: median(ttftAny), ttftAnyP95: quantile(ttftAny, 95),
    ttftContentP50: median(ttftContent), ttftContentP95: quantile(ttftContent, 95),
    tokensPerSecond: rates.length ? Math.round((median(rates) as number) * 10) / 10 : null,
    accuracy: share(accuracy, (s: Sample) => s.correct === true),
    accuracyCount: accuracy.length,
    chartValid: share(chart, (s: Sample) => s.chartValid === true),
    factFound: share(context, (s: Sample) => s.factFound === true),
    truncated: long.filter((s) => s.truncated).length,
    rateLimited: samples.filter((s) => s.status === 429).length,
    emptyAnswers: samples.filter((s) => s.ok && s.emptyContent).length,
    costPer1000ChatsUsd
  };

  const check = (value: boolean | null): Verdict => (value === null ? 'tak-diuji' : value ? 'lulus' : 'gagal');
  const verdicts: Record<string, Verdict> = {
    reliability: check(upstreamFailures === 0),
    ttftAny: check(metrics.ttftAnyP95 === null ? null : metrics.ttftAnyP95 <= t.ttftAnyP95Ms),
    ttftContent: check(metrics.ttftContentP95 === null ? null : metrics.ttftContentP95 <= t.ttftContentP95Ms),
    throughput: check(metrics.tokensPerSecond === null ? null : metrics.tokensPerSecond >= t.tokensPerSecond),
    accuracy: check(metrics.accuracy === null ? null : metrics.accuracy >= t.accuracy),
    chart: check(metrics.chartValid === null ? null : metrics.chartValid >= t.chart),
    longAnswer: check(long.length ? metrics.truncated === 0 : null),
    longContext: check(metrics.factFound === null ? null : metrics.factFound === 1),
    rateLimit: check(metrics.rateLimited === 0)
  };
  const failedCriteria = Object.entries(verdicts).filter(([, v]) => v === 'gagal').map(([k]) => k);
  return { ...metrics, verdicts, passed: Object.values(verdicts).filter((v) => v === 'lulus').length, failedCriteria };
}

export function analyse(report: SupplierReport) {
  const groups = new Map<string, Sample[]>();
  for (const sample of report.samples) {
    const key = pairKey(sample.model, sample.supplier);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(sample);
  }
  const pairs = [...groups.entries()].map(([key, samples]) => {
    const [model, supplier] = key.split('::');
    return analysePair(report, model, supplier, samples);
  });

  const models = [...new Set(pairs.map((p) => p.model))].sort();
  /** Urutan cadangan: yang lolos semua kriteria didahulukan, lalu termurah, lalu paling responsif. */
  const chains = models.map((model) => {
    const options = pairs.filter((p) => p.model === model).sort((a, b) => {
      if (a.failedCriteria.length !== b.failedCriteria.length) return a.failedCriteria.length - b.failedCriteria.length;
      const costA = a.costPer1000ChatsUsd ?? Infinity;
      const costB = b.costPer1000ChatsUsd ?? Infinity;
      if (Math.abs(costA - costB) > 1e-9) return costA - costB;
      return (a.ttftAnyP95 ?? Infinity) - (b.ttftAnyP95 ?? Infinity);
    });
    const cheapest = options[0]?.costPer1000ChatsUsd ?? null;
    const dearest = Math.max(...options.map((o) => o.costPer1000ChatsUsd ?? 0));
    return {
      model,
      chain: options.map((o) => o.supplier),
      primary: options[0],
      alternatives: options.length - 1,
      savingPercent: cheapest !== null && dearest > 0 ? Math.round((1 - cheapest / dearest) * 100) : 0
    };
  });

  const totalCost = report.sessions.reduce((sum, s) => sum + ((s.usageEndUsd ?? 0) - (s.usageStartUsd ?? 0)), 0);

  const findings = buildFindings(pairs, chains);
  // Jumlah permintaan per skenario, untuk tabel cara uji.
  const scenarios = new Map<string, { total: number; perPair: number }>();
  for (const sample of report.samples) {
    const row = scenarios.get(sample.scenario) ?? { total: 0, perPair: 0 };
    row.total += 1;
    scenarios.set(sample.scenario, row);
  }
  const pairCount = Math.max(pairs.length, 1);
  for (const row of scenarios.values()) row.perPair = Math.round(row.total / pairCount);
  // Ukuran konteks tiap skenario diambil dari token masukan yang benar-benar terkirim.
  const contextTokens = new Map<string, number>();
  for (const [name] of scenarios) {
    const sizes = report.samples.filter((s) => s.scenario === name && s.ok && s.inputTokens > 0).map((s) => s.inputTokens);
    contextTokens.set(name, sizes.length ? (median(sizes) as number) : 0);
  }

  return {
    findings,
    scenarios: [...scenarios.entries()].map(([name, v]) => ({ name, ...v, contextTokens: contextTokens.get(name) ?? 0 })),
    pairs: pairs.sort((a, b) => a.model.localeCompare(b.model) || a.supplier.localeCompare(b.supplier)),
    models,
    chains,
    totals: {
      requests: report.samples.length,
      sessions: report.sessions.length,
      costUsd: totalCost,
      transportFailures: report.samples.filter((s) => !s.ok && s.failureKind === 'transport').length
    }
  };
}

export type Finding = { tone: 'baik' | 'perhatian' | 'risiko'; text: string };

const rp = (usd: number) => `Rp ${Math.round(usd * USD_TO_IDR).toLocaleString('id-ID')}`;

/** Temuan ditarik dari angka, bukan ditulis tangan, supaya ikut berubah saat data bertambah. */
function buildFindings(pairs: PairMetrics[], chains: ReturnType<typeof analyse>['chains']): Finding[] {
  const out: Finding[] = [];

  // Supplier mana yang paling sering terpilih sebagai pilihan utama.
  const wins = new Map<string, number>();
  for (const c of chains) wins.set(c.primary.supplier, (wins.get(c.primary.supplier) ?? 0) + 1);
  const best = [...wins.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) out.push({ tone: 'baik', text: `${best[0]} terpilih sebagai pilihan utama pada ${best[1]} dari ${chains.length} model yang diuji.` });

  // Selisih harga terbesar untuk model yang sama.
  let gap: { model: string; cheap: PairMetrics; dear: PairMetrics; percent: number } | null = null;
  for (const c of chains) {
    const options = pairs.filter((p) => p.model === c.model && p.costPer1000ChatsUsd !== null);
    if (options.length < 2) continue;
    const sorted = [...options].sort((a, b) => (a.costPer1000ChatsUsd as number) - (b.costPer1000ChatsUsd as number));
    const cheap = sorted[0];
    const dear = sorted[sorted.length - 1];
    const percent = Math.round((1 - (cheap.costPer1000ChatsUsd as number) / (dear.costPer1000ChatsUsd as number)) * 100);
    if (!gap || percent > gap.percent) gap = { model: c.model, cheap, dear, percent };
  }
  if (gap) {
    out.push({
      tone: 'baik',
      text: `Model yang sama bisa berbeda harga ${gap.percent}% antar supplier. Pada ${gap.model}, ${gap.cheap.supplier} menagih ${rp(gap.cheap.costPer1000ChatsUsd as number)} per 1.000 percakapan sementara ${gap.dear.supplier} ${rp(gap.dear.costPer1000ChatsUsd as number)}.`
    });
  }

  // Model tanpa cadangan adalah titik tunggal kegagalan.
  const solo = chains.filter((c) => c.alternatives === 0).map((c) => c.model);
  if (solo.length) out.push({ tone: 'risiko', text: `${solo.join(' dan ')} hanya dilayani satu supplier, sehingga tidak punya cadangan bila supplier itu bermasalah.` });

  // Pilihan utama yang sendirinya belum memenuhi kriteria.
  const weak = chains.filter((c) => c.primary.failedCriteria.length > 0);
  if (weak.length) out.push({ tone: 'perhatian', text: `Pada ${weak.length} dari ${chains.length} model, bahkan supplier terbaiknya belum memenuhi seluruh kriteria; pilihan diambil sebagai yang paling tidak buruk.` });

  // Kecepatan: apakah perbedaan antar supplier cukup berarti untuk dijadikan dasar memilih.
  for (const c of chains) {
    const options = pairs.filter((p) => p.model === c.model && p.ttftAnyP95 !== null);
    if (options.length < 2) continue;
    const fast = Math.min(...options.map((o) => o.ttftAnyP95 as number));
    const slow = Math.max(...options.map((o) => o.ttftAnyP95 as number));
    if (slow > fast * 1.5) {
      const fastName = options.find((o) => o.ttftAnyP95 === fast)?.supplier;
      const slowName = options.find((o) => o.ttftAnyP95 === slow)?.supplier;
      out.push({ tone: 'perhatian', text: `Pada ${c.model}, ${fastName} memberi token pertama ${(slow / fast).toFixed(1)} kali lebih cepat daripada ${slowName} (${(fast / 1000).toFixed(1)} dibanding ${(slow / 1000).toFixed(1)} detik, p95).` });
      break;
    }
  }

  // Keandalan: pasangan yang menolak permintaan.
  const unreliable = pairs.filter((p) => p.upstreamFailures > 0).sort((a, b) => b.upstreamFailures - a.upstreamFailures);
  if (unreliable.length) {
    const worst = unreliable[0];
    out.push({ tone: 'risiko', text: `${unreliable.length} pasangan menolak sebagian permintaan. Terburuk ${worst.model} di ${worst.supplier} dengan ${worst.upstreamFailures} kegagalan dari ${worst.requests} permintaan.` });
  }

  // Apakah supplier murah menyajikan model dengan mutu lebih rendah.
  const graded = pairs.filter((p) => p.accuracy !== null && p.accuracyCount > 0);
  if (graded.length >= 2) {
    const lowest = Math.min(...graded.map((p) => p.accuracy as number));
    const totalQuestions = graded.reduce((sum, p) => sum + p.accuracyCount, 0);
    if (lowest >= 0.95) {
      out.push({
        tone: 'baik',
        text: `Tidak ditemukan selisih mutu antar supplier: ${totalQuestions.toLocaleString('id-ID')} soal berjawaban pasti dijawab benar minimal ${Math.round(lowest * 100)}% di setiap supplier, jadi yang murah tidak menyajikan model yang diturunkan.`
      });
    } else {
      const worst = graded.sort((a, b) => (a.accuracy as number) - (b.accuracy as number))[0];
      out.push({ tone: 'risiko', text: `${worst.supplier} hanya menjawab benar ${Math.round((worst.accuracy as number) * 100)}% pada ${worst.model}, jauh di bawah supplier lain; mutu modelnya patut dicurigai.` });
    }
  }

  // Jawaban kosong karena jatah token habis dipakai menalar.
  const empty = pairs.reduce((sum, p) => sum + p.emptyAnswers, 0);
  if (empty) out.push({ tone: 'perhatian', text: `${empty} jawaban keluar kosong karena seluruh jatah token habis dipakai menalar; aplikasi perlu memberi batas token yang cukup longgar.` });

  return out;
}
