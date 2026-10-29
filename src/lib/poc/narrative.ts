/**
 * Riwayat pengujian: langkah yang ditempuh, masalah yang muncul, dan koreksinya.
 * Ditulis untuk pembaca yang tidak ikut mengerjakan, sehingga hasilnya bisa ditimbang,
 * diulang, atau dibantah tanpa harus bertanya kepada pelaksananya.
 */
import type { analyse } from './suppliers';

export type Step = { no: number; title: string; body: string; evidence?: string };
export type Correction = { problem: string; impact: string; fix: string };

export const PURPOSE = {
  question: 'Supplier Tokenku mana yang sebaiknya dipakai SOLAR Chat untuk tiap model, dan bagaimana urutan cadangannya bila satu supplier bermasalah?',
  why: 'Tokenku menyalurkan model yang sama lewat beberapa supplier dengan harga berbeda sampai 32%. Tanpa pembanding, angka kecepatan atau keandalan tidak bisa dinilai bagus atau buruk. Laporan sebelumnya mengukur satu endpoint tanpa pembanding apa pun, sehingga tidak dapat menuntun keputusan.',
  scope: 'Enam model yang dipakai aplikasi, pada setiap supplier yang melayaninya. Volc_intl tidak ikut karena tidak melayani satu pun model aplikasi dan model termurahnya berharga seribu kali lipat model lain.'
};

