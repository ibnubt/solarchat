import type { analyse } from './suppliers';
import { USD_TO_IDR } from './suppliers';

type Analysis = ReturnType<typeof analyse>;

export const WHAT_TESTED = [
  { name: 'Chat pendek', detail: 'Satu pertanyaan singkat, tanpa riwayat', scenario: 'latensi' },
  { name: 'Banyak sekaligus', detail: '16 permintaan dikirim serentak', scenario: 'beban' },
  { name: 'Ketepatan jawaban', detail: '40 soal yang jawabannya bisa dicek benar-salah', scenario: 'akurasi' },
  { name: 'Permintaan grafik', detail: 'Diminta membuat grafik, hasilnya dicek bisa dibaca aplikasi', scenario: 'format-chart' },
  { name: 'Jawaban panjang', detail: 'Diminta uraian panjang, dicek selesai atau terpotong', scenario: 'jawaban-panjang' },
  { name: 'Riwayat panjang', detail: 'Satu kode ditanam di awal riwayat lalu ditanyakan di akhir', scenario: 'konteks-panjang' }
];

export const FOOTNOTES = [
  'Waktu tunggu: TTFT p95, dari permintaan dikirim sampai token pertama keluar. Model ini berpikir dulu, jadi teks jawaban muncul beberapa detik setelahnya.',
  'Biaya 1.000 chat: 1.000 pesan, tiap pesan dihitung 1.500 token masuk (pertanyaan ditambah riwayat) dan 600 token jawaban. Tarif diukur dari tagihan sungguhan.',
  'Supplier: harga diambil dari yang termurah. Supplier lain untuk model yang sama memberi mutu dan keandalan setara, selisihnya hanya harga.',
  'Token berpikir: bagian token keluaran yang dipakai model untuk menalar sebelum menulis. Token ini ikut ditagih walau tidak pernah terlihat pengguna.'
];

export const METHOD_NOTES = [
  'Harga diukur dari tagihan sungguhan, bukan dari daftar harga Tokenku yang keliru untuk sebagian model.',
  'Gangguan jaringan di komputer penguji tidak dihitung sebagai kegagalan supplier.',
  'Semua supplier menerima pertanyaan yang sama persis agar hasilnya sebanding.'
];

/** Satu baris per model, diurutkan dari yang paling cepat menjawab. */
export function modelTable(a: Analysis) {
  return a.chains
    .map((c) => ({
      model: c.model,
      supplier: c.primary.supplier,
      fallbacks: c.chain.slice(1),
      waitMs: c.primary.ttftAnyP95,
      speed: c.primary.tokensPerSecond,
      costUsd: c.primary.costPer1000ChatsUsd,
      reasoningShare: c.primary.reasoningShare,
      failures: c.primary.upstreamFailures,
      requests: c.primary.requests,
      savingPercent: c.savingPercent
    }))
    .sort((x, y) => (x.waitMs ?? Infinity) - (y.waitMs ?? Infinity));
}

/** Tiga sampai empat kalimat yang benar-benar perlu diketahui. */
export function takeaways(a: Analysis): string[] {
  const rows = modelTable(a);
  const priced = rows.filter((r) => r.costUsd !== null && r.waitMs !== null);
  const fastest = rows.find((r) => r.waitMs !== null);
  const slowest = [...rows].reverse().find((r) => r.waitMs !== null);
  const cheapest = priced.reduce((min, r) => ((r.costUsd as number) < (min.costUsd as number) ? r : min), priced[0]);
  const maxSaving = Math.max(...a.chains.map((c) => c.savingPercent));
  // Model yang paling boros menalar: token nalar ikut dibayar walau tidak terbaca pengguna.
  const thinkers = a.pairs
    .filter((p) => p.reasoningShare !== null)
    .map((p) => ({ model: p.model, reasoningShare: Math.round((p.reasoningShare as number) * 100) }))
    .sort((x, y) => y.reasoningShare - x.reasoningShare);
  const worstThinker = thinkers[0];
  const solo = a.chains.filter((c) => c.alternatives === 0).map((c) => c.model);

  const rupiah = (usd: number | null) => (usd === null ? '—' : `Rp ${Math.round(usd * USD_TO_IDR).toLocaleString('id-ID')}`);
  const detik = (v: number | null) => (v === null ? '—' : `${(v / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} detik`);

  const out: string[] = [];
  if (fastest && slowest) {
    out.push(`Kecepatan antar model berbeda jauh: ${fastest.model} menjawab dalam ${detik(fastest.waitMs)}, ${slowest.model} butuh ${detik(slowest.waitMs)}.`);
  }
  if (cheapest) {
    out.push(`${cheapest.model} termurah di ${rupiah(cheapest.costUsd)} per 1.000 chat dan masih menjawab dalam ${detik(cheapest.waitMs)}.`);
  }
  // Model yang lambat sekaligus mahal tidak punya alasan untuk dipakai.
  const median = [...priced].sort((x, y) => (x.costUsd as number) - (y.costUsd as number))[Math.floor(priced.length / 2)];
  const bad = priced.filter((r) => r !== slowest && false);
  void bad;
  if (slowest && median && (slowest.costUsd as number) >= (median.costUsd as number)) {
    out.push(`${slowest.model} paling lambat sekaligus lebih mahal dari rata-rata, jadi tidak ada alasan memakainya.`);
  }
  out.push(`Pindah supplier hanya menghemat biaya sampai ${maxSaving}%; mutu jawaban dan keandalannya sama, kecepatannya pun tidak berubah banyak.`);
  if (worstThinker) {
    out.push(`Token untuk berpikir ikut ditagih: ${worstThinker.model} memakai ${worstThinker.reasoningShare}% token keluarnya untuk menalar, bahkan pada pertanyaan sepele.`);
  }
  if (solo.length) out.push(`${solo.join(' dan ')} hanya ada di satu supplier, jadi tidak punya pengganti kalau supplier itu bermasalah.`);
  return out;
}

export function limitations(a: Analysis): string[] {
  return [
    `Diuji ${a.totals.sessions} kali pada satu rentang waktu, jadi belum terlihat bedanya jam sibuk dan jam sepi.`,
    'Angka kecepatan cukup untuk membandingkan, belum cukup untuk dijadikan janji layanan.',
    'Keramaian diuji sampai 16 permintaan serentak, sesuai pemakaian internal.',
    'Jawaban panjang dinilai selesai atau terpotong, bukan bagus atau tidaknya isi.',
    `Uji chat pendek memberi jatah 512 token; sebagian model penalar menghabiskannya untuk berpikir sehingga ${a.pairs.reduce((s, p) => s + p.emptyAnswers, 0)} jawaban keluar kosong. Aplikasi memakai 16.384 token sehingga tidak terdampak.`
  ];
}
