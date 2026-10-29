import { LONG_CONTEXT_TARGET_TOKENS } from './config';

export type Question = { id: string; prompt: string; expect: string; kind: 'number' | 'text' };

/** Soal berjawaban pasti; identik untuk semua supplier agar akurasi bisa dibandingkan. */
export const ACCURACY: Question[] = [
  { id: 'A01', kind: 'number', expect: '1081', prompt: 'Berapa 47 x 23? Jawab hanya angkanya, tanpa kata lain.' },
  { id: 'A02', kind: 'number', expect: '3796', prompt: 'Berapa 104 x 36 + 52? Jawab hanya angkanya, tanpa kata lain.' },
  { id: 'A03', kind: 'number', expect: '17', prompt: 'Sebuah gardu melayani 1.360 pelanggan, setiap petugas menangani 80 pelanggan. Berapa petugas dibutuhkan? Jawab hanya angkanya.' },
  { id: 'A04', kind: 'number', expect: '2450', prompt: 'Produksi PLTS bulan lalu 2.800 MWh dan turun 12,5 persen bulan ini. Berapa MWh bulan ini? Jawab hanya angkanya tanpa satuan.' },
  { id: 'A05', kind: 'number', expect: '144', prompt: 'Berapa hasil 12 pangkat 2? Jawab hanya angkanya.' },
  { id: 'A06', kind: 'number', expect: '8', prompt: 'Deret: 2, 4, 8, 16, 32. Berapa banyak faktor 2 yang dikalikan untuk mendapat 256 dari 1? Jawab hanya angkanya.' },
  { id: 'A07', kind: 'number', expect: '4620', prompt: 'Tarif listrik Rp 1.650 per kWh. Berapa biaya untuk 2,8 kWh? Jawab hanya angkanya tanpa Rp dan tanpa titik.' },
  { id: 'A08', kind: 'number', expect: '36', prompt: 'Jika 1/4 dari sebuah bilangan adalah 9, berapa bilangan itu? Jawab hanya angkanya.' },
  { id: 'A09', kind: 'number', expect: '1275', prompt: 'Berapa jumlah semua bilangan bulat dari 1 sampai 50? Jawab hanya angkanya.' },
  { id: 'A10', kind: 'number', expect: '7', prompt: 'Berapa sisa pembagian 100 dibagi 31? Jawab hanya angkanya.' },

  { id: 'B01', kind: 'number', expect: '1402', prompt: 'Dari tabel berikut, berapa produksi bulan April?\nJanuari 1240\nFebruari 1105\nMaret 1318\nApril 1402\nMei 1377\nJawab hanya angkanya.' },
  { id: 'B02', kind: 'text', expect: 'cirata', prompt: 'Teks: "Pembangunan PLTS terapung Cirata selesai pada 2023, sedangkan PLTS Kupang masih tahap studi." Lokasi PLTS terapung yang sudah selesai ada di mana? Jawab satu kata saja.' },
  { id: 'B03', kind: 'number', expect: '192', prompt: 'Teks: "Gardu A memiliki 64 trafo, Gardu B 48 trafo, Gardu C 80 trafo." Berapa total trafo? Jawab hanya angkanya.' },
  { id: 'B04', kind: 'text', expect: 'rabu', prompt: 'Teks: "Rapat anggaran digeser dari Selasa ke Rabu, lalu lokasinya dipindah." Rapat akhirnya jadi hari apa? Jawab satu kata saja.' },
  { id: 'B05', kind: 'number', expect: '2019', prompt: 'Teks: "Proyek dimulai 2019, ditunda 2021, dan dilanjutkan 2024." Tahun berapa proyek dimulai? Jawab hanya angkanya.' },

  { id: 'C01', kind: 'text', expect: 'negatif', prompt: 'Klasifikasikan sentimen kalimat ini sebagai positif, negatif, atau netral: "Layanan sangat lambat dan petugas tidak membantu." Jawab satu kata saja.' },
  { id: 'C02', kind: 'text', expect: 'positif', prompt: 'Klasifikasikan sentimen kalimat ini sebagai positif, negatif, atau netral: "Pemasangan cepat dan hasilnya memuaskan sekali." Jawab satu kata saja.' },
  { id: 'C03', kind: 'text', expect: 'netral', prompt: 'Klasifikasikan sentimen kalimat ini sebagai positif, negatif, atau netral: "Rapat dijadwalkan pukul sembilan di ruang dua." Jawab satu kata saja.' },
  { id: 'C04', kind: 'text', expect: 'keluhan', prompt: 'Kategorikan pesan ini sebagai keluhan, pertanyaan, atau pujian: "Listrik di rumah saya padam tiga kali minggu ini." Jawab satu kata saja.' },
  { id: 'C05', kind: 'text', expect: 'pertanyaan', prompt: 'Kategorikan pesan ini sebagai keluhan, pertanyaan, atau pujian: "Apakah tagihan bulan ini sudah bisa dicek lewat aplikasi?" Jawab satu kata saja.' },

  { id: 'D01', kind: 'text', expect: 'budi', prompt: 'Budi lebih tinggi dari Andi. Andi lebih tinggi dari Citra. Siapa yang paling tinggi? Jawab satu nama saja.' },
  { id: 'D02', kind: 'text', expect: 'citra', prompt: 'Budi lebih tinggi dari Andi. Andi lebih tinggi dari Citra. Siapa yang paling pendek? Jawab satu nama saja.' },
  { id: 'D03', kind: 'number', expect: '12', prompt: 'Sebuah tim punya 3 regu, tiap regu 4 orang. Berapa total orang? Jawab hanya angkanya.' },
  { id: 'D04', kind: 'text', expect: 'maret', prompt: 'Urutan bulan: Januari, Februari, Maret, April. Bulan apa yang berada tepat sebelum April? Jawab satu kata saja.' },
  { id: 'D05', kind: 'number', expect: '135', prompt: 'Jarum jam menunjuk pukul 01:30. Berapa derajat sudut terkecil antara jarum jam dan jarum menit? Jawab hanya angkanya.' },

  // Soal sukar: 25 soal pertama dijawab benar oleh semua supplier, jadi tidak membedakan apa pun.
  { id: 'E01', kind: 'number', expect: '204', prompt: 'Berapa banyak persegi dengan sisi bilangan bulat pada papan catur 8x8, termasuk ukuran 1x1 sampai 8x8? Jawab hanya angkanya.' },
  { id: 'E02', kind: 'number', expect: '5', prompt: 'Lima mesin membuat lima barang dalam lima menit. Berapa menit yang dibutuhkan seratus mesin untuk membuat seratus barang? Jawab hanya angkanya.' },
  { id: 'E03', kind: 'number', expect: '47', prompt: 'Teratai menutupi kolam dua kali lipat tiap hari dan penuh pada hari ke-48. Hari ke berapa kolam tertutup separuh? Jawab hanya angkanya.' },
  { id: 'E04', kind: 'number', expect: '5000', prompt: 'Sebuah tongkat dan topi berharga Rp 11.000. Tongkat lebih mahal Rp 1.000 dari topi. Berapa harga topi? Jawab hanya angkanya tanpa titik.' },
  { id: 'E05', kind: 'number', expect: '1', prompt: 'Berapa sisa pembagian 2 pangkat 100 dibagi 3? Jawab hanya angkanya.' },
  { id: 'E06', kind: 'number', expect: '-2', prompt: 'Produksi naik 40 persen lalu turun 30 persen dari nilai barunya. Berapa persen kenaikan bersih dari awal, dibulatkan ke bilangan bulat terdekat? Jawab hanya angkanya, boleh negatif.' },
  { id: 'E07', kind: 'number', expect: '12', prompt: 'Sebuah tangki terisi penuh oleh keran A dalam 20 menit dan keran B dalam 30 menit. Berapa menit bila keduanya dibuka bersamaan? Jawab hanya angkanya.' },
  { id: 'E08', kind: 'number', expect: '9', prompt: 'Ada 10 kantong berisi koin. Satu kantong berisi koin palsu yang lebih ringan 1 gram. Dengan satu kali penimbangan memakai timbangan digital, berapa koin yang harus diambil dari kantong ke-9? Jawab hanya angkanya.' },
  { id: 'E09', kind: 'text', expect: 'tidak', prompt: 'Semua kucing adalah mamalia. Sebagian mamalia bisa terbang. Apakah dari dua pernyataan itu pasti ada kucing yang bisa terbang? Jawab ya atau tidak saja.' },
  { id: 'E10', kind: 'text', expect: 'ya', prompt: 'Tidak ada burung yang menyusui. Semua kelelawar menyusui. Apakah pasti tidak ada kelelawar yang merupakan burung? Jawab ya atau tidak saja.' },
  { id: 'E11', kind: 'number', expect: '1999', prompt: 'Teks: "Proyek A mulai 1998 selesai 2004. Proyek B mulai 2001 selesai 2003. Proyek C mulai 1999 selesai 2010." Tahun berapa proyek yang paling lama durasinya dimulai? Jawab hanya angkanya.' },
  { id: 'E12', kind: 'number', expect: '1318', prompt: 'Tabel produksi: Jan 1240, Feb 1105, Mar 1318, Apr 1402, Mei 1377. Berapa nilai median? Jawab hanya angkanya.' },
  { id: 'E13', kind: 'number', expect: '3', prompt: 'Gardu A padam tiap 4 hari, gardu B tiap 6 hari, keduanya padam bersamaan hari ini. Dalam 36 hari ke depan, berapa kali lagi keduanya padam bersamaan? Jawab hanya angkanya.' },
  { id: 'E14', kind: 'text', expect: 'budi', prompt: 'Andi bukan yang tertinggi. Citra lebih pendek dari Andi. Budi lebih tinggi dari Andi. Siapa yang tertinggi? Jawab satu nama saja.' },
  { id: 'E15', kind: 'number', expect: '66', prompt: 'Sebuah kendaraan menempuh 120 km dengan kecepatan 60 km/jam lalu 120 km lagi dengan 73,33 km/jam. Berapa kecepatan rata-rata seluruh perjalanan dalam km/jam, dibulatkan ke bilangan bulat? Jawab hanya angkanya.' }
];