export function steps(analysis: ReturnType<typeof analyse>): Step[] {
  const pairs = analysis.pairs.length;
  const requests = analysis.totals.requests.toLocaleString('id-ID');
  return [
    {
      no: 1,
      title: 'Mencari cara memilih supplier lewat API',
      body: 'Diuji empat cara yang lazim dipakai gateway sejenis: header khusus, field pada badan permintaan, parameter pada alamat, dan akhiran pada nama model. Tiga cara pertama diterima dengan status 200 tetapi diabaikan — nama supplier yang sengaja dibuat ngawur pun tetap dilayani. Akhiran pada nama model ditolak dengan status 400.',
      evidence: 'Kesimpulan: supplier menempel pada kunci API, jadi failover hanya mungkin dengan menyimpan satu kunci per supplier.'
    },
    {
      no: 2,
      title: 'Memetakan supplier mana melayani model mana',
      body: 'Daftar model ditarik dari tiap kunci. Jumlah model yang terlihat cocok persis dengan ukuran grupnya, yang membuktikan tiap kunci memang terkunci pada satu supplier. Dari peta itu diperoleh pasangan model-supplier yang bisa diadu.',
      evidence: `${pairs} pasangan model-supplier masuk pengujian.`
    },
    {
      no: 3,
      title: 'Menetapkan kriteria lulus sebelum uji dijalankan',
      body: 'Ambang ditetapkan dari sisi pengalaman pengguna, bukan dari angka yang kebetulan lolos: indikator harus bergerak dalam 3 detik, teks jawaban mulai terbaca dalam 10 detik, jawaban tidak boleh terpotong, dan konteks dua puluh ribu token harus benar-benar terbaca. Kriteria ini dikunci di berkas konfigurasi sebelum permintaan pertama dikirim.',
      evidence: 'Laporan lama menandai "berhasil" hanya berdasarkan status 200, tanpa target yang harus dicapai.'
    },
    {
      no: 4,
      title: 'Mengukur harga sebenarnya',
      body: 'Daftar harga Tokenku ternyata tidak dapat dipercaya untuk sebagian model. Karena itu tarif tiap model diukur langsung: dua profil permintaan dengan komposisi token berbeda dikirim, selisih tagihan akun dibaca sebelum dan sesudahnya, lalu tarif masukan dan keluaran dihitung dari dua persamaan itu.',
      evidence: 'Untuk glm-5.3-flash hasil ukur dan daftar harga sejalan, yang menunjukkan metodenya benar; untuk deepseek-v4-1-flash keduanya berbeda jauh.'
    },
    {
      no: 5,
      title: 'Menyusun bahan uji yang bisa dinilai benar-salah',
      body: 'Akurasi diuji dengan soal berjawaban pasti sehingga penilaiannya tidak bergantung pendapat: aritmetika, penarikan data dari teks, klasifikasi, dan penalaran bertahap. Kepatuhan format diuji dengan meminta blok grafik dan memeriksa apakah JSON-nya benar-benar terbaca. Kapasitas konteks diuji dengan menanam satu kode di awal riwayat sepanjang dua puluh ribu token lalu menanyakannya di akhir — ini menangkap supplier yang diam-diam memotong konteks, yang tidak akan terlihat bila hanya memeriksa permintaan diterima atau ditolak.',
      evidence: 'Setiap supplier menerima soal yang sama persis agar hasilnya sebanding.'
    },
    {
      no: 6,
      title: 'Uji asap untuk memeriksa alat ukurnya sendiri',
      body: 'Sebelum skala penuh, seluruh rangkaian dijalankan dalam ukuran kecil. Dari sinilah ketahuan sebagian kegagalan berasal dari komputer penguji, bukan dari Tokenku, dan beberapa kunci jawaban yang saya susun sendiri ternyata salah. Keduanya diperbaiki sebelum data sungguhan diambil.',
      evidence: 'Tanpa langkah ini, laporan akan menyalahkan supplier atas kesalahan penguji.'
    },
    {
      no: 7,
      title: 'Menjalankan pengujian',
      body: 'Uji latensi dijalankan model demi model secara berurutan dengan supplier berjalan paralel, supaya antrean di sisi penguji tidak terhitung sebagai kelambatan supplier. Uji lain yang tidak sensitif terhadap waktu dijalankan paralel penuh. Jumlah koneksi serentak dibatasi agar soket tidak putus.',
      evidence: `${requests} permintaan terkirim dengan biaya $${analysis.totals.costUsd.toFixed(2)}.`
    },
    {
      no: 8,
      title: 'Mengulang uji akurasi dengan soal yang lebih sukar',
      body: 'Putaran pertama dijawab benar hampir seluruhnya oleh semua supplier, sehingga tidak membedakan apa pun. Ditambahkan lima belas soal yang lebih sukar — teka-teki klasik, persentase bertingkat, median, kelipatan persekutuan, dan silogisme — lalu uji akurasi diulang untuk seluruh pasangan.',
      evidence: 'Hasilnya tetap hampir sempurna di semua supplier, dan itulah jawabannya: tidak ada supplier yang menyajikan model dengan mutu lebih rendah.'
    },
    {
      no: 9,
      title: 'Menyusun keputusan dari angka',
      body: 'Tiap pasangan dinilai terhadap sembilan kriteria. Urutan supplier disusun dengan mendahulukan yang paling sedikit melanggar kriteria, lalu yang termurah, lalu yang paling cepat memberi token pertama. Urutan itulah yang menjadi rantai cadangan yang disarankan.',
      evidence: 'Temuan pada halaman ini ditarik dari angka, sehingga ikut berubah bila sesi pengujian ditambah.'
    }
  ];
}

