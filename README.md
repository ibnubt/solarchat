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

## Perbandingan supplier Tokenku

Tokenku menyalurkan model lewat beberapa supplier (grup) dengan harga dan kecepatan berbeda. Supplier **menempel pada kunci API**: tidak bisa dipilih lewat header, field body, maupun akhiran nama model. Jadi satu kunci per supplier.

```bash
bun scripts/poc/run.ts --session=S1            # sesi penuh
bun scripts/poc/run.ts --session=S1 --scenarios=akurasi   # ulangi satu skenario saja
```

Kunci dibaca dari `TOKENKU_KEY_<SUPPLIER>` (`TOKENKU_KEY_CHINALLM`, `TOKENKU_KEY_ENTERPRISE`, dan seterusnya) atau dari berkas lewat `--keys=`. Hasil ditulis ke `data/poc-suppliers.json`; sesi berikutnya digabungkan, bukan menimpa. Halaman `/poc` menyajikannya sebagai keputusan, papan nilai lulus/gagal, grafik perbandingan, dan sampel mentah yang bisa diunduh CSV.

Yang diuji per pasangan model-supplier: latensi, beban bersamaan, akurasi pada soal berjawaban pasti, kepatuhan format blok chart, jawaban panjang, dan konteks 20 ribu token dengan fakta tertanam. Kriteria lulus ditetapkan di `scripts/poc/config.ts` sebelum uji dijalankan.

Dua hal yang membuat angkanya bisa dipercaya:

- **Harga diukur, bukan dibaca dari tabel.** Daftar harga Tokenku terbukti keliru untuk sebagian model, jadi runner mengukur tarif tiap model dari tagihan sungguhan sebelum uji dimulai.
- **Kegagalan penguji dipisahkan.** Soket yang putus karena terlalu banyak stream dari satu komputer dicoba ulang dan tidak dihitung sebagai kegagalan supplier. Batasi dengan `POC_MAX_INFLIGHT` (default 8).

Laporan POC lama (satu endpoint, tanpa pembanding) tetap tersimpan di `data/poc-report.json` dan dapat dibuat ulang dengan `bun run poc`.

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