/** Permintaan grafik; dinilai dari JSON blok ```chart yang dihasilkan. */
export const CHART_PROMPTS: string[] = [
  'Buat grafik batang produksi PLTS: Januari 1240, Februari 1105, Maret 1318, April 1402, Mei 1377 MWh.',
  'Buat grafik garis jumlah pelanggan per kuartal: Q1 820, Q2 905, Q3 980, Q4 1120.',
  'Buat grafik pie komposisi biaya: modul 42, inverter 18, pemasangan 20, lain-lain 20 persen.',
  'Buat grafik batang perbandingan konsumsi listrik tiga gedung: A 540, B 760, C 620 kWh.',
  'Buat grafik garis suhu trafo per jam: 08.00 62, 09.00 65, 10.00 71, 11.00 74, 12.00 78 derajat.',
  'Buat grafik batang gangguan per penyebab: cuaca 34, peralatan 21, hewan 12, lainnya 8 kejadian.',
  'Buat grafik garis pemakaian daya 6 bulan: 310, 298, 325, 340, 352, 361 kWh mulai Januari.',
  'Buat grafik pie pangsa sumber energi: surya 45, angin 25, air 20, lainnya 10 persen.'
];

/** Prompt yang menghasilkan jawaban panjang; dipakai menguji pemotongan. */
export const LONG_ANSWER_PROMPTS: string[] = [
  'Susun strategi peluncuran produk SaaS B2B dalam 30 hari, lengkap dengan rincian per minggu.',
  'Jelaskan secara menyeluruh cara kerja pembangkit listrik tenaga surya dari panel sampai jaringan.',
  'Buat panduan lengkap pemeliharaan trafo distribusi, termasuk jadwal dan daftar periksa.',
  'Tulis rencana kesiapsiagaan bencana untuk jaringan kelistrikan daerah, selengkap mungkin.',
  'Jelaskan langkah demi langkah membangun aplikasi chat dengan streaming, dari rancangan sampai penerapan.'
];

