<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import Check from 'lucide-svelte/icons/check';
  import Download from 'lucide-svelte/icons/download';
  import Gauge from 'lucide-svelte/icons/gauge';
  import Minus from 'lucide-svelte/icons/minus';
  import X from 'lucide-svelte/icons/x';
  import ChartBlock from '$lib/markdown/ChartBlock.svelte';
  import type { ChartSpec } from '$lib/markdown/chart';
  import { CHAT_PROFILE, USD_TO_IDR, type PairMetrics, type Sample, type SupplierReport } from '$lib/poc/suppliers';
  import { FOOTNOTES, METHOD_NOTES, WHAT_TESTED, limitations, modelTable, takeaways } from '$lib/poc/narrative';
  import '$lib/markdown/blocks.css';

  type Analysis = {
    findings: Array<{ tone: 'baik' | 'perhatian' | 'risiko'; text: string }>;
    scenarios: Array<{ name: string; total: number; perPair: number; contextTokens: number }>;
    pairs: PairMetrics[];
    models: string[];
    chains: Array<{ model: string; chain: string[]; primary: PairMetrics; alternatives: number; savingPercent: number }>;
    totals: { requests: number; sessions: number; costUsd: number; transportFailures: number };
  };

  let { data }: { data: { report: SupplierReport | null; analysis: Analysis | null } } = $props();
  const report = $derived(data.report);
  const analysis = $derived(data.analysis);

  let scenarioFilter = $state('all');
  let pairFilter = $state('all');
  let onlyFailed = $state(false);
  let shown = $state(40);

  const num = (v: number | null, digits = 0) =>
    v === null || v === undefined ? '—' : v.toLocaleString('id-ID', { maximumFractionDigits: digits });
  const ms = (v: number | null) => (v === null ? '—' : v >= 1000 ? `${(v / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk` : `${v} ms`);
  const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
  const rupiah = (usd: number | null) => (usd === null ? '—' : `Rp ${Math.round(usd * USD_TO_IDR).toLocaleString('id-ID')}`);
  const short = (model: string) => model.replace(/-260428$/, '').replace('doubao-seed-', 'doubao-');

  const suppliers = $derived([...new Set(analysis?.pairs.map((p) => p.supplier) ?? [])].sort());
  const limits = $derived(analysis ? limitations(analysis as never) : []);
  const models = $derived(analysis ? modelTable(analysis as never) : []);
  const points = $derived(analysis ? takeaways(analysis as never) : []);

  const SECTIONS = [
    { id: 'ringkasan', label: 'Ringkasan' },
    { id: 'cara', label: 'Yang diuji' },
    { id: 'hasil', label: 'Hasil lengkap' },
    { id: 'lampiran', label: 'Data mentah' }
  ];

  /** Satu seri per supplier, satu kategori per model: perbandingan dibaca mendatar. */
  function bySupplier(title: string, pick: (p: PairMetrics) => number | null, yLabel: string, unit = ''): ChartSpec {
    const models = analysis?.models ?? [];
    return {
      type: 'bar', title, labels: models.map(short), xLabel: 'Model', yLabel, unit,
      series: suppliers.map((supplier) => ({
        name: supplier,
        data: models.map((model) => {
          const pair = analysis?.pairs.find((p) => p.model === model && p.supplier === supplier);
          return pair ? pick(pair) : null;
        })
      }))
    };
  }

  const ttftChart = $derived(bySupplier('Waktu sampai token pertama (p95)', (p) => (p.ttftAnyP95 === null ? null : Math.round(p.ttftAnyP95 / 100) / 10), 'detik', 'dtk'));
  const speedChart = $derived(bySupplier('Kecepatan menulis jawaban (median)', (p) => p.tokensPerSecond, 'token/detik', 'tok/dtk'));
  const costChart = $derived(bySupplier(`Biaya 1.000 percakapan`, (p) => (p.costPer1000ChatsUsd === null ? null : Math.round(p.costPer1000ChatsUsd * USD_TO_IDR)), 'rupiah', 'Rp'));

  const samples = $derived(report?.samples ?? []);
  const filtered = $derived(samples.filter((s) =>
    (scenarioFilter === 'all' || s.scenario === scenarioFilter) &&
    (pairFilter === 'all' || `${s.model}::${s.supplier}` === pairFilter) &&
    (!onlyFailed || !s.ok)
  ));
  const scenarios = $derived([...new Set(samples.map((s) => s.scenario))].sort());

  function downloadCsv() {
    const head = ['sesi', 'model', 'supplier', 'skenario', 'indeks', 'berhasil', 'status', 'jenis_gagal', 'ttft_any_ms', 'ttft_isi_ms', 'latensi_ms', 'token_masuk', 'token_keluar', 'token_nalar', 'alasan_selesai', 'benar', 'chart_valid', 'fakta_ketemu', 'terpotong', 'error'];
    const line = (s: Sample) => [s.session, s.model, s.supplier, s.scenario, s.index, s.ok ? 1 : 0, s.status, s.failureKind ?? '', s.ttftAnyMs ?? '', s.ttftMs ?? '', s.latencyMs, s.inputTokens, s.outputTokens, s.reasoningTokens, s.finishReason, s.correct === undefined ? '' : s.correct ? 1 : 0, s.chartValid === undefined ? '' : s.chartValid ? 1 : 0, s.factFound === undefined ? '' : s.factFound ? 1 : 0, s.truncated ? 1 : 0, (s.error ?? '').replace(/[",\n]/g, ' ')]
      .map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',');
    const blob = new Blob(['﻿', [head.join(','), ...filtered.map(line)].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'poc-supplier-sampel.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<svelte:head>
  <title>Perbandingan Supplier Tokenku — SOLAR Chat</title>
  <meta name="description" content="Uji perbandingan supplier Tokenku: keandalan, kecepatan, akurasi, dan biaya terukur." />
</svelte:head>

<main class="report-shell">
  <header class="report-nav">
    <a href="/" class="back"><ArrowLeft size={16} /> Kembali ke chat</a>
    <div class="brand-mini">SOLAR <small>PERBANDINGAN SUPPLIER</small></div>
    {#if report}<button onclick={downloadCsv}><Download size={15} /> Unduh CSV</button>{/if}
  </header>

  {#if !analysis || !report}
    <section class="empty-report">
      <Gauge size={34} />
      <h1>Laporan belum ada</h1>
      <p>Jalankan <code>bun scripts/poc/run.ts --session=S1</code> untuk menghasilkan laporan di halaman ini.</p>
    </section>
  {:else}
    <div class="report-content">
      <nav class="toc" aria-label="Daftar isi">
        {#each SECTIONS as s}<a href={`#${s.id}`}>{s.label}</a>{/each}
      </nav>

      <section class="decision" id="ringkasan">
        <p class="kicker">RINGKASAN</p>
        <h1>Model mana yang dipakai.</h1>
        <div class="rb-scroll">
          <table class="rb-table">
            <thead>
              <tr>
                <th>Model</th>
                <th class="num">Waktu tunggu</th>
                <th class="num">Menulis</th>
                <th class="num">Biaya 1.000 chat</th>
                <th class="num">Token berpikir</th>
                <th>Supplier termurah</th>
                <th>Cadangan</th>
                <th class="num">Gagal</th>
              </tr>
            </thead>
            <tbody>
              {#each models as m}
                <tr>
                  <td><strong>{short(m.model)}</strong></td>
                  <td class="num">{ms(m.waitMs)}</td>
                  <td class="num">{num(m.speed)} tok/dtk</td>
                  <td class="num">{rupiah(m.costUsd)}</td>
                  <td class="num">{m.reasoningShare === null ? '—' : `${Math.round(m.reasoningShare * 100)}%`}</td>
                  <td>{m.supplier}{#if m.savingPercent > 0}<small> hemat {m.savingPercent}%</small>{/if}</td>
                  <td>{m.fallbacks.length ? m.fallbacks.join(', ') : '—'}</td>
                  <td class="num" class:bad={m.failures > 0}>{m.failures === 0 ? '—' : `${m.failures} / ${m.requests}`}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <ol class="points">{#each points as p}<li>{p}</li>{/each}</ol>
        <ul class="footnotes">{#each FOOTNOTES as f}<li>{f}</li>{/each}</ul>
        <p class="basis">Dasar: {analysis.totals.requests.toLocaleString('id-ID')} permintaan ke {analysis.pairs.length} kombinasi model dan supplier, biaya uji ${analysis.totals.costUsd.toFixed(2)}.</p>
      </section>

      <section class="section-block" id="cara">
        <div class="section-heading"><div><p>YANG DIUJI</p><h2>Enam hal, pada setiap kombinasi</h2></div></div>
        <div class="rb-scroll">
          <table class="rb-table">
            <thead><tr><th>Yang diuji</th><th>Caranya</th><th class="num">Konteks</th><th class="num">Berapa kali</th></tr></thead>
            <tbody>
              {#each WHAT_TESTED as w}
                {@const c = analysis.scenarios.find((sc) => sc.name === w.scenario)}
                <tr><td><strong>{w.name}</strong></td><td>{w.detail}</td><td class="num">{c ? `${c.contextTokens.toLocaleString('id-ID')} token` : '—'}</td><td class="num">{c ? c.total.toLocaleString('id-ID') : '—'}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <ul class="plain notes">{#each METHOD_NOTES as n}<li>{n}</li>{/each}</ul>

        {#if report.examples?.length}
          <details class="shape">
            <summary>Lihat contoh nyata yang dikirim dan diterima</summary>
            <div class="cases">
              {#each report.examples as ex}
                <article class="case">
                  <header><h3>{ex.scenario}</h3><span>{ex.model} di {ex.supplier}</span></header>
                  <div class="case-body">
                    <div><p class="cap">Dikirim</p><pre><code>{JSON.stringify(ex.request, null, 1)}</code></pre></div>
                    <div>
                      <p class="cap">Diterima</p><pre><code>{ex.response.content}</code></pre>
                      <p class="stats">masuk {ex.response.prompt_tokens.toLocaleString('id-ID')} token · keluar {ex.response.completion_tokens.toLocaleString('id-ID')} ({ex.response.reasoning_tokens.toLocaleString('id-ID')} dipakai berpikir) · mulai merespons {ms(ex.response.ttft_any_ms)} · jawaban terbaca {ms(ex.response.ttft_content_ms)}</p>
                    </div>
                  </div>
                  <p class="judge"><span>Dinilai</span>{ex.judge}</p>
                </article>
              {/each}
            </div>
          </details>
        {/if}
      </section>

      <section class="section-block" id="hasil">
        <div class="section-heading">
          <div><p>HASIL LENGKAP</p><h2>Setiap kombinasi terhadap sembilan syarat</h2></div>
          <span>Arahkan kursor ke judul kolom untuk melihat syaratnya</span>
        </div>
        <div class="rb-scroll scorecard">
          <table class="rb-table">
            <thead>
              <tr>
                <th>Model</th><th>Supplier</th>
                {#each report.criteria as c}<th class="tilt" title={c.detail}>{c.label}</th>{/each}
                <th class="num">Nilai</th>
              </tr>
            </thead>
            <tbody>
              {#each analysis.pairs as pair}
                <tr>
                  <td>{short(pair.model)}</td>
                  <td>{pair.supplier}</td>
                  {#each report.criteria as c}
                    <td class="mark">
                      {#if pair.verdicts[c.id] === 'lulus'}<i class="pass" title="lulus"><Check size={14} /></i>
                      {:else if pair.verdicts[c.id] === 'gagal'}<i class="fail" title="gagal"><X size={14} /></i>
                      {:else}<i class="skip" title="tidak diuji"><Minus size={13} /></i>{/if}
                    </td>
                  {/each}
                  <td class="num"><b>{pair.passed}</b>/{report.criteria.length}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="section-block" id="angka">
        <div class="section-heading"><div><p>ANGKA</p><h2>Perbandingan antar supplier</h2></div><span>Model yang sama diadu pada supplier berbeda</span></div>
        <div class="chart-stack">
          <ChartBlock spec={ttftChart} />
          <ChartBlock spec={speedChart} />
          <ChartBlock spec={costChart} />
        </div>
        <p class="note">
          Biaya dihitung dari tarif yang diukur langsung dari tagihan Tokenku, dikali pengali harga tiap supplier,
          untuk percakapan khas {CHAT_PROFILE.inputTokens.toLocaleString('id-ID')} token masuk dan
          {CHAT_PROFILE.outputTokens.toLocaleString('id-ID')} token keluar. Kurs Rp {USD_TO_IDR.toLocaleString('id-ID')} per dolar.
        </p>
      </section>

      <section class="section-block" id="rincian">
        <div class="section-heading"><div><p>RINCIAN</p><h2>Angka per pasangan</h2></div><span>{analysis.pairs.length} pasangan</span></div>
        <div class="rb-scroll">
          <table class="rb-table">
            <thead>
              <tr>
                <th>Model</th><th>Supplier</th><th class="num">Request</th><th class="num">Keandalan</th>
                <th class="num">Token pertama p50</th><th class="num">p95</th>
                <th class="num">Teks pertama p95</th><th class="num">tok/dtk</th>
                <th class="num">Akurasi</th><th class="num">Format</th><th class="num">Konteks 20k</th>
                <th class="num">Rp / 1.000 chat</th>
              </tr>
            </thead>
            <tbody>
              {#each analysis.pairs as p}
                <tr>
                  <td>{short(p.model)}</td><td>{p.supplier}</td>
                  <td class="num">{p.requests}</td>
                  <td class="num" class:bad={p.upstreamFailures > 0}>{pct(p.reliability)}</td>
                  <td class="num">{ms(p.ttftAnyP50)}</td>
                  <td class="num">{ms(p.ttftAnyP95)}</td>
                  <td class="num">{ms(p.ttftContentP95)}</td>
                  <td class="num">{num(p.tokensPerSecond, 1)}</td>
                  <td class="num">{pct(p.accuracy)}</td>
                  <td class="num">{pct(p.chartValid)}</td>
                  <td class="num">{pct(p.factFound)}</td>
                  <td class="num">{rupiah(p.costPer1000ChatsUsd)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <section class="section-block">
        <div class="section-heading"><div><p>BATASAN</p><h2>Yang belum dijawab uji ini</h2></div></div>
        <ul class="plain limits">{#each limits as l}<li>{l}</li>{/each}</ul>
      </section>

      <section class="section-block" id="lampiran">
        <div class="section-heading"><div><p>LAMPIRAN</p><h2>Sampel mentah</h2></div><span>{filtered.length.toLocaleString('id-ID')} dari {samples.length.toLocaleString('id-ID')} baris</span></div>
        <details class="shape">
          <summary>Bentuk satu baris data</summary>
          <pre><code>{JSON.stringify(samples[0], null, 1)}</code></pre>
        </details>
        <div class="filters">
          <label>Skenario<select bind:value={scenarioFilter}><option value="all">semua</option>{#each scenarios as s}<option value={s}>{s}</option>{/each}</select></label>
          <label>Pasangan<select bind:value={pairFilter}><option value="all">semua</option>{#each analysis.pairs as p}<option value={`${p.model}::${p.supplier}`}>{short(p.model)} · {p.supplier}</option>{/each}</select></label>
          <label class="check"><input type="checkbox" bind:checked={onlyFailed} /> hanya yang gagal</label>
        </div>
        <div class="rb-scroll">
          <table class="rb-table">
            <thead><tr><th>Model</th><th>Supplier</th><th>Skenario</th><th class="num">Token pertama</th><th class="num">Lama</th><th class="num">Token keluar</th><th>Hasil</th><th>Catatan</th></tr></thead>
            <tbody>
              {#each filtered.slice(0, shown) as s}
                <tr>
                  <td>{short(s.model)}</td><td>{s.supplier}</td><td>{s.scenario}</td>
                  <td class="num">{ms(s.ttftAnyMs)}</td>
                  <td class="num">{ms(s.latencyMs)}</td>
                  <td class="num">{s.outputTokens}{#if s.reasoningTokens}<small> ({s.reasoningTokens} nalar)</small>{/if}</td>
                  <td>{#if s.ok}<span class="tag ok">berhasil</span>{:else}<span class="tag bad">{s.failureKind === 'transport' ? 'jaringan penguji' : 'ditolak'}</span>{/if}</td>
                  <td class="note-cell">{s.error ?? s.answerPreview ?? ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if filtered.length > shown}
          <button class="more" onclick={() => (shown += 100)}>Tampilkan 100 baris lagi</button>
        {/if}
      </section>
    </div>
  {/if}
</main>

<style>
  /* body global memakai overflow:hidden untuk kerangka chat, jadi halaman ini harus menggulir sendiri. */
  .report-shell { height: 100vh; height: 100dvh; overflow-y: auto; overscroll-behavior: contain; background: #f9faf6; background-image: linear-gradient(rgba(47,61,41,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(47,61,41,.035) 1px, transparent 1px); background-size: 40px 40px; }
  .report-nav { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 62px; padding: 0 24px; border-bottom: 1px solid rgba(215,220,210,.9); background: rgba(249,250,246,.94); backdrop-filter: blur(8px); }
  .report-nav .back, .report-nav button { display: inline-flex; align-items: center; gap: 7px; border: 1px solid #d7dcd2; border-radius: 9px; background: #fff; color: #3f473c; padding: 8px 12px; font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; }
  .report-nav .back:hover, .report-nav button:hover { border-color: #aeb5a8; color: #20241f; }
  .brand-mini { font-size: 15px; font-weight: 700; letter-spacing: -.03em; }
  .brand-mini small { margin-left: 5px; color: #628d0d; font-family: 'DM Mono', monospace; font-size: 8px; letter-spacing: .1em; }

  .empty-report { display: grid; place-items: center; gap: 10px; padding: 120px 24px; color: #7b8278; text-align: center; }
  .empty-report h1 { margin: 0; font-size: 22px; color: #20241f; }
  .empty-report code { padding: 2px 6px; border-radius: 5px; background: #edf0e8; font-family: 'DM Mono', monospace; font-size: .9em; }

  .report-content { width: min(1120px, calc(100% - 40px)); margin: 0 auto; padding: 34px 0 90px; display: flex; flex-direction: column; gap: 42px; }
  .kicker { margin: 0 0 10px; color: #858c82; font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: .12em; }
  .decision h1 { margin-bottom: 18px; font-size: clamp(26px, 3.4vw, 38px); line-height: 1.1; letter-spacing: -.045em; font-weight: 600; }


  .section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
  .section-heading p { margin: 0 0 4px; color: #969d92; font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: .12em; }
  .section-heading h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
  .section-heading span { color: #8a9187; font-size: 11px; text-align: right; }

  .scorecard { border: 1px solid #dce1d7; border-radius: 12px; background: #fff; }
  .scorecard th.tilt { font-size: 10px; max-width: 72px; white-space: normal; line-height: 1.25; }
  .mark { text-align: center; }
  .mark i { display: inline-grid; place-items: center; width: 21px; height: 21px; border-radius: 6px; }
  .mark .pass { background: #e6f0d3; color: #4b6d0a; }
  .mark .fail { background: #f7e0dd; color: #a54139; }
  .mark .skip { background: #eef0e8; color: #9aa196; }


  .chart-stack { display: grid; gap: 12px; }
  .note { margin: 12px 0 0; color: #7b8278; font-size: 11px; line-height: 1.6; }

  .points { margin: 18px 0 0; padding: 0 0 0 20px; display: grid; gap: 8px; max-width: 840px; }
  .points li { color: #3f473c; font-size: 13.5px; line-height: 1.6; }
  .footnotes { margin: 16px 0 0; padding: 0 0 0 16px; display: grid; gap: 5px; max-width: 840px; list-style: none; }
  .footnotes li { position: relative; color: #868d82; font-size: 11px; line-height: 1.55; }
  .footnotes li::before { content: '—'; position: absolute; left: -16px; }
  .rb-table small { color: #949b90; font-size: 10px; font-weight: 400; }
  .basis { margin: 20px 0 0; color: #868d82; font-size: 12px; }
  .cases { padding: 0 12px 12px; display: grid; gap: 10px; }
  .toc { position: sticky; top: 62px; z-index: 9; display: flex; flex-wrap: wrap; gap: 4px; margin: -6px -8px 0; padding: 8px; border-bottom: 1px solid #e6e9e1; background: rgba(249,250,246,.94); backdrop-filter: blur(8px); }
  .toc a { padding: 5px 10px; border-radius: 999px; color: #72796f; font-size: 11px; text-decoration: none; }
  .toc a:hover { background: #e8ebe3; color: #20241f; }

  .case { margin: 0 0 10px; border: 1px solid #dfe3da; border-radius: 12px; background: #fff; overflow: hidden; }
  .case header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #e6e9e1; background: #f7f8f4; }
  .case h3 { margin: 0; font-family: 'DM Mono', monospace; font-size: 12px; font-weight: 500; }
  .case header span { color: #868d82; font-size: 11px; }
  .case-body { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .case-body > div { min-width: 0; padding: 12px 14px; }
  .case-body > div + div { border-left: 1px solid #edf0e8; }
  .cap { margin: 0 0 7px; color: #969d92; font-family: 'DM Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
  .case pre { margin: 0; max-height: 210px; padding: 11px 12px; overflow: auto; border-radius: 9px; background: #20241f; color: #eef2e9; font-family: 'DM Mono', monospace; font-size: 11px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
  .case .stats { margin: 9px 0 0; color: #6c7468; font-family: 'DM Mono', monospace; font-size: 10px; line-height: 1.6; }
  .judge { margin: 0; padding: 10px 14px; border-top: 1px solid #edf0e8; background: #fafbf8; color: #4c5349; font-size: 12px; line-height: 1.6; }
  .judge span { margin-right: 7px; color: #4b6d0a; font-family: 'DM Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }


  .plain { margin: 0; padding: 18px 18px 18px 36px; border: 1px solid #dfe3da; border-radius: 12px; background: #fff; color: #4c5349; font-size: 13px; line-height: 1.7; }
  .plain li + li { margin-top: 9px; }
  .plain.limits, .plain.notes { background: #f7f8f4; }
  .plain.notes { margin-top: 10px; font-size: 12.5px; }

  .shape { margin-bottom: 10px; border: 1px solid #dfe3da; border-radius: 11px; background: #fff; }
  .shape summary { padding: 10px 14px; color: #4c5349; font-size: 12px; font-weight: 600; cursor: pointer; }
  .shape pre { margin: 0; padding: 0 14px 14px; overflow: auto; max-height: 300px; font-family: 'DM Mono', monospace; font-size: 11px; line-height: 1.55; color: #3f473c; }

  .filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
  .filters label { display: inline-flex; align-items: center; gap: 7px; color: #72796f; font-size: 11px; }
  .filters select { padding: 7px 9px; border: 1px solid #d7dcd2; border-radius: 8px; background: #fff; font-size: 12px; }
  .filters .check { gap: 6px; }

  .rb-table td.bad { color: #a54139; font-weight: 600; }
  .tag { display: inline-block; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; }
  .tag.ok { background: #e6f0d3; color: #4b6d0a; }
  .tag.bad { background: #f7e0dd; color: #a54139; }
  .note-cell { max-width: 320px; color: #72796f; font-size: 11px; }
  .more { width: 100%; margin-top: 10px; padding: 11px; border: 1px dashed #d2d7cc; border-radius: 10px; background: transparent; color: #5d870d; font-size: 12px; font-weight: 600; cursor: pointer; }
  .more:hover { background: #f2f6ea; }

  @media (max-width: 680px) {
    .report-nav { padding: 0 12px; height: 56px; }
    .brand-mini { display: none; }
    .report-content { width: calc(100% - 24px); padding-top: 22px; gap: 32px; }
    .section-heading { flex-direction: column; align-items: flex-start; gap: 4px; }
    .section-heading span { text-align: left; }
      .case-body { grid-template-columns: 1fr; }
    .case-body > div + div { border-left: 0; border-top: 1px solid #edf0e8; }
    }
</style>
