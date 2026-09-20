<script lang="ts">
  import * as echarts from 'echarts/core';
  import { LineChart } from 'echarts/charts';
  import { GridComponent, TooltipComponent } from 'echarts/components';
  import { CanvasRenderer } from 'echarts/renderers';
  import { onMount } from 'svelte';

  echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

  let { points = [] }: { points: number[] } = $props();
  let node: HTMLDivElement;
  let chart: echarts.ECharts | undefined;

  const option = () => ({
    animationDuration: 360,
    grid: { top: 8, right: 4, bottom: 4, left: 4 },
    xAxis: {
      type: 'category',
      show: false,
      boundaryGap: false,
      data: points.map((_, index) => index)
    },
    yAxis: { type: 'value', show: false, min: 0 },
    tooltip: { show: false },
    series: [
      {
        type: 'line',
        data: points,
        smooth: 0.45,
        showSymbol: false,
        lineStyle: { color: '#6f9f12', width: 2 },
        areaStyle: { color: 'rgba(111, 159, 18, 0.1)' }
      }
    ]
  });

  onMount(() => {
    chart = echarts.init(node, undefined, { renderer: 'canvas' });
    chart.setOption(option());
    const observer = new ResizeObserver(() => chart?.resize());
    observer.observe(node);

    return () => {
      observer.disconnect();
      chart?.dispose();
    };
  });

  $effect(() => {
    points;
    chart?.setOption(option());
  });
</script>

<div class="chart" bind:this={node} aria-label="Grafik throughput token"></div>

<style>
  .chart {
    width: 100%;
    height: 76px;
  }
</style>
