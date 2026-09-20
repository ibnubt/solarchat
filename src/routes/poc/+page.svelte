<script lang="ts">
  import ArrowLeft from 'lucide-svelte/icons/arrow-left';
  import CheckCircle2 from 'lucide-svelte/icons/circle-check-big';
  import ChevronLeft from 'lucide-svelte/icons/chevron-left';
  import ChevronRight from 'lucide-svelte/icons/chevron-right';
  import Clock3 from 'lucide-svelte/icons/clock-3';
  import Download from 'lucide-svelte/icons/download';
  import Gauge from 'lucide-svelte/icons/gauge';
  import Layers3 from 'lucide-svelte/icons/layers-3';
  import ShieldAlert from 'lucide-svelte/icons/shield-alert';
  import PocCharts from '$lib/PocCharts.svelte';
  import type { PocReport, PocSample, PocStatus } from '$lib/poc/types';

  let { data }: { data: { report: PocReport | null } } = $props();
  let selectedModel = $state('all');
  let selectedStatus = $state('all');
  let currentPage = $state(1);
  let pageSize = $state(25);
  const report = $derived(data.report);
  const filteredSamples = $derived(
    report?.samples.filter((sample) =>
      (selectedModel === 'all' || sample.model === selectedModel) &&
      (selectedStatus === 'all' || sample.status === selectedStatus)
    ) || []
  );
  const totalPages = $derived(Math.max(1, Math.ceil(filteredSamples.length / pageSize)));
  const paginatedSamples = $derived(filteredSamples.slice((currentPage - 1) * pageSize, currentPage * pageSize));
  const pageStart = $derived(filteredSamples.length ? (currentPage - 1) * pageSize + 1 : 0);
  const pageEnd = $derived(Math.min(currentPage * pageSize, filteredSamples.length));

  const number = (value: number | null, suffix = '') => value === null ? '—' : `${Math.round(value).toLocaleString('id-ID')}${suffix}`;
  const percent = (value: number) => `${value.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
  const date = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const label: Record<PocStatus | 'partial', string> = { success: 'Lulus', failed: 'Gagal', unsupported: 'Tidak didukung', skipped: 'Dilewati', partial: 'Parsial' };

  function changeFilter(kind: 'model' | 'status', event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (kind === 'model') selectedModel = value;
    else selectedStatus = value;
    currentPage = 1;
  }

  function changePageSize(event: Event) {
    pageSize = Number((event.currentTarget as HTMLSelectElement).value);
    currentPage = 1;
  }

  function goToPage(page: number) {
    currentPage = Math.min(Math.max(page, 1), totalPages);
  }

  function downloadReport() {
    if (!report) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    link.download = `${report.runId}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
</script>

<svelte:head>
  <title>Laporan POC Tokenku — SOLAR Chat</title>
  <meta name="description" content="Laporan benchmark model dan stabilitas API Tokenku." />
</svelte:head>

