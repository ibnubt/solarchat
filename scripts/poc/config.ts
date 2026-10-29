export type Supplier = 'ChinaLLM' | 'Enterprise' | 'OpenSourceLLM' | 'Official' | 'Creator';

/** Pengali harga grup Tokenku (dari /api/user/groups, dicatat 2026-10-29). */
export const SUPPLIER_RATIO: Record<Supplier, number> = {
  ChinaLLM: 0.75, Enterprise: 0.8, OpenSourceLLM: 0.95, Creator: 1.05, Official: 1.1
};

/** Supplier yang melayani tiap model, diverifikasi lewat /v1/models tiap kunci. */
export const MATRIX: Array<{ model: string; suppliers: Supplier[] }> = [
  { model: 'glm-5.3-flash', suppliers: ['ChinaLLM', 'Enterprise', 'OpenSourceLLM', 'Official'] },
  { model: 'deepseek-v4-flash', suppliers: ['ChinaLLM', 'Enterprise', 'OpenSourceLLM', 'Official'] },
  { model: 'deepseek-v4-1-flash', suppliers: ['ChinaLLM', 'Enterprise', 'OpenSourceLLM', 'Official'] },
  { model: 'gemini-2.5-flash', suppliers: ['Creator', 'Enterprise'] },
  { model: 'gpt-5.6-luna', suppliers: ['Enterprise'] },
  { model: 'doubao-seed-2-0-mini-260428', suppliers: ['Creator'] }
];

/**
 * Jumlah request per pasangan per sesi. Model di sini adalah model penalar yang memakai
 * 6-22 detik per permintaan, jadi batasnya waktu, bukan biaya. Model dengan banyak supplier
 * diberi sampel lebih besar karena di situlah perbandingannya terjadi.
 */
export const PLAN = { latency: 50, load: 32, accuracy: 40, chart: 8, longAnswer: 3, longContext: 5 } as const;
export const PLAN_SINGLE = { latency: 20, load: 16, accuracy: 40, chart: 5, longAnswer: 2, longContext: 3 } as const;

/** Batas token; model penalar butuh ruang agar jawabannya tidak habis dipakai menalar. */
export const MAX_TOKENS = { latency: 512, load: 512, accuracy: 1024, chart: 1024, longContext: 512 } as const;

export const LOAD_WAVE = 16;
export const LONG_ANSWER_MAX_TOKENS = 16_384;
export const LONG_CONTEXT_TARGET_TOKENS = 20_000;

/** Kriteria lulus, ditetapkan sebelum uji dijalankan. */
export const CRITERIA = [
  { id: 'reliability', label: 'Keandalan', detail: 'Tanpa kegagalan pada seluruh request pasangan ini' },
  { id: 'ttftAny', label: 'Respons pertama', detail: 'p95 token pertama (termasuk penalaran) <= 3.000 ms' },
  { id: 'ttftContent', label: 'Teks pertama', detail: 'p95 teks jawaban pertama <= 10.000 ms' },
  { id: 'throughput', label: 'Kecepatan', detail: 'Median token/detik >= 30' },
  { id: 'accuracy', label: 'Akurasi', detail: 'Jawaban benar >= 90% pada soal berjawaban pasti' },
  { id: 'chart', label: 'Kepatuhan format', detail: 'JSON blok chart valid >= 90%' },
  { id: 'longAnswer', label: 'Jawaban utuh', detail: 'Tidak ada jawaban terpotong oleh batas panjang' },
  { id: 'longContext', label: 'Konteks panjang', detail: 'Fakta tertanam pada konteks ~20k token ditemukan 100%' },
  { id: 'rateLimit', label: 'Tanpa 429', detail: 'Tidak ada penolakan rate limit pada beban bersamaan' }
] as const;

/**
 * Ambang ditetapkan dari sisi pengalaman pengguna, bukan dari angka yang kebetulan lolos:
 * indikator harus bergerak dalam 3 detik, teks jawaban mulai terbaca dalam 10 detik.
 */
export const THRESHOLD = { ttftAnyP95Ms: 3000, ttftContentP95Ms: 10_000, tokensPerSecond: 30, accuracy: 0.9, chart: 0.9 };

/** Batas belanja; runner berhenti bila terlampaui (diukur lewat endpoint tagihan). */
export const BUDGET_USD = 8;
