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

## Laporan POC Tokenku

Jalankan suite benchmark terkontrol dengan:

```bash
bun run poc
```

Hasil lengkap disimpan di `POC_REPORT_FILE` (default `./data/poc-report.json`) dan dapat dilihat melalui halaman `/poc` setelah login. Runner menguji compatibility, streaming latency, long context, tool calling, multimodal, high-token output, concurrency bertahap, sustained load, burst, dan timeout. Guardrail menghentikan kenaikan concurrency jika error tahap sebelumnya melebihi 10%.

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
