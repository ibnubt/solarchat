<script lang="ts">
  import * as echarts from 'echarts/core';
  import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
  import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
  import { CanvasRenderer } from 'echarts/renderers';
  import { BarChart3, Braces, Download, Table2 } from 'lucide-svelte';
  import CopyButton from './CopyButton.svelte';
  import { buildChartOption, formatValue, normalizeChartSpec, SERIES_COLORS, type ChartSpec } from './chart';

  echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

  let {
    source = '',
    spec: providedSpec = null,
    streaming = false,
    embedded = false
  }: { source?: string; spec?: ChartSpec | null; streaming?: boolean; embedded?: boolean } = $props();

  const parsed = $derived.by(() => {
    if (providedSpec) return { spec: providedSpec, error: '' };
    try {
      return { spec: normalizeChartSpec(JSON.parse(source)), error: '' };
    } catch (error) {
      return { spec: null, error: error instanceof SyntaxError ? 'JSON grafik tidak valid.' : (error as Error).message };
    }
  });

  let view: 'chart' | 'data' | 'code' = $state('chart');
  let node: HTMLDivElement | undefined = $state();
  let width = $state(0);
  let chart: echarts.ECharts | undefined = $state.raw();
  const compact = $derived(width > 0 && width < 520);
  const hasSpec = $derived(parsed.spec !== null);
  const pieLike = $derived(parsed.spec?.type === 'pie' || parsed.spec?.type === 'doughnut');

  $effect(() => {
    if (!node || !hasSpec || view !== 'chart') return;
    const instance = echarts.init(node, undefined, { renderer: 'canvas' });
    chart = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(node);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart = undefined;
    };
  });

  $effect(() => {
    if (chart && parsed.spec) chart.setOption(buildChartOption(parsed.spec, compact), true);
  });

  function downloadPng() {
    if (!chart) return;
    const link = document.createElement('a');
    link.href = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    link.download = `${(parsed.spec?.title || 'grafik').replace(/[^\w\- ]+/g, '').trim() || 'grafik'}.png`;
    link.click();
  }
</script>

{#if !parsed.spec}
  {#if streaming}
    <div class="rb rb-pending"><BarChart3 size={16} /><span>Menyiapkan grafik…</span></div>
  {:else}
    <figure class="rb rb-code">
      <figcaption class="rb-toolbar dark"><span class="rb-label">chart · {parsed.error}</span><div class="rb-actions"><CopyButton text={() => source} label="Salin JSON" /></div></figcaption>
      <pre><code>{source}</code></pre>
    </figure>
  {/if}
{:else}
  <figure class="rb rb-chart" class:embedded bind:clientWidth={width}>
    <figcaption class="rb-toolbar">
      <span class="rb-title">{parsed.spec.title || (embedded ? '' : 'Grafik')}</span>
      <div class="rb-actions">
        {#if !embedded}
        <div class="rb-segment" role="tablist" aria-label="Tampilan grafik">
          <button type="button" role="tab" aria-selected={view === 'chart'} class:active={view === 'chart'} onclick={() => (view = 'chart')}><BarChart3 size={14} /><span>Grafik</span></button>
          <button type="button" role="tab" aria-selected={view === 'data'} class:active={view === 'data'} onclick={() => (view = 'data')}><Table2 size={14} /><span>Data</span></button>
          {#if source}<button type="button" role="tab" aria-selected={view === 'code'} class:active={view === 'code'} onclick={() => (view = 'code')}><Braces size={14} /><span>JSON</span></button>{/if}
        </div>
        {/if}
        {#if view === 'chart'}<button type="button" class="rb-action icon" onclick={downloadPng} aria-label="Unduh PNG" title="Unduh PNG"><Download size={14} /></button>{/if}
      </div>
    </figcaption>

    {#if view === 'chart'}
      <div class="rb-canvas" class:pie={pieLike} bind:this={node} role="img" aria-label={parsed.spec.title || 'Grafik'}></div>
    {:else if view === 'data'}
      <div class="rb-scroll">
        <table class="rb-table">
          {#if parsed.spec.type === 'scatter'}
            <thead><tr><th>Seri</th><th class="num">{parsed.spec.xLabel || 'X'}</th><th class="num">{parsed.spec.yLabel || 'Y'}</th></tr></thead>
            <tbody>
              {#each parsed.spec.series as item, index}
                {#each item.points || [] as point}
                  <tr><td><i class="rb-swatch" style={`background:${SERIES_COLORS[index]}`}></i>{item.name}</td><td class="num">{formatValue(point[0])}</td><td class="num">{formatValue(point[1], parsed.spec.unit)}</td></tr>
                {/each}
              {/each}
            </tbody>
          {:else}
            <thead>
              <tr>
                <th>{parsed.spec.xLabel || 'Label'}</th>
                {#each pieLike ? parsed.spec.series.slice(0, 1) : parsed.spec.series as item, index}<th class="num">{#if !pieLike}<i class="rb-swatch" style={`background:${SERIES_COLORS[index]}`}></i>{/if}{item.name}</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each parsed.spec.labels as label, row}
                <tr>
                  <td>{label}</td>
                  {#each pieLike ? parsed.spec.series.slice(0, 1) : parsed.spec.series as item}<td class="num">{formatValue(item.data[row], parsed.spec.unit)}</td>{/each}
                </tr>
              {/each}
            </tbody>
          {/if}
        </table>
      </div>
    {:else}
      <pre class="rb-json"><code>{source}</code></pre>
    {/if}
  </figure>
{/if}
