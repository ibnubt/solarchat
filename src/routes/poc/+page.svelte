<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Download from 'lucide-svelte/icons/download';
  import Gauge from 'lucide-svelte/icons/gauge';
  import ChartBlock from '$lib/markdown/ChartBlock.svelte';
  import type { ChartSpec } from '$lib/markdown/chart';
  import { INCIDENT_NOTES, limitations } from '$lib/poc/narrative';
  import { METRICS, type ModelRow, type summarise } from '$lib/poc/results';
  import type { Sample, SupplierReport } from '$lib/poc/suppliers';
  import '$lib/markdown/blocks.css';

  type Summary = ReturnType<typeof summarise>;
  let { data }: { data: { report: SupplierReport | null; summary: Summary | null } } = $props();
  const report = $derived(data.report);
  const summary = $derived(data.summary);
  const limits = $derived(summary ? limitations(summary) : []);

  let scenarioFilter = $state('all');
  let modelFilter = $state('all');
  let onlyFailed = $state(false);
  let shown = $state(40);

  const sec = (v: number | null) => (v === null ? '—' : `${(v / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk`);
  const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
  const rp = (v: number | null) => (v === null ? '—' : `Rp ${v.toLocaleString('id-ID')}`);
  const frac = (a: number, b: number) => (b ? `${a}/${b}` : '—');
  const short = (model: string) => model.replace(/-260428$/, '').replace('doubao-seed-', 'doubao-');

  const scenarioLabel: Record<string, string> = {
    latensi: 'Chat pendek', beban: 'Beban serentak', akurasi: 'Soal berjawaban pasti',
    'format-chart': 'Permintaan grafik', 'jawaban-panjang': 'Jawaban panjang', 'konteks-panjang': 'Riwayat panjang',
    'tanpa-nalar': 'Tanpa menalar', ketersediaan: 'Probe ketersediaan'
  };

  /** Kegagalan dari Tokenku, dikelompokkan per pasangan dan pesan. */
  const incidents = $derived.by(() => {
    const map = new Map<string, { model: string; supplier: string; message: string; count: number }>();
    for (const s of samples) {
      if (s.ok || s.failureKind === 'transport') continue;
      const message = `${s.status || 'putus'} · ${(s.error || 'tanpa pesan').slice(0, 110)}`;
      const key = `${s.model}|${s.supplier}|${message}`;
      const row = map.get(key) ?? { model: s.model, supplier: s.supplier, message, count: 0 };
      row.count += 1;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  });

  const supplierNames = $derived([...new Set(summary?.suppliers.map((s) => s.supplier) ?? [])].sort());
  function bySupplier(title: string, pick: (row: { ttftP95: number | null; costShortIdr: number | null }) => number | null, yLabel: string, unit = ''): ChartSpec {
    const models = summary?.models.map((m) => m.model) ?? [];
    return {
      type: 'bar', title, labels: models.map(short), xLabel: 'Model', yLabel, unit,
      series: supplierNames.map((supplier) => ({
        name: supplier,
        data: models.map((model) => { const r = summary?.suppliers.find((s) => s.model === model && s.supplier === supplier); return r ? pick(r) : null; })
      }))
    };
  }
  const ttftChart = $derived(bySupplier('Waktu tunggu p95 per supplier', (r) => (r.ttftP95 === null ? null : Math.round(r.ttftP95 / 100) / 10), 'detik', 'dtk'));
  const costChart = $derived(bySupplier('Biaya 1.000 pertanyaan pendek per supplier', (r) => r.costShortIdr, 'rupiah', 'Rp'));

  const samples = $derived(report?.samples ?? []);
  const filtered = $derived(samples.filter((s) =>
    (scenarioFilter === 'all' || s.scenario === scenarioFilter) &&
    (modelFilter === 'all' || s.model === modelFilter) &&
    (!onlyFailed || !s.ok)
  ));

  function downloadCsv() {
    const head = ['sesi', 'model', 'supplier', 'skenario', 'indeks', 'berhasil', 'status', 'jenis_gagal', 'ttft_ms', 'teks_pertama_ms', 'lama_ms', 'token_masuk', 'token_keluar', 'token_nalar', 'alasan_selesai', 'benar', 'grafik_terbaca', 'kode_ketemu', 'terpotong', 'error'];
    const cell = (v: unknown) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const line = (s: Sample) => [s.session, s.model, s.supplier, s.scenario, s.index, s.ok ? 1 : 0, s.status, s.failureKind ?? '', s.ttftAnyMs ?? '', s.ttftMs ?? '', s.latencyMs, s.inputTokens, s.outputTokens, s.reasoningTokens, s.finishReason, s.correct === undefined ? '' : +s.correct, s.chartValid === undefined ? '' : +s.chartValid, s.factFound === undefined ? '' : +s.factFound, s.truncated ? 1 : 0, s.error ?? ''].map(cell).join(',');
    const blob = new Blob(['﻿', [head.join(','), ...filtered.map(line)].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'poc-supplier.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<svelte:head>
  <title>POC Tokenku — SOLAR Chat</title>
</svelte:head>

<main class="report-shell">
  <header class="report-nav">
    <a href="/" class="back"><ArrowLeft size={16} /> Kembali ke chat</a>
    <div class="brand-mini">SOLAR <small>POC TOKENKU</small></div>
    {#if report}<button onclick={downloadCsv}><Download size={15} /> Unduh CSV</button>{/if}
  </header>

  {#if !summary || !report}
    <section class="empty-report"><Gauge size={34} /><h1>Laporan belum ada</h1><p>Jalankan <code>bun scripts/poc/run.ts --session=S1</code>.</p></section>
  {:else}
    <div class="report-content">
      <nav class="toc" aria-label="Daftar isi">
        <a href="#performa">Performa per supplier</a><a href="#harga">Harga</a><a href="#grafik">Grafik</a><a href="#insiden">Insiden</a><a href="#batasan">Batasan</a><a href="#data">Data mentah</a>
      </nav>

      <section class="section-block" id="performa">
        <div class="section-heading"><div><p>POC TOKENKU</p><h2>Performa per supplier</h2></div><span>{summary.totals.requests.toLocaleString('id-ID')} permintaan · {summary.models.length} model · {supplierNames.length} supplier · {summary.totals.sessions} sesi · biaya uji ${summary.totals.costUsd.toFixed(2)}</span></div>
        <div class="rb-scroll">
          <table class="rb-table">
            <thead>
              <tr>
                <th>Model</th><th>Supplier</th>
                <th class="num">TTFT p50</th><th class="num">TTFT p95</th>
                <th class="num">Token/detik</th>
                <th class="num">Berpikir</th>
                <th class="num">reasoning_effort: low<small>TTFT p50 · porsi berpikir</small></th>
                <th class="num">Berhasil</th>
                <th class="num">Ketersediaan</th>
              </tr>
            </thead>
            <tbody>
              {#each summary.suppliers as r, i}
                {@const first = i === 0 || summary.suppliers[i - 1].model !== r.model}
                <tr class:group-start={first}>
                  <td>{#if first}<strong>{short(r.model)}</strong>{/if}</td>
                  <td>{r.supplier}</td>
                  <td class="num">{sec(r.ttftP50)}</td><td class="num">{sec(r.ttftP95)}</td>
                  <td class="num">{r.tokensPerSecond ?? '—'}</td>
                  <td class="num">{pct(r.reasoningShare)}</td>
                  <td class="num">{#if !r.noReasoning}—{:else if !r.noReasoning.supported}<small>ditolak (400)</small>{:else}{sec(r.noReasoning.ttftP50)}<small>{pct(r.noReasoning.reasoningShare)} berpikir</small>{/if}</td>
                  <td class="num" class:bad={r.failures > 0}>{pct(r.successRate)}{#if r.failures}<small>{r.failures} dari {r.requests}</small>{/if}</td>
                  <td class="num" class:bad={r.availability !== null && r.availability.ok < r.availability.total}>{#if r.availability}{r.availability.ok}/{r.availability.total}{:else}—{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <dl class="defs">{#each METRICS as m}<div><dt>{m.label}</dt><dd>{m.how}</dd></div>{/each}</dl>
      </section>

      <section class="section-block" id="harga">
        <div class="section-heading"><div><p>HARGA</p><h2>Biaya per 1.000 permintaan</h2></div><span>Token terpakai disamakan per model, jadi selisih antar supplier = pengali harga Tokenku</span></div>
        <div class="rb-scroll">
          <table class="rb-table">
            <thead><tr><th>Model</th><th>Supplier</th><th class="num">Pengali harga</th><th class="num">Pertanyaan pendek</th><th class="num">Jawaban panjang</th><th class="num">Selisih dari termurah</th></tr></thead>
            <tbody>
              {#each summary.suppliers as r, i}
                {@const first = i === 0 || summary.suppliers[i - 1].model !== r.model}
                {@const cheapest = summary.suppliers.filter((x) => x.model === r.model && x.costShortIdr !== null).reduce((m, x) => (m === null || (x.costShortIdr as number) < (m.costShortIdr as number) ? x : m), null as typeof r | null)}
                <tr class:group-start={first}>
                  <td>{#if first}<strong>{short(r.model)}</strong>{/if}</td>
                  <td>{r.supplier}</td>
                  <td class="num">{r.ratio.toLocaleString('id-ID')}×</td>
                  <td class="num">{rp(r.costShortIdr)}</td>
                  <td class="num">{rp(r.costLongIdr)}</td>
                  <td class="num">{#if cheapest && r.costShortIdr !== null && cheapest.costShortIdr}{cheapest.supplier === r.supplier ? 'termurah' : `+${Math.round((r.costShortIdr / cheapest.costShortIdr - 1) * 100)}%`}{:else}—{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="section-block" id="grafik">
        <div class="section-heading"><div><p>GRAFIK</p><h2>Model yang sama, supplier berbeda</h2></div></div>
        <div class="chart-stack"><ChartBlock spec={ttftChart} /><ChartBlock spec={costChart} /></div>
      </section>

      <section class="section-block" id="insiden">
        <div class="section-heading"><div><p>INSIDEN</p><h2>Kegagalan yang tercatat</h2></div></div>
        <div class="rb-scroll">
          <table class="rb-table">
            <thead><tr><th>Model</th><th>Supplier</th><th class="num">Gagal</th><th>Pesan</th></tr></thead>
            <tbody>
              {#each incidents as inc}
                <tr><td>{short(inc.model)}</td><td>{inc.supplier}</td><td class="num">{inc.count}</td><td class="note-cell">{inc.message}</td></tr>
              {:else}
                <tr><td colspan="4">Tidak ada kegagalan dari Tokenku selama uji.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <ul class="plain">{#each INCIDENT_NOTES as n}<li>{n}</li>{/each}</ul>
      </section>

      <section class="section-block" id="batasan">
        <div class="section-heading"><div><p>BATASAN</p><h2>Cara membaca angkanya</h2></div></div>
        <ul class="plain limits">{#each limits as l}<li>{l}</li>{/each}</ul>
      </section>

      <section class="section-block" id="data">
        <div class="section-heading"><div><p>DATA MENTAH</p><h2>Semua permintaan</h2></div><span>{filtered.length.toLocaleString('id-ID')} dari {samples.length.toLocaleString('id-ID')}</span></div>
        <div class="filters">
          <label>Uji<select bind:value={scenarioFilter}><option value="all">semua</option>{#each summary.scenarios as s}<option value={s.name}>{scenarioLabel[s.name] ?? s.name}</option>{/each}</select></label>
          <label>Model<select bind:value={modelFilter}><option value="all">semua</option>{#each summary.models as m}<option value={m.model}>{short(m.model)}</option>{/each}</select></label>
          <label class="check"><input type="checkbox" bind:checked={onlyFailed} /> hanya yang gagal</label>
        </div>
        <div class="rb-scroll">
          <table class="rb-table">
            <thead><tr><th>Sesi</th><th>Model</th><th>Supplier</th><th>Uji</th><th class="num">TTFT</th><th class="num">Lama</th><th class="num">Token keluar</th><th>Hasil</th><th>Catatan</th></tr></thead>
            <tbody>
              {#each filtered.slice(0, shown) as s}
                <tr>
                  <td>{s.session}</td><td>{short(s.model)}</td><td>{s.supplier}</td><td>{scenarioLabel[s.scenario] ?? s.scenario}</td>
                  <td class="num">{sec(s.ttftAnyMs)}</td><td class="num">{sec(s.latencyMs)}</td>
                  <td class="num">{s.outputTokens}{#if s.reasoningTokens}<small>{s.reasoningTokens} berpikir</small>{/if}</td>
                  <td>{#if s.ok}<span class="tag ok">{s.unsupported ? 'tidak didukung' : 'berhasil'}</span>{:else}<span class="tag bad">{s.failureKind === 'transport' ? 'jaringan penguji' : 'gagal'}</span>{/if}</td>
                  <td class="note-cell">{s.error ?? s.answerPreview ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if filtered.length > shown}<button class="more" onclick={() => (shown += 100)}>Tampilkan 100 baris lagi</button>{/if}
      </section>
    </div>
  {/if}
</main>

<style>
  .report-shell { height: 100vh; height: 100dvh; overflow-y: auto; overscroll-behavior: contain; background: #f9faf6; background-image: linear-gradient(rgba(47,61,41,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(47,61,41,.035) 1px, transparent 1px); background-size: 40px 40px; }
  .report-nav { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 62px; padding: 0 24px; border-bottom: 1px solid rgba(215,220,210,.9); background: rgba(249,250,246,.94); backdrop-filter: blur(8px); }
  .report-nav .back, .report-nav button { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #d7dcd2; border-radius: 9px; background: #fff; color: #3f473c; padding: 8px 12px; font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; }
  .report-nav .back:hover, .report-nav button:hover { border-color: #aeb5a8; color: #20241f; }
  .brand-mini { font-size: 15px; font-weight: 700; letter-spacing: -.03em; }
  .brand-mini small { margin-left: 5px; color: #628d0d; font-family: 'DM Mono', monospace; font-size: 8px; letter-spacing: .1em; }
  .empty-report { display: grid; place-items: center; gap: 10px; padding: 120px 24px; color: #7b8278; text-align: center; }
  .empty-report h1 { margin: 0; font-size: 22px; color: #20241f; }
  .empty-report code { padding: 2px 6px; border-radius: 5px; background: #edf0e8; font-family: 'DM Mono', monospace; font-size: .9em; }

  .report-content { width: min(1180px, calc(100% - 40px)); margin: 0 auto; padding: 18px 0 90px; display: flex; flex-direction: column; gap: 38px; }
  .toc { position: sticky; top: 62px; z-index: 9; display: flex; flex-wrap: wrap; gap: 4px; margin: 0 -8px; padding: 8px; border-bottom: 1px solid #e6e9e1; background: rgba(249,250,246,.94); backdrop-filter: blur(8px); }
  .toc a { padding: 5px 10px; border-radius: 999px; color: #72796f; font-size: 11px; text-decoration: none; }
  .toc a:hover { background: #e8ebe3; color: #20241f; }

  .section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; margin-bottom: 12px; }
  .section-heading p { margin: 0 0 4px; color: #969d92; font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: .12em; }
  .section-heading h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
  .section-heading span { color: #8a9187; font-size: 11px; text-align: right; max-width: 60%; }

  .rb-table td small { display: block; color: #949b90; font-size: 10px; }
  .rb-table th small { display: block; color: #949b90; font-size: 9px; font-weight: 400; text-transform: none; }
  .rb-table tr.group-start td { border-top: 2px solid #dfe3da; }
  .defs { margin: 12px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 18px; }
  .defs dt { color: #20241f; font-size: 11.5px; font-weight: 700; }
  .defs dd { margin: 2px 0 0; color: #6c7468; font-size: 11px; line-height: 1.5; }
  .rb-table td.bad { color: #a54139; font-weight: 600; }
  .chart-stack { display: grid; gap: 12px; }
  .plain { margin: 0; padding: 16px 16px 16px 34px; border: 1px solid #dfe3da; border-radius: 12px; background: #f7f8f4; color: #4c5349; font-size: 12.5px; line-height: 1.65; }
  .plain li + li { margin-top: 7px; }

  .filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
  .filters label { display: inline-flex; align-items: center; gap: 7px; color: #72796f; font-size: 11px; }
  .filters select { padding: 7px 9px; border: 1px solid #d7dcd2; border-radius: 8px; background: #fff; font-size: 12px; }
  .tag { display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; }
  .tag.ok { background: #e6f0d3; color: #4b6d0a; }
  .tag.bad { background: #f7e0dd; color: #a54139; }
  .note-cell { max-width: 320px; color: #72796f; font-size: 11px; }
  .more { width: 100%; margin-top: 10px; padding: 11px; border: 1px dashed #d2d7cc; border-radius: 10px; background: transparent; color: #5d870d; font-size: 12px; font-weight: 600; cursor: pointer; }

  @media (max-width: 680px) {
    .report-nav { padding: 0 12px; height: 56px; }
    .brand-mini { display: none; }
    .report-content { width: calc(100% - 24px); gap: 30px; }
    .section-heading { flex-direction: column; align-items: flex-start; gap: 4px; }
    .section-heading span { text-align: left; max-width: none; }
  }
</style>