<main class="report-shell">
  <header class="report-nav">
    <a href="/" class="back"><ArrowLeft size={16} /> Kembali ke chat</a>
    <div class="brand-mini">SOLAR <small>POC TOKENKU</small></div>
    {#if report}<button onclick={downloadReport}><Download size={15} /> Unduh JSON</button>{/if}
  </header>

  {#if !report}
    <section class="empty-report">
      <Gauge size={34} />
      <h1>Report belum tersedia</h1>
      <p>Jalankan benchmark POC untuk menghasilkan laporan terukur di halaman ini.</p>
    </section>
  {:else}
    <div class="report-content">
      <section class="report-hero">
        <div>
          <p class="kicker">LAPORAN POC TOKENKU · EXECUTIVE REPORT</p>
          <h1>Performance that can be <em>defended.</em></h1>
          <p class="hero-copy">Pengujian kompatibilitas, latency, token throughput, long context dan ketahanan beban melalui endpoint aggregator yang sama.</p>
        </div>
        <div class="run-stamp">
          <span class="live"><i></i> RUN SELESAI</span>
          <strong>{report.runId}</strong>
          <small>{date(report.completedAt)}</small>
          <small>{report.profile}</small>
        </div>
      </section>

      <section class="metric-grid">
        <article><span><Layers3 size={15} /> Total request</span><strong>{report.samples.length}</strong><small>{report.targetModels.length} target model</small></article>
        <article><span><CheckCircle2 size={15} /> Successful</span><strong>{report.samples.filter((item) => item.status === 'success').length}</strong><small>Request selesai normal</small></article>
        <article><span><Clock3 size={15} /> Median TTFT terbaik</span><strong>{number(Math.min(...report.aggregates.map((item) => item.medianTtftMs ?? Infinity).filter(Number.isFinite)), ' ms')}</strong><small>Content delta pertama</small></article>
        <article><span><ShieldAlert size={15} /> Rate limit</span><strong>{report.aggregates.reduce((sum, item) => sum + item.rateLimitOccurrences, 0)}</strong><small>HTTP 429 teramati</small></article>
      </section>

      <section class="section-block">
        <div class="section-heading"><div><p>MODEL SCORECARD</p><h2>Ringkasan per model</h2></div><span>Token aktual dari API usage bila tersedia</span></div>
        <div class="model-grid">
          {#each report.aggregates as item}
            <article class:unavailable={item.unsupported > 0 && item.successful === 0} class="model-card">
              <div class="model-title"><div><span>{item.model.includes('deepseek') ? 'DS' : 'GPT'}</span><div><h3>{item.model}</h3><small>{item.successful ? 'Benchmark completed' : 'Model unavailable'}</small></div></div><b>{percent(item.successRate)}</b></div>
              <dl>
                <div><dt>P50 latency</dt><dd>{number(item.p50LatencyMs, ' ms')}</dd></div>
                <div><dt>P95 latency</dt><dd>{number(item.p95LatencyMs, ' ms')}</dd></div>
                <div><dt>Median TTFT</dt><dd>{number(item.medianTtftMs, ' ms')}</dd></div>
                <div><dt>Output speed</dt><dd>{number(item.medianOutputTokensPerSecond, ' tok/s')}</dd></div>
                <div><dt>Max context sukses</dt><dd>{number(item.maxSuccessfulInputTokens, ' tok')}</dd></div>
                <div><dt>Max concurrency</dt><dd>{item.maxSuccessfulConcurrency || '—'}</dd></div>
              </dl>
              <div class="model-foot"><span>{item.successful} sukses</span><span>{item.failed} gagal</span><span>{item.unsupported} unsupported</span></div>
            </article>
          {/each}
        </div>
      </section>

      <PocCharts {report} />

      <section class="section-block findings-grid">
        <article class="finding-card"><p>KEY FINDINGS</p><h2>Temuan utama</h2><ul>{#each report.findings as finding}<li><CheckCircle2 size={15} /> <span>{finding}</span></li>{/each}</ul></article>
        <article class="finding-card limitation"><p>INTERPRETATION NOTES</p><h2>Batasan laporan</h2><ul>{#each report.limitations as limitation}<li><ShieldAlert size={15} /> <span>{limitation}</span></li>{/each}</ul></article>
      </section>

      <section class="section-block">
        <div class="section-heading"><div><p>COMPATIBILITY MATRIX</p><h2>Hasil 18 use case</h2></div><span>Status dihitung dari bukti request tersimpan</span></div>
        <div class="usecase-table">
          {#each report.useCases as item}
            <article><span>{item.id}</span><div><strong>{item.name}</strong><small>{item.summary}</small></div><b class:success={item.status === 'success'} class:failed={item.status === 'failed'} class:partial={item.status === 'partial'}>{label[item.status]}</b></article>
          {/each}
        </div>
      </section>

      <section class="section-block">
        <div class="section-heading detail-head"><div><p>REQUEST EVIDENCE</p><h2>Detail pengujian</h2></div><div class="filters"><select value={selectedModel} onchange={(event) => changeFilter('model', event)} aria-label="Filter model"><option value="all">Semua model</option>{#each report.targetModels as model}<option value={model}>{model}</option>{/each}</select><select value={selectedStatus} onchange={(event) => changeFilter('status', event)} aria-label="Filter status"><option value="all">Semua status</option><option value="success">Lulus</option><option value="failed">Gagal</option><option value="unsupported">Tidak didukung</option><option value="skipped">Dilewati</option></select></div></div>
        <div class="sample-table-wrap">
          <table>
            <thead><tr><th>Use case</th><th>Model / scenario</th><th>Status</th><th>TTFT</th><th>Latency</th><th>Token in/out</th><th>Tok/s</th><th>HTTP</th></tr></thead>
            <tbody>{#each paginatedSamples as sample}<tr><td>{sample.useCase}</td><td><strong>{sample.model}</strong><small>{sample.scenario}{sample.error ? ` · ${sample.error}` : ''}</small></td><td><span class="sample-status {sample.status}">{label[sample.status]}</span></td><td>{number(sample.ttftMs, ' ms')}</td><td>{number(sample.latencyMs, ' ms')}</td><td>{number(sample.inputTokens)} / {number(sample.outputTokens)}</td><td>{number(sample.outputTokensPerSecond)}</td><td>{sample.httpStatus || '—'}</td></tr>{/each}</tbody>
          </table>
        </div>
        <div class="pagination" aria-label="Navigasi halaman hasil pengujian">
          <span>Menampilkan {pageStart}–{pageEnd} dari {filteredSamples.length} hasil</span>
          <div class="pagination-controls">
            <label>Baris <select value={pageSize} onchange={changePageSize} aria-label="Jumlah baris per halaman"><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
            <button onclick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Halaman sebelumnya"><ChevronLeft size={15} /></button>
            <span>Halaman <strong>{currentPage}</strong> dari {totalPages}</span>
            <button onclick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} aria-label="Halaman berikutnya"><ChevronRight size={15} /></button>
          </div>
        </div>
      </section>

      <footer class="methodology"><strong>Metodologi</strong><span>{report.methodology.timing}</span><span>{report.methodology.tokenSource}</span><span>{report.methodology.percentileNote}</span><span>{report.methodology.guardrails}</span></footer>
    </div>
  {/if}
</main>

<style>
  :global(body) { overflow: hidden; }
  .report-shell { height: 100vh; overflow-y: auto; color: #20241f; background-color: #f7f8f3; background-image: linear-gradient(rgba(47,61,41,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(47,61,41,.035) 1px, transparent 1px); background-size: 40px 40px; }
  .report-nav { position: sticky; top: 0; z-index: 10; height: 66px; padding: 0 max(22px, calc((100% - 1180px) / 2)); display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; border-bottom: 1px solid #dfe2d9; background: rgba(247,248,243,.92); backdrop-filter: blur(16px); }
  .back, .report-nav button { display: flex; align-items: center; gap: 7px; color: #646c61; text-decoration: none; font-size: 11px; }
  .report-nav button { justify-self: end; padding: 8px 11px; border: 1px solid #d5dacf; border-radius: 9px; background: #fff; cursor: pointer; }
  .brand-mini { font-size: 16px; font-weight: 700; letter-spacing: -.04em; }.brand-mini small { margin-left: 7px; color: #6f9f12; font-family: 'DM Mono', monospace; font-size: 8px; letter-spacing: .12em; }
  .report-content { width: min(1180px, calc(100% - 44px)); margin: 0 auto; padding: 62px 0 80px; }
  .report-hero { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 50px; align-items: end; }
  .kicker, .section-heading p, .finding-card > p { margin: 0 0 12px; color: #76806f; font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: .14em; }
  .report-hero h1 { max-width: 760px; margin: 0; font-size: clamp(42px, 6vw, 78px); line-height: .98; letter-spacing: -.065em; font-weight: 600; }.report-hero h1 em { color: #6b9912; font-family: Georgia, serif; font-weight: 400; }
  .hero-copy { max-width: 700px; margin: 22px 0 0; color: #6e766b; font-size: 13px; line-height: 1.7; }
  .run-stamp { padding: 19px; display: flex; flex-direction: column; gap: 6px; border: 1px solid #dce0d7; border-radius: 15px; background: #fff; }.run-stamp .live { display: flex; align-items: center; gap: 6px; color: #5f8910; font-family: 'DM Mono', monospace; font-size: 8px; }.run-stamp i { width: 6px; height: 6px; border-radius: 50%; background: #76a91a; }.run-stamp strong { margin-top: 9px; font-family: 'DM Mono', monospace; font-size: 11px; }.run-stamp small { color: #8a9286; font-size: 9px; }
  .metric-grid { margin-top: 42px; display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #dfe2d9; border-radius: 16px; background: #fff; overflow: hidden; }.metric-grid article { min-width: 0; padding: 20px; display: flex; flex-direction: column; }.metric-grid article + article { border-left: 1px solid #e4e7df; }.metric-grid span { display: flex; gap: 7px; align-items: center; color: #7b8378; font-size: 10px; }.metric-grid strong { margin-top: 14px; font-family: 'DM Mono', monospace; font-size: 26px; font-weight: 500; }.metric-grid small { margin-top: 5px; color: #969d93; font-size: 9px; }
  .section-block { margin-top: 48px; }.section-heading { margin-bottom: 15px; display: flex; justify-content: space-between; align-items: end; gap: 20px; }.section-heading p { margin-bottom: 6px; }.section-heading h2, .finding-card h2 { margin: 0; font-size: 20px; letter-spacing: -.025em; }.section-heading > span { color: #92998f; font-size: 9px; }
  .model-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }.model-card { padding: 22px; border: 1px solid #dfe2d9; border-radius: 16px; background: #fff; box-shadow: 0 10px 28px rgba(37,49,31,.04); }.model-card.unavailable { background: #f8f5f2; border-color: #e5dcd5; }.model-title, .model-title > div { display: flex; align-items: center; justify-content: space-between; gap: 11px; }.model-title > div > span { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; background: #e6efd5; color: #52790a; font-size: 10px; font-weight: 700; }.unavailable .model-title > div > span { background: #efe5de; color: #a35a45; }.model-title h3 { margin: 0; font-size: 13px; }.model-title small { display: block; margin-top: 3px; color: #92998f; font-size: 8px; }.model-title b { font-family: 'DM Mono', monospace; font-size: 22px; font-weight: 500; }.model-card dl { margin: 22px 0 0; display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #e5e8e0; border-radius: 11px; overflow: hidden; }.model-card dl div { padding: 12px; display: flex; flex-direction: column; gap: 5px; }.model-card dl div:nth-child(n+4) { border-top: 1px solid #e5e8e0; }.model-card dl div:not(:nth-child(3n+1)) { border-left: 1px solid #e5e8e0; }.model-card dt { color: #8d958a; font-size: 8px; }.model-card dd { margin: 0; font-family: 'DM Mono', monospace; font-size: 11px; }.model-foot { margin-top: 13px; display: flex; gap: 13px; color: #8b9288; font-size: 8px; }
  .findings-grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 14px; }.finding-card { padding: 23px; border: 1px solid #dce2d6; border-radius: 16px; background: #f2f6e9; }.finding-card.limitation { background: #fff; border-color: #dfe2d9; }.finding-card ul { margin: 20px 0 0; padding: 0; display: grid; gap: 12px; list-style: none; }.finding-card li { display: flex; align-items: flex-start; gap: 9px; color: #525a4f; font-size: 11px; line-height: 1.55; }.finding-card li :global(svg) { flex: 0 0 auto; margin-top: 1px; color: #648f12; }.finding-card.limitation li :global(svg) { color: #a86b39; }
  .usecase-table { border: 1px solid #dfe2d9; border-radius: 15px; background: #fff; overflow: hidden; }.usecase-table article { min-height: 66px; padding: 12px 16px; display: grid; grid-template-columns: 54px 1fr auto; gap: 12px; align-items: center; }.usecase-table article + article { border-top: 1px solid #e5e8e0; }.usecase-table article > span { font-family: 'DM Mono', monospace; color: #858d81; font-size: 9px; }.usecase-table strong { display: block; font-size: 11px; }.usecase-table small { display: block; margin-top: 4px; color: #878f84; font-size: 9px; line-height: 1.4; }.usecase-table b { padding: 5px 8px; border-radius: 7px; color: #777f73; background: #edf0e9; font-size: 8px; }.usecase-table b.success { color: #557d0a; background: #eaf3d9; }.usecase-table b.failed { color: #a24a3f; background: #f7e3df; }.usecase-table b.partial { color: #97611e; background: #faefd9; }
  .detail-head { align-items: center; }.filters { display: flex; gap: 7px; }.filters select { padding: 8px 28px 8px 9px; border: 1px solid #d6dbd1; border-radius: 8px; color: #60685d; background: #fff; font-size: 9px; }.sample-table-wrap { overflow-x: auto; border: 1px solid #dfe2d9; border-radius: 15px; background: #fff; }table { width: 100%; min-width: 940px; border-collapse: collapse; }th { padding: 11px 13px; color: #858d81; background: #f2f4ee; font-family: 'DM Mono', monospace; font-size: 8px; font-weight: 500; text-align: left; }td { padding: 11px 13px; border-top: 1px solid #e7e9e3; color: #555d52; font-family: 'DM Mono', monospace; font-size: 8px; }td strong { display: block; color: #333a31; font-size: 9px; }td small { display: block; max-width: 330px; margin-top: 3px; overflow: hidden; color: #90978d; font-family: 'Manrope', sans-serif; white-space: nowrap; text-overflow: ellipsis; }.sample-status { padding: 4px 6px; border-radius: 5px; background: #edf0e9; }.sample-status.success { color: #557d0a; background: #eaf3d9; }.sample-status.failed, .sample-status.unsupported { color: #a24a3f; background: #f7e3df; }
  .pagination { min-height: 50px; margin-top: 10px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border: 1px solid #dfe2d9; border-radius: 12px; background: #fff; color: #81897e; font-family: 'DM Mono', monospace; font-size: 8px; }.pagination-controls, .pagination-controls label { display: flex; align-items: center; gap: 8px; }.pagination select { padding: 6px 22px 6px 7px; border: 1px solid #d9ddd4; border-radius: 7px; color: #555d52; background: #f8f9f5; font-size: 9px; }.pagination button { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid #d9ddd4; border-radius: 8px; background: #fff; color: #515a4e; cursor: pointer; }.pagination button:hover:not(:disabled) { border-color: #9baa8c; background: #f2f6e9; }.pagination button:disabled { opacity: .38; cursor: default; }.pagination strong { color: #35402f; font-weight: 600; }
  .methodology { margin-top: 36px; padding: 18px 0; display: flex; flex-wrap: wrap; gap: 10px 20px; border-top: 1px solid #dfe2d9; color: #858d81; font-size: 8px; }.methodology strong { color: #4e564b; }.empty-report { height: calc(100vh - 66px); display: grid; place-content: center; justify-items: center; text-align: center; }.empty-report :global(svg) { color: #6f9f12; }.empty-report h1 { margin: 16px 0 8px; }.empty-report p { color: #7d8579; font-size: 12px; }
  @media (max-width: 850px) { .report-hero { grid-template-columns: 1fr; }.run-stamp { width: min(100%, 360px); }.metric-grid { grid-template-columns: repeat(2, 1fr); }.metric-grid article:nth-child(3) { border-left: 0; border-top: 1px solid #e4e7df; }.metric-grid article:nth-child(4) { border-top: 1px solid #e4e7df; }.model-grid, .findings-grid { grid-template-columns: 1fr; } }
  @media (max-width: 560px) { .report-nav { padding: 0 14px; grid-template-columns: 1fr auto; }.brand-mini { display: none; }.report-content { width: calc(100% - 28px); padding-top: 38px; }.report-hero h1 { font-size: 43px; }.metric-grid { grid-template-columns: 1fr 1fr; }.metric-grid article { padding: 15px; }.model-card dl { grid-template-columns: repeat(2, 1fr); }.model-card dl div:nth-child(3) { border-top: 1px solid #e5e8e0; border-left: 0; }.model-card dl div:nth-child(4) { border-left: 1px solid #e5e8e0; }.model-card dl div:nth-child(5) { border-left: 0; }.usecase-table article { grid-template-columns: 42px 1fr; }.usecase-table b { grid-column: 2; justify-self: start; }.section-heading { align-items: flex-start; flex-direction: column; }.detail-head { align-items: stretch; }.filters select { max-width: 50%; }.section-heading > span { display: none; }.pagination { align-items: flex-start; flex-direction: column; }.pagination-controls { width: 100%; justify-content: space-between; }.pagination-controls > span { text-align: center; } }
</style>
