<script lang="ts">
  import * as echarts from 'echarts/core';
  import { BarChart, LineChart } from 'echarts/charts';
  import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
  import { CanvasRenderer } from 'echarts/renderers';
  import { onMount } from 'svelte';
  import type { PocReport } from '$lib/poc/types';

  echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

  let { report }: { report: PocReport } = $props();
  let latencyNode: HTMLDivElement;
  let loadNode: HTMLDivElement;
  let latencyChart: echarts.ECharts | undefined;
  let loadChart: echarts.ECharts | undefined;

  const palette = ['#6f9f12', '#294c7a', '#c67a26'];
  const concurrencyRows = () => {
    const groups = new Map<string, { model: string; concurrency: number; values: number[]; successes: number; total: number }>();
    for (const sample of report.samples) {
      const concurrency = Number(sample.metadata?.concurrency || 0);
      if (!concurrency || !sample.scenario.startsWith('concurrency-')) continue;
      const key = `${sample.model}:${concurrency}`;
      const row = groups.get(key) || { model: sample.model, concurrency, values: [], successes: 0, total: 0 };
      row.total += 1;
      if (sample.status === 'success') {
        row.successes += 1;
        row.values.push(sample.latencyMs);
      }
      groups.set(key, row);
    }
    return [...groups.values()].sort((a, b) => a.concurrency - b.concurrency);
  };

  function latencyOption() {
    return {
      color: palette,
      animationDuration: 550,
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { color: '#687065', fontSize: 10 } },
      grid: { top: 22, right: 16, bottom: 42, left: 54 },
      xAxis: { type: 'category', data: report.aggregates.map((item) => item.model), axisLabel: { color: '#687065', fontSize: 10 } },
      yAxis: { type: 'value', name: 'ms', nameTextStyle: { color: '#91988e' }, axisLabel: { color: '#91988e' }, splitLine: { lineStyle: { color: '#edf0e8' } } },
      series: [
        { name: 'P50', type: 'bar', data: report.aggregates.map((item) => item.p50LatencyMs || 0), barMaxWidth: 38, itemStyle: { borderRadius: [5, 5, 0, 0] } },
        { name: 'P95', type: 'bar', data: report.aggregates.map((item) => item.p95LatencyMs || 0), barMaxWidth: 38, itemStyle: { borderRadius: [5, 5, 0, 0] } },
        { name: 'TTFT median', type: 'bar', data: report.aggregates.map((item) => item.medianTtftMs || 0), barMaxWidth: 38, itemStyle: { borderRadius: [5, 5, 0, 0] } }
      ]
    };
  }

  function loadOption() {
    const rows = concurrencyRows();
    const levels = [...new Set(rows.map((row) => row.concurrency))];
    return {
      color: palette,
      animationDuration: 550,
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, textStyle: { color: '#687065', fontSize: 10 } },
      grid: { top: 22, right: 16, bottom: 42, left: 54 },
      xAxis: { type: 'category', name: 'concurrency', data: levels, axisLabel: { color: '#687065' } },
      yAxis: { type: 'value', name: 'ms', nameTextStyle: { color: '#91988e' }, axisLabel: { color: '#91988e' }, splitLine: { lineStyle: { color: '#edf0e8' } } },
      series: report.targetModels.map((model) => ({
        name: model,
        type: 'line',
        smooth: 0.25,
        connectNulls: false,
        data: levels.map((level) => {
          const row = rows.find((item) => item.model === model && item.concurrency === level);
          return row?.values.length ? Math.round(row.values.reduce((sum, value) => sum + value, 0) / row.values.length) : null;
        })
      }))
    };
  }

  onMount(() => {
    latencyChart = echarts.init(latencyNode, undefined, { renderer: 'canvas' });
    loadChart = echarts.init(loadNode, undefined, { renderer: 'canvas' });
    latencyChart.setOption(latencyOption());
    loadChart.setOption(loadOption());
    const observer = new ResizeObserver(() => { latencyChart?.resize(); loadChart?.resize(); });
    observer.observe(latencyNode);
    observer.observe(loadNode);
    return () => { observer.disconnect(); latencyChart?.dispose(); loadChart?.dispose(); };
  });
</script>

<div class="charts-grid">
  <section class="chart-card">
    <div><span>LATENCY DISTRIBUTION</span><h3>P50, P95 dan TTFT</h3></div>
    <div class="chart" bind:this={latencyNode} aria-label="Perbandingan latency model"></div>
  </section>
  <section class="chart-card">
    <div><span>LOAD RESPONSE</span><h3>Latency per concurrency</h3></div>
    <div class="chart" bind:this={loadNode} aria-label="Latency berdasarkan concurrency"></div>
  </section>
</div>

<style>
  .charts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .chart-card { min-width: 0; padding: 20px; border: 1px solid #dfe2d9; border-radius: 16px; background: #fff; box-shadow: 0 10px 28px rgba(37,49,31,.04); }
  .chart-card span { color: #8d9589; font-family: 'DM Mono', monospace; font-size: 9px; letter-spacing: .12em; }
  .chart-card h3 { margin: 5px 0 0; font-size: 14px; }
  .chart { width: 100%; height: 300px; margin-top: 8px; }
  @media (max-width: 820px) { .charts-grid { grid-template-columns: 1fr; } }
</style>
