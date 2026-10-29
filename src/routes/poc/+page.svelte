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
  import { METHOD_NOTES, PURPOSE, SCENARIO_PURPOSE, limitations, nextSteps } from '$lib/poc/narrative';
  import '$lib/markdown/blocks.css';

  type Analysis = {
    findings: Array<{ tone: 'baik' | 'perhatian' | 'risiko'; text: string }>;
    scenarios: Array<{ name: string; total: number; perPair: number }>;
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
  const next = $derived(analysis ? nextSteps(analysis as never) : []);

  const SECTIONS = [
    { id: 'keputusan', label: 'Keputusan' },
    { id: 'temuan', label: 'Temuan' },
    { id: 'cara', label: 'Cara uji' },
    { id: 'papan-nilai', label: 'Papan nilai' },
    { id: 'angka', label: 'Angka' },
    { id: 'rincian', label: 'Rincian' },
    { id: 'batasan', label: 'Batasan' },
    { id: 'lanjut', label: 'Langkah lanjut' },
    { id: 'lampiran', label: 'Lampiran' }
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

      <section class="decision" id="keputusan">
        <p class="kicker">KEPUTUSAN</p>
        <h1>Supplier mana yang dipakai, dan apa cadangannya.</h1>
        <p class="lede">
          {analysis.totals.requests.toLocaleString('id-ID')} permintaan nyata ke {analysis.pairs.length} pasangan model-supplier,
          biaya uji ${analysis.totals.costUsd.toFixed(2)}. Urutan disusun dengan mendahulukan yang lolos seluruh kriteria,
          lalu yang termurah.
        </p>

        <div class="decision-grid">
          {#each analysis.chains as item}
            <article>
              <header><h3>{short(item.model)}</h3>{#if item.savingPercent > 0}<span class="save">hemat {item.savingPercent}%</span>{/if}</header>
              <p class="choice"><strong>{item.primary.supplier}</strong></p>
              {#if item.alternatives > 0}
                <p class="fallback">cadangan: {item.chain.slice(1).join(' → ')}</p>
              {:else}
                <p class="fallback warn">tidak ada cadangan — hanya satu supplier</p>
              {/if}
              {#if item.primary.failedCriteria.length}
                <p class="fallback warn">belum memenuhi: {item.primary.failedCriteria.map((id) => report.criteria.find((c) => c.id === id)?.label ?? id).join(', ')}</p>
              {/if}
              <dl>
                <div><dt>Keandalan</dt><dd>{pct(item.primary.reliability)}</dd></div>
                <div><dt>Token pertama p95</dt><dd>{ms(item.primary.ttftAnyP95)}</dd></div>
                <div><dt>Biaya 1.000 chat</dt><dd>{rupiah(item.primary.costPer1000ChatsUsd)}</dd></div>
              </dl>
            </article>
          {/each}
        </div>
      </section>

      <section class="section-block" id="temuan">
        <div class="section-heading"><div><p>TEMUAN</p><h2>Yang perlu ditindaklanjuti</h2></div><span>Disusun dari angka, bukan ditulis tangan</span></div>
        <ul class="findings">
          {#each analysis.findings as f}
            <li class={f.tone}><span>{f.tone}</span><p>{f.text}</p></li>
          {/each}
        </ul>
      </section>

      <section class="section-block" id="cara">
        <div class="section-heading"><div><p>CARA UJI</p><h2>Yang diukur dan ambang lulusnya</h2></div><span>{analysis.pairs.length} pasangan model-supplier</span></div>
        <p class="purpose">{PURPOSE}</p>
        <div class="rb-scroll">
          <table class="rb-table">
            <thead><tr><th>Skenario</th><th>Yang diukur</th><th class="num">Per pasangan</th><th class="num">Total</th></tr></thead>
            <tbody>
              {#each analysis.scenarios as sc}
                <tr><td><strong>{sc.name}</strong></td><td>{SCENARIO_PURPOSE[sc.name] ?? '—'}</td><td class="num">{sc.perPair}</td><td class="num">{sc.total.toLocaleString('id-ID')}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="rb-scroll" style="margin-top:10px">
          <table class="rb-table">
            <thead><tr><th>Kriteria lulus</th><th>Ambang, ditetapkan sebelum uji</th></tr></thead>
            <tbody>{#each report.criteria as c}<tr><td><strong>{c.label}</strong></td><td>{c.detail}</td></tr>{/each}</tbody>
          </table>
        </div>
        <ul class="plain notes">{#each METHOD_NOTES as n}<li>{n}</li>{/each}</ul>
      </section>

      <section class="section-block" id="papan-nilai">
        <div class="section-heading">
          <div><p>PAPAN NILAI</p><h2>Lulus atau gagal terhadap kriteria</h2></div>
          <span>Kriteria ditetapkan sebelum uji dijalankan</span>
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

      <section class="section-block" id="batasan">
        <div class="section-heading"><div><p>BATASAN</p><h2>Yang belum dijawab uji ini</h2></div></div>
        <ul class="plain limits">{#each limits as l}<li>{l}</li>{/each}</ul>
      </section>

      <section class="section-block" id="lanjut">
        <div class="section-heading"><div><p>LANGKAH LANJUT</p><h2>Yang perlu dikerjakan setelah ini</h2></div></div>
        <ol class="plain next">{#each next as n}<li>{n}</li>{/each}</ol>
      </section>

      <section class="section-block" id="lampiran">
        <div class="section-heading"><div><p>LAMPIRAN</p><h2>Sampel mentah</h2></div><span>{filtered.length.toLocaleString('id-ID')} dari {samples.length.toLocaleString('id-ID')} baris</span></div>
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
  .decision h1 { margin: 0; font-size: clamp(28px, 4vw, 44px); line-height: 1.1; letter-spacing: -.045em; font-weight: 600; }
  .lede { max-width: 720px; margin: 14px 0 0; color: #5f665c; line-height: 1.65; font-size: 14px; }

  .decision-grid { margin-top: 26px; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .decision-grid article { padding: 16px; border: 1px solid #dfe3da; border-radius: 14px; background: #fff; box-shadow: 0 8px 26px rgba(37,49,31,.045); }
  .decision-grid header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .decision-grid h3 { margin: 0; font-size: 13px; font-weight: 700; overflow-wrap: anywhere; }
  .save { flex: 0 0 auto; padding: 3px 7px; border-radius: 6px; background: #e6f0d3; color: #4b6d0a; font-family: 'DM Mono', monospace; font-size: 9px; }
  .choice { margin: 12px 0 2px; font-size: 20px; letter-spacing: -.02em; }
  .fallback { margin: 0; color: #7b8278; font-size: 11px; }
  .fallback.warn { color: #a54139; }
  .decision-grid dl { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid #edf0e8; display: grid; gap: 7px; }
  .decision-grid dl div { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .decision-grid dt { color: #868d82; font-size: 11px; }
  .decision-grid dd { margin: 0; font-family: 'DM Mono', monospace; font-size: 12px; color: #252a23; }

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

  .findings { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
  .findings li { display: grid; grid-template-columns: 86px 1fr; gap: 12px; align-items: start; padding: 13px 15px; border: 1px solid #dfe3da; border-left-width: 3px; border-radius: 11px; background: #fff; }
  .findings li.baik { border-left-color: #8fbd34; }
  .findings li.perhatian { border-left-color: #eda100; }
  .findings li.risiko { border-left-color: #d1655c; }
  .findings span { padding: 3px 0; color: #868d82; font-family: 'DM Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
  .findings li.risiko span { color: #a54139; }
  .findings p { margin: 0; color: #3f473c; font-size: 13px; line-height: 1.6; }

  .chart-stack { display: grid; gap: 12px; }
  .note { margin: 12px 0 0; color: #7b8278; font-size: 11px; line-height: 1.6; }

  .toc { position: sticky; top: 62px; z-index: 9; display: flex; flex-wrap: wrap; gap: 4px; margin: -6px -8px 0; padding: 8px; border-bottom: 1px solid #e6e9e1; background: rgba(249,250,246,.94); backdrop-filter: blur(8px); }
  .toc a { padding: 5px 10px; border-radius: 999px; color: #72796f; font-size: 11px; text-decoration: none; }
  .toc a:hover { background: #e8ebe3; color: #20241f; }

  .purpose { max-width: 760px; margin: 0 0 14px; padding: 13px 15px; border-left: 3px solid #8fbd34; border-radius: 0 10px 10px 0; background: #f2f5ec; color: #2d3329; font-size: 13.5px; line-height: 1.65; }

  .plain { margin: 0; padding: 18px 18px 18px 36px; border: 1px solid #dfe3da; border-radius: 12px; background: #fff; color: #4c5349; font-size: 13px; line-height: 1.7; }
  .plain li + li { margin-top: 9px; }
  .plain.limits, .plain.notes { background: #f7f8f4; }
  .plain.notes { margin-top: 10px; font-size: 12.5px; }

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
    .decision-grid { grid-template-columns: 1fr; }
    .findings li { grid-template-columns: 1fr; gap: 4px; }
  }
</style>