const FILLER = [
  'Sistem kelistrikan modern menggabungkan pembangkit terpusat dan tersebar untuk menjaga keandalan pasokan.',
  'Pemeliharaan berkala pada gardu induk mencakup pemeriksaan isolator, pengukuran tahanan, dan pencatatan suhu.',
  'Data pemakaian pelanggan dikumpulkan melalui meter pintar lalu dikirim ke pusat pengolahan setiap jam.',
  'Perencanaan jaringan mempertimbangkan pertumbuhan beban, topografi, serta ketersediaan lahan untuk jalur baru.',
  'Keselamatan kerja menjadi prasyarat setiap pekerjaan bertegangan, dengan prosedur penguncian dan penandaan.',
  'Analisis kualitas daya meninjau harmonisa, faktor daya, serta kedip tegangan pada titik sambung pelanggan.',
  'Pembangkit terbarukan memerlukan prakiraan cuaca agar penjadwalan produksi harian tetap akurat.',
  'Pencatatan aset dilakukan dengan penomoran unik supaya penelusuran riwayat perbaikan lebih mudah.'
];

export const PLANTED_FACT_CODE = 'ZX-4719';

/** Riwayat panjang dengan satu fakta tertanam di awal; menguji kapasitas konteks, bukan sekadar menerima permintaan. */
export function buildLongContext(variant: number) {
  const fact = `Catatan penting: kode registrasi proyek PLTS Cirata adalah ${PLANTED_FACT_CODE}. Simpan kode ini.`;
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: fact },
    { role: 'assistant', content: 'Baik, kode tersebut saya catat.' }
  ];
  const targetChars = LONG_CONTEXT_TARGET_TOKENS * 4;
  let chars = fact.length;
  let i = variant;
  while (chars < targetChars) {
    const body = Array.from({ length: 6 }, (_, k) => FILLER[(i + k) % FILLER.length]).join(' ');
    messages.push({ role: 'user', content: `Ringkas paragraf berikut dalam satu kalimat: ${body}` });
    messages.push({ role: 'assistant', content: 'Paragraf tersebut membahas pengelolaan sistem kelistrikan secara umum.' });
    chars += body.length + 90;
    i += 1;
  }
  messages.push({ role: 'user', content: 'Sebutkan kode registrasi proyek PLTS Cirata yang saya berikan di awal. Jawab hanya kodenya.' });
  return { messages, approxTokens: Math.round(chars / 4) };
}

/** Normalisasi jawaban model sebelum dicocokkan dengan kunci. */
export function isCorrect(q: Question, answer: string) {
  const text = answer.toLowerCase().replace(/\*\*/g, '').trim();
  if (q.kind === 'number') {
    const nums = text.replace(/[.,](?=\d{3}\b)/g, '').match(/-?\d+(?:[.,]\d+)?/g) || [];
    return nums.some((n) => Math.abs(Number(n.replace(',', '.')) - Number(q.expect)) < 0.5);
  }
  return new RegExp(`\\b${q.expect}\\b`, 'i').test(text);
}
