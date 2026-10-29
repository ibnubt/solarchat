import type { analyse, PairMetrics } from './suppliers';
import { USD_TO_IDR } from './suppliers';

type Analysis = ReturnType<typeof analyse>;

/**
 * Hanya kekurangan yang belum terbaca dari angka di kartu. Kelambatan dan kegagalan
 * sudah tampil sebagai angka, jadi tidak diulang sebagai kalimat.
 */
export const PLAIN_WARNING: Record<string, string> = {
  throughput: 'Menulis jawaban pelan',
  accuracy: 'Pernah menjawab salah',
  chart: 'Format grafik pernah tidak terbaca',
  longAnswer: 'Jawaban panjang pernah terpotong',
  longContext: 'Pernah lupa isi riwayat panjang',
  rateLimit: 'Pernah ditolak saat ramai'
};

/** Apa yang diuji, dalam ukuran yang bisa dibayangkan pembaca. */
export const WHAT_TESTED = [
  { name: 'Chat pendek', detail: 'Satu pertanyaan singkat, tanpa riwayat', scenario: 'latensi' },
  { name: 'Banyak orang sekaligus', detail: '16 permintaan dikirim serentak', scenario: 'beban' },
  { name: 'Ketepatan jawaban', detail: '40 soal yang kuncinya pasti: hitungan, penarikan data, penalaran', scenario: 'akurasi' },
  { name: 'Permintaan grafik', detail: 'Diminta membuat grafik, hasilnya diperiksa bisa dibaca aplikasi', scenario: 'format-chart' },
  { name: 'Jawaban panjang', detail: 'Diminta uraian panjang, dicek selesai atau terpotong', scenario: 'jawaban-panjang' },
  { name: 'Riwayat chat panjang', detail: 'Satu kode ditanam di awal riwayat lalu ditanyakan di akhir', scenario: 'konteks-panjang' }
];

/** Penjelasan istilah yang muncul di kartu, supaya pembaca tidak perlu menebak. */
export const HOW_TO_READ = [
  { term: 'Berhasil', text: 'Bagian permintaan yang dilayani sampai jawaban keluar. Gagal berarti ditolak server Tokenku atau sambungan putus di tengah jawaban. Gangguan jaringan di komputer penguji tidak ikut dihitung.' },
  { term: 'Waktu tunggu', text: 'TTFT: jarak dari permintaan dikirim sampai token pertama keluar. Angka yang ditampilkan adalah p95, artinya 95% permintaan lebih cepat dari itu. Model di sini berpikir dulu, jadi teks jawaban baru terbaca beberapa detik setelahnya.' },
  { term: 'Biaya 1.000 chat', text: 'Biaya mengirim 1.000 pesan chat. Satu pesan dihitung 1.500 token masuk (pertanyaan ditambah riwayat percakapan) dan 600 token jawaban. Tarifnya diukur dari tagihan sungguhan, lalu dikali pengali harga supplier.' },
  { term: 'Cadangan', text: 'Supplier lain yang juga menyediakan model ini, diurutkan dari yang paling layak dipakai bila supplier utama bermasalah.' }
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
  const totalQ = acc.reduce((s, p) => s + p.accuracyCount, 0);
  const wrong = acc.reduce((s, p) => s + Math.round((1 - (p.accuracy as number)) * p.accuracyCount), 0);

  const solo = a.chains.filter((c) => c.alternatives === 0).map((c) => c.model);
  const empty = a.pairs.reduce((s, p) => s + p.emptyAnswers, 0);

  return {
    headline: paired.length
      ? `Pakai supplier termurah untuk tiap model. Mutu jawabannya sama, jadi hemat ${saving}% itu didapat tanpa mengorbankan apa pun.`
      : 'Belum cukup data untuk menyimpulkan.',
    points: [
      {
        label: 'Mutu jawaban semua supplier sama',
        text: `Dari ${totalQ.toLocaleString('id-ID')} soal yang jawabannya bisa dicek benar-salah, ${wrong === 0 ? 'semuanya dijawab benar' : `${(totalQ - wrong).toLocaleString('id-ID')} dijawab benar dan hanya ${wrong} salah`}. Supplier murah tidak memberi jawaban yang lebih buruk.`
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
      ? `termahal ${rp(dearest.costPer1000ChatsUsd)} di ${dearest.supplier}`
      : null,
    failNote: primary.upstreamFailures > 0
      ? `${primary.upstreamFailures} gagal dari ${primary.requests} permintaan`
      : 'tidak ada yang gagal',
    // Kriteria yang angkanya sudah tampil di kartu tidak diulang sebagai peringatan.
    warnings: primary.failedCriteria.map((id) => PLAIN_WARNING[id]).filter(Boolean)
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
