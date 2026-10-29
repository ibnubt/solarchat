# SOLAR Chat

Private AI workspace bidang SOLAR berbasis SvelteKit + Bun dengan streaming SSE, login server-side, riwayat percakapan persisten, visualisasi ECharts, animasi GSAP, dan ikon Lucide.

## Menjalankan

```bash
bun install
bun run dev
```

Salin `.env.example` menjadi `.env`, lalu isi `TOKENKU_API_KEY`, akun aplikasi, dan `SESSION_SECRET`. API key dan password hanya dibaca oleh server dan tidak dikirim ke browser.

`TOKENKU_MODEL` menentukan model default server. Model di antarmuka sudah disesuaikan dengan daftar model yang tersedia untuk akun saat aplikasi dibuat.

Riwayat disimpan pada `CHAT_DATA_FILE`, sedangkan gambar percakapan disimpan pada `UPLOAD_DATA_DIR`. Saat deploy, pastikan kedua lokasi berada pada volume persisten dan dapat ditulis oleh proses aplikasi.

Model di antarmuka dikurasi dari katalog biaya Tokenku. Tombol gambar hanya ditampilkan untuk model multimodal. Upload menerima JPEG, PNG, atau WebP dengan ukuran maksimal 5 MB; file tetap terlindungi oleh login aplikasi.

## Secret produksi (Doppler)

Secret produksi disimpan di Doppler (project `solarchat`, config `prd`), bukan di git. Server hanya memegang service token baca-saja di `/home/inu/.config/solarchat/doppler.env`.

- `scripts/start.sh` menjalankan aplikasi lewat `doppler run`: secret Doppler menang atas `.env`, variabel lain tetap dibaca dari `.env`. Salinan terenkripsi terakhir dipakai bila Doppler tidak terjangkau.
- `deploy.sh` (timer tiap menit) juga me-restart service bila isi secret di Doppler berubah, jadi menambah/mengganti secret tidak perlu commit.
- Setup server sekali jalan: `bash scripts/setup-doppler-server.sh`.
- Menambah secret dari laptop: `doppler secrets set NAMA=nilai -p solarchat -c prd`.

Pengembangan lokal tetap memakai `.env`.

## POC Tokenku: perbandingan supplier

Tokenku menyalurkan satu model lewat beberapa supplier (grup) dengan pengali harga berbeda. Supplier **menempel pada kunci API** dan bisa diganti dari konsol Tokenku untuk kunci itu; tidak ada cara memilihnya per permintaan (header, field body, dan akhiran nama model diuji dan tidak berpengaruh).

```bash
bun scripts/poc/run.ts --session=S2                        # sesi penuh: latensi, beban, akurasi, grafik, jawaban panjang, riwayat panjang, tanpa-nalar
bun scripts/poc/run.ts --session=S2 --scenarios=kalibrasi  # ukur ulang tarif per token saja (median 3 putaran)
bun scripts/poc/probe-availability.ts --session=S2 --minutes=60 --every=2   # probe ketersediaan per 2 menit
```

Kunci dibaca dari `TOKENKU_KEY_<SUPPLIER>` atau `--keys=berkas.json`. Hasil ditulis ke `data/poc-suppliers.json`; sesi dan skenario yang sama digantikan, sisanya dipertahankan. Halaman `/poc` menampilkan performa per supplier (TTFT, token/detik, porsi berpikir, mode tanpa menalar, keberhasilan, ketersediaan), harga per 1.000 permintaan, dua grafik, insiden, batasan, dan data mentah yang bisa diunduh CSV.

Dua hal yang membuat angkanya bisa dipercaya: tarif diukur dari tagihan sungguhan dengan teks unik tiap permintaan (cache prompt menurunkan tarif 5×) dan median 3 putaran (tagihan akun bercampur pemakaian aplikasi); gangguan jaringan penguji dicoba ulang dan tidak dihitung sebagai kegagalan supplier (`POC_MAX_INFLIGHT`, default 8).

Laporan lama (satu endpoint tanpa pembanding) tetap di `data/poc-report.json`, dibuat dengan `bun run poc`.

## Context compaction

Percakapan panjang diringkas otomatis tanpa menghapus transkrip asli. Model menerima ringkasan pesan lama ditambah pesan terbaru secara utuh.

- `CONTEXT_COMPACT_TRIGGER`: estimasi token yang memicu compaction, default `24000`.
- `CONTEXT_KEEP_RECENT_MESSAGES`: jumlah pesan terbaru yang tidak diringkas, default `16`.
- `TOKENKU_COMPACTION_MODEL`: model yang membuat ringkasan.
- `COMPACTION_MAX_TOKENS`: batas output ringkasan.

## Production

```bash
bun run build
bun run start
```
