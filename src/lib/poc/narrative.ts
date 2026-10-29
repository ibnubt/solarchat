/** Keterangan metode yang perlu diketahui pembaca agar angkanya bisa ditimbang. Ditulis ringkas. */
import type { analyse } from './suppliers';

export const PURPOSE =
  'Supplier Tokenku mana yang dipakai untuk tiap model, dan apa urutan cadangannya. Model yang sama diadu antar supplier karena harganya berbeda sampai 32%.';

/** Keputusan metode yang mengubah angka, jadi harus diketahui pembaca. */
export const METHOD_NOTES = [
  'Harga diukur dari selisih tagihan akun, bukan dari daftar harga Tokenku yang keliru untuk sebagian model.',
  'Kegagalan jaringan sisi penguji dikeluarkan dari angka keandalan; hanya penolakan Tokenku yang dihitung.',
  'Waktu respons dipisah dua karena model menalar sebelum menjawab: token pertama apa pun, dan teks jawaban pertama.',
  'Uji latensi berurutan per model, supplier paralel, agar antrean penguji tidak terhitung sebagai kelambatan supplier.'
];

export function limitations(analysis: ReturnType<typeof analyse>): string[] {
  return [
    `${analysis.totals.sessions} sesi pada satu rentang waktu; perbedaan jam sibuk belum tercakup.`,
    'p95 dari 50 sampel latensi per pasangan: cukup untuk membandingkan, belum cukup untuk janji layanan.',
    'Beban diuji sampai 16 permintaan serentak, sesuai pemakaian internal.',
    'Biaya memakai satu profil percakapan yang dicantumkan di bawah grafik.',
    'Jawaban panjang dinilai keutuhannya, bukan isinya.',
    'Volc_intl tidak diuji karena tidak melayani satu pun model aplikasi.'
  ];
}

export function nextSteps(analysis: ReturnType<typeof analyse>): string[] {
  const solo = analysis.chains.filter((c) => c.alternatives === 0).map((c) => c.model);
  const empty = analysis.pairs.reduce((sum, p) => sum + p.emptyAnswers, 0);
  const out = [
    'Pasang pemilihan supplier berurutan sesuai rantai di bagian keputusan, pindah hanya sebelum token pertama keluar.',
    'Jalankan sesi kedua pada jam berbeda untuk menguji apakah peringkat bertahan.'
  ];
  if (empty) out.unshift(`Naikkan batas token: ${empty} jawaban pada uji ini keluar kosong karena jatah token habis dipakai menalar.`);
  if (solo.length) out.push(`${solo.join(' dan ')} tidak punya cadangan; timbang ulang atau terima risikonya.`);
  return out;
}
