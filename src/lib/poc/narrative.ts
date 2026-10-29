import type { summarise } from './results';

/** Batasan uji yang memengaruhi cara membaca angkanya. */
export function limitations(s: ReturnType<typeof summarise>): string[] {
  return [
    `Diuji ${s.totals.sessions} kali pada satu rentang waktu. Perbedaan jam sibuk dan jam sepi belum terukur.`,
    'Waktu tunggu p95 dihitung dari 20 sampai 200 sampel per model; cukup untuk membandingkan, belum untuk janji layanan.',
    'Beban diuji sampai 16 permintaan serentak.',
    `Uji chat pendek membatasi keluaran 512 token. Model yang berpikir panjang menghabiskannya sebelum menulis, sehingga ${s.totals.emptyAnswers} jawaban kosong. Aplikasi memakai batas 16.384 token.`,
    'Jawaban panjang dinilai selesai atau terpotong, bukan mutu isinya.',
    'Tarif per token diukur dari tagihan akun yang juga dipakai aplikasi, jadi bisa tercampur pemakaian lain. Tiap model diukur 3 putaran; angka ± pada kolom biaya adalah rentang antar putaran.',
    `${s.totals.transportFailures} permintaan gagal karena jaringan komputer penguji dan tidak dihitung sebagai kegagalan supplier.`
  ];
}

/** Catatan tentang kegagalan yang pernah dialami pengguna di luar uji ini, dan apa yang terlihat dari data. */
export const INCIDENT_NOTES = [
  'Pesan "Failed to get available channel for model deepseek-v4-flash under group ChinaLLM" (28 Sep 2026) berasal dari distributor Tokenku: saat itu grup ChinaLLM tidak punya satu pun jalur upstream aktif untuk model itu. Kuncinya valid, modelnya ada, tetapi tidak ada yang melayani. Kejadian seperti ini sesaat dan tidak terlihat pada uji singkat; probe ketersediaan per 2 menit dipasang untuk menangkapnya.',
  'Gagal sambung dari agent biasanya salah satu dari: waktu tunggu yang panjang (model penalar bisa 30–47 detik sebelum token pertama, sementara klien sering memutus di 30 detik), 503 "upstream temporarily unavailable" seperti yang terjadi pada gemini-2.5-flash di kedua supplier, atau pesan di atas. Ketiganya ditangani dengan batas waktu ≥120 detik, ulang 1–2 kali, lalu pindah ke supplier berikutnya.'
];