export const CORRECTIONS: Correction[] = [
  {
    problem: 'Daftar harga Tokenku mencantumkan deepseek-v4-1-flash dengan pengali 37,5, sama dengan model video.',
    impact: 'Bila dipercaya, model itu akan dinilai hampir dua ratus kali lebih mahal dari kenyataannya dan dicoret dari daftar.',
    fix: 'Tarif tiap model diukur dari selisih tagihan akun, bukan dibaca dari daftar harga.'
  },
  {
    problem: 'Pada uji asap, sebelas permintaan gagal dengan soket terputus dan gagal menyambung.',
    impact: 'Kegagalan komputer penguji akan tercatat sebagai cacat keandalan supplier.',
    fix: 'Jumlah koneksi serentak dibatasi, kegagalan jaringan dicoba ulang, dan jenis kegagalan dipisahkan antara penolakan Tokenku dan gangguan sisi penguji. Yang sisi penguji dikeluarkan dari angka keandalan.'
  },
  {
    problem: 'Empat kunci jawaban pada soal akurasi salah, termasuk sudut jarum jam pukul 01:30 yang saya tulis 45 derajat.',
    impact: 'Model yang menjawab benar akan dinilai salah, dan selisih antar supplier menjadi semu.',
    fix: 'Setiap kunci dihitung ulang satu per satu, lalu uji akurasi dijalankan ulang untuk seluruh pasangan.'
  },
  {
    problem: 'Rumus kecepatan menghasilkan angka mustahil, sampai ribuan token per detik.',
    impact: 'Peringkat kecepatan antar supplier menjadi tidak berarti.',
    fix: 'Model ini memancarkan token penalaran sebelum teks jawaban, jadi laju dihitung sejak token pertama apa pun, dan jawaban yang terlalu pendek dibuang karena membagi lima token dengan jendela beberapa milidetik menghasilkan laju semu.'
  },
  {
    problem: 'Ambang awal "token pertama dalam 3 detik" membuat hampir semua model gagal.',
    impact: 'Model dinyatakan buruk bukan karena lambat melayani, melainkan karena sedang menalar.',
    fix: 'Ukurannya dipecah dua: token pertama apa pun sebagai tanda aplikasi tidak membeku, dan teks jawaban pertama sebagai saat pengguna mulai bisa membaca.'
  },
  {
    problem: 'Dua puluh lima soal pertama dijawab benar oleh semua supplier.',
    impact: 'Uji yang semua pesertanya lulus tidak memberi informasi apa pun.',
    fix: 'Ditambahkan lima belas soal yang lebih sukar. Hasilnya tetap seragam, dan kesimpulannya dinyatakan apa adanya sebagai hasil negatif yang bermakna.'
  }
];

export function limitations(analysis: ReturnType<typeof analyse>): string[] {
  return [
    `Seluruh angka berasal dari ${analysis.totals.sessions} sesi pada satu rentang waktu. Perbedaan jam sibuk dan jam sepi belum tercakup, padahal peringkat supplier bisa berubah karenanya.`,
    'Persentil ke-95 dihitung dari lima puluh sampel latensi per pasangan. Cukup untuk membandingkan, tetapi belum cukup untuk dijadikan janji layanan.',
    'Beban bersamaan diuji sampai enam belas permintaan serentak, sesuai pemakaian aplikasi internal, bukan ratusan.',
    'Biaya dihitung untuk satu profil percakapan yang dicantumkan di bawah grafik. Percakapan dengan riwayat lebih panjang akan bergeser biayanya.',
    'Mutu jawaban panjang hanya dinilai keutuhannya, bukan isinya. Penilaian isi memerlukan pembacaan manusia atau model penilai, yang keduanya di luar lingkup uji ini.',
    'Volc_intl tidak diuji karena tidak melayani satu pun model aplikasi.'
  ];
}

export function nextSteps(analysis: ReturnType<typeof analyse>): string[] {
  const solo = analysis.chains.filter((c) => c.alternatives === 0).map((c) => c.model);
  const empty = analysis.pairs.reduce((sum, p) => sum + p.emptyAnswers, 0);
  const out = [
    'Memasang pemilihan supplier berurutan di aplikasi memakai rantai pada bagian keputusan, dengan perpindahan hanya sebelum token pertama keluar agar jawaban tidak terduplikasi.',
    'Menjalankan sesi kedua pada jam yang berbeda untuk menguji apakah peringkat supplier bertahan.'
  ];
  if (empty) out.unshift(`Menaikkan batas token pada aplikasi: ${empty} jawaban pada uji ini keluar kosong karena seluruh jatah token habis dipakai menalar, dan pengguna akan melihatnya sebagai balasan hampa.`);
  if (solo.length) out.push(`Menimbang ulang pemakaian ${solo.join(' dan ')} yang tidak punya cadangan, atau menerima risikonya secara sadar.`);
  return out;
}
