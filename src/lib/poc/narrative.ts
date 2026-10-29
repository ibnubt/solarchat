import type { analyse, PairMetrics } from './suppliers';
import { USD_TO_IDR } from './suppliers';

type Analysis = ReturnType<typeof analyse>;

/** Kegagalan kriteria diterjemahkan ke kalimat yang bisa dipahami tanpa membaca definisi. */
export const PLAIN_WARNING: Record<string, string> = {
  reliability: 'pernah menolak permintaan',
  ttftAny: 'lambat mulai merespons',
  ttftContent: 'jawaban lama baru terbaca',
  throughput: 'menulis jawaban pelan',
  accuracy: 'jawaban sering salah',
  chart: 'format grafik sering salah',
  longAnswer: 'jawaban terpotong',
  longContext: 'lupa isi riwayat panjang',
  rateLimit: 'ditolak saat ramai'
};

/** Apa yang diuji, dalam ukuran yang bisa dibayangkan pembaca. */
export const WHAT_TESTED = [
  { name: 'Chat pendek', detail: 'Satu pertanyaan singkat, tanpa riwayat', scenario: 'latensi' },
  { name: 'Banyak orang sekaligus', detail: '16 permintaan dikirim serentak', scenario: 'beban' },
  { name: 'Ketepatan jawaban', detail: '40 soal yang kuncinya pasti: hitungan, penarikan data, penalaran', scenario: 'akurasi' },
  { name: 'Permintaan grafik', detail: 'Diminta membuat grafik, hasilnya diperiksa bisa dibaca aplikasi', scenario: 'format-chart' },
  { name: 'Jawaban panjang', detail: 'Diminta uraian panjang, dicek selesai atau terpotong', scenario: 'jawaban-panjang' },
  { name: 'Riwayat chat panjang', detail: 'Riwayat ±20 ribu token, satu kode ditanam di awal lalu ditanyakan di akhir', scenario: 'konteks-panjang' }
];

export const METHOD_NOTES = [
  'Harga diukur dari tagihan sungguhan, bukan dari daftar harga Tokenku yang keliru untuk sebagian model.',
  'Gangguan jaringan di komputer penguji tidak dihitung sebagai kegagalan supplier.',
  'Semua supplier menerima pertanyaan yang sama persis agar hasilnya sebanding.'
];

const rp = (usd: number | null) => (usd === null ? '—' : `Rp ${Math.round(usd * USD_TO_IDR).toLocaleString('id-ID')}`);
const dtk = (msVal: number | null) => (msVal === null ? '—' : `${(msVal / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} detik`);

/** Kesimpulan ditarik dari angka, bukan ditulis tangan. */
export function conclusion(a: Analysis) {
  const paired = a.chains.filter((c) => c.alternatives > 0);
  const saving = paired.length ? Math.round(paired.reduce((s, c) => s + c.savingPercent, 0) / paired.length) : 0;

  const withSpeed = a.pairs.filter((p) => p.ttftAnyP95 !== null);
  const fastest = withSpeed.reduce((best, p) => ((p.ttftAnyP95 as number) < (best.ttftAnyP95 as number) ? p : best), withSpeed[0]);
  const slowest = withSpeed.reduce((worst, p) => ((p.ttftAnyP95 as number) > (worst.ttftAnyP95 as number) ? p : worst), withSpeed[0]);

  const acc = a.pairs.filter((p) => p.accuracy !== null);
  const minAcc = acc.length ? Math.min(...acc.map((p) => p.accuracy as number)) : 0;

  const solo = a.chains.filter((c) => c.alternatives === 0).map((c) => c.model);
  const empty = a.pairs.reduce((s, p) => s + p.emptyAnswers, 0);

  return {
    headline: paired.length
      ? `Pakai supplier termurah untuk tiap model. Mutu jawabannya sama, jadi hemat ${saving}% itu didapat tanpa mengorbankan apa pun.`
      : 'Belum cukup data untuk menyimpulkan.',
    points: [
      {
        label: 'Mutu sama di semua supplier',
        text: `${acc.reduce((s, p) => s + p.accuracyCount, 0).toLocaleString('id-ID')} soal berkunci pasti dijawab benar minimal ${Math.round(minAcc * 100)}% di setiap supplier. Supplier murah tidak memberi model yang lebih buruk.`
      },
      {
        label: 'Hemat, tapi hanya soal harga',
        text: `Selisih harga antar supplier untuk model yang sama mencapai ${Math.max(...a.chains.map((c) => c.savingPercent))}%. Kecepatannya tidak banyak berubah, jadi pindah supplier menghemat biaya, bukan mempercepat chat.`
      },
      {
        label: 'Yang menentukan cepat-lambat adalah pilihan modelnya',
        text: `${fastest.model} mulai merespons dalam ${dtk(fastest.ttftAnyP95)}, sedangkan ${slowest.model} butuh ${dtk(slowest.ttftAnyP95)} di supplier mana pun. Untuk chat sehari-hari, pilih modelnya, bukan suppliernya.`
      },
      ...(empty
        ? [{ label: 'Perlu dibereskan di aplikasi', text: `${empty} jawaban pada uji ini keluar kosong karena jatah token habis dipakai model untuk berpikir. Pengguna akan melihatnya sebagai balasan hampa; batas token perlu dinaikkan.` }]
        : []),
      ...(solo.length
        ? [{ label: 'Satu risiko yang tersisa', text: `${solo.join(' dan ')} hanya tersedia di satu supplier. Kalau supplier itu bermasalah, model tersebut tidak punya pengganti.` }]
        : [])
    ]
  };
}

/** Alasan singkat kenapa supplier ini yang dipilih, plus peringatan dalam bahasa biasa. */
export function cardSummary(primary: PairMetrics, options: PairMetrics[]) {
  const priced = options.filter((o) => o.costPer1000ChatsUsd !== null);
  const dearest = priced.length > 1 ? priced.reduce((max, o) => ((o.costPer1000ChatsUsd as number) > (max.costPer1000ChatsUsd as number) ? o : max), priced[0]) : null;
  const isCheapest = dearest !== null && primary.costPer1000ChatsUsd !== null && primary.costPer1000ChatsUsd <= (dearest.costPer1000ChatsUsd as number);
  return {
    reason: options.length === 1
      ? 'Satu-satunya supplier yang menyediakan model ini.'
      : isCheapest
        ? 'Termurah di antara supplier yang menyediakan model ini, dengan mutu jawaban yang sama.'
        : 'Paling sedikit masalahnya di antara supplier yang menyediakan model ini.',
    comparison: dearest && dearest.supplier !== primary.supplier
      ? `Termahal: ${rp(dearest.costPer1000ChatsUsd)} di ${dearest.supplier}`
      : null,
    warnings: primary.failedCriteria.map((id) => PLAIN_WARNING[id] ?? id)
  };
}

export function limitations(a: Analysis): string[] {
  return [
    `Diuji ${a.totals.sessions} kali pada satu rentang waktu, jadi belum terlihat bedanya jam sibuk dan jam sepi.`,
    'Angka kecepatan cukup untuk membandingkan supplier, belum cukup untuk dijadikan janji layanan.',
    'Keramaian diuji sampai 16 permintaan serentak, sesuai pemakaian internal.',
    'Biaya dihitung untuk percakapan berukuran sedang; percakapan dengan riwayat lebih panjang akan lebih mahal.',
    'Jawaban panjang dinilai selesai atau terpotong, bukan bagus atau tidaknya isi.'
  ];
}
