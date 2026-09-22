import { parseNumber } from './parse';

// Palet kategorikal tervalidasi (CVD & normal-vision) untuk permukaan putih; urutan tetap, tidak diputar ulang.
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#5d870d', '#4a3aa7', '#e34948'];
const MAX_SERIES = SERIES_COLORS.length;
const INK = { primary: '#20241f', secondary: '#5f665c', muted: '#8a9187', grid: '#edf0e8', axis: '#cfd5c9', surface: '#ffffff' };

export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter';
export type SeriesKind = 'bar' | 'line' | 'area';
export type ChartSeries = { name: string; data: Array<number | null>; points?: Array<[number, number]>; type?: SeriesKind };
export type ChartSpec = {
  type: ChartType;
  title?: string;
  labels: string[];
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
  unit?: string;
  stacked?: boolean;
  horizontal?: boolean;
};

const TYPE_ALIASES: Record<string, ChartType> = {
  bar: 'bar', column: 'bar', columns: 'bar', histogram: 'bar', horizontalbar: 'bar',
  line: 'line', spline: 'line', timeseries: 'line',
  area: 'area',
  pie: 'pie',
  doughnut: 'doughnut', donut: 'doughnut',
  scatter: 'scatter', bubble: 'scatter'
};

const asRecord = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const asText = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return parseNumber(value);
  const record = asRecord(value);
  if (record && 'value' in record) return toNumber(record.value);
  if (record && 'y' in record) return toNumber(record.y);
  return null;
}

function toPoint(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = toNumber(value[0]);
    const y = toNumber(value[1]);
    return x === null || y === null ? null : [x, y];
  }
  const record = asRecord(value);
  if (record) {
    const x = toNumber(record.x);
    const y = toNumber(record.y);
    return x === null || y === null ? null : [x, y];
  }
  return null;
}

/**
 * Terima spesifikasi sederhana SOLAR ({type, labels, series}) maupun gaya Chart.js
 * ({type, data: {labels, datasets}}). Opsi ECharts mentah sengaja tidak diteruskan.
 */
export function normalizeChartSpec(input: unknown): ChartSpec {
  const spec = asRecord(input);
  if (!spec) throw new Error('Spesifikasi grafik harus berupa objek JSON.');

  const chartJsData = asRecord(spec.data);
  const options = asRecord(spec.options);
  const rawType = asText(spec.type || spec.kind || spec.chart).toLowerCase().replace(/[\s_-]/g, '');
  const type: ChartType = TYPE_ALIASES[rawType] || 'bar';
  const horizontal = Boolean(spec.horizontal) || rawType === 'horizontalbar' || asText(options?.indexAxis) === 'y';

  const rawLabels = chartJsData?.labels ?? spec.labels ?? spec.categories ?? spec.x ?? asRecord(spec.xAxis)?.data;
  let rawSeries: unknown = chartJsData?.datasets ?? spec.series ?? spec.datasets;
  if (Array.isArray(spec.data) && !rawSeries) rawSeries = [{ name: asText(spec.name) || 'Nilai', data: spec.data }];
  if (Array.isArray(rawSeries) && rawSeries.length && !asRecord(rawSeries[0])) rawSeries = [{ name: 'Nilai', data: rawSeries }];
  if (!Array.isArray(rawSeries) || rawSeries.length === 0) throw new Error('Grafik membutuhkan minimal satu seri data.');

  let labels = Array.isArray(rawLabels) ? rawLabels.map(asText) : [];
  const series: ChartSeries[] = rawSeries.slice(0, MAX_SERIES).map((item, index) => {
    const record = asRecord(item) || {};
    const rawData = Array.isArray(record.data) ? record.data : Array.isArray(record.values) ? record.values : [];
    // Data pie gaya ECharts: [{name, value}] — label diambil dari nama item.
    if (!labels.length && rawData.length && asRecord(rawData[0])?.name !== undefined) labels = rawData.map((entry) => asText(asRecord(entry)?.name));
    const kindText = asText(record.type).toLowerCase();
    const kind = kindText === 'bar' || kindText === 'line' || kindText === 'area' ? kindText : undefined;
    return {
      name: asText(record.name ?? record.label) || `Seri ${index + 1}`,
      data: rawData.map(toNumber),
      ...(type === 'scatter' ? { points: rawData.map(toPoint).filter((point): point is [number, number] => point !== null) } : {}),
      ...(kind ? { type: kind } : {})
    };
  });

  const hasValues = type === 'scatter'
    ? series.some((item) => item.points?.length)
    : series.some((item) => item.data.some((value) => value !== null));
  if (!hasValues) throw new Error('Seri grafik tidak berisi angka.');

  const longest = Math.max(...series.map((item) => item.data.length));
  if (labels.length < longest) labels = [...labels, ...Array.from({ length: longest - labels.length }, (_, index) => String(labels.length + index + 1))];

  const title = asText(spec.title) || asText(asRecord(asRecord(options?.plugins)?.title)?.text);
  return {
    type,
    labels,
    series,
    ...(title ? { title } : {}),
    ...(asText(spec.xLabel ?? spec.xTitle) ? { xLabel: asText(spec.xLabel ?? spec.xTitle) } : {}),
    ...(asText(spec.yLabel ?? spec.yTitle) ? { yLabel: asText(spec.yLabel ?? spec.yTitle) } : {}),
    ...(asText(spec.unit) ? { unit: asText(spec.unit) } : {}),
    stacked: Boolean(spec.stacked ?? spec.stack),
    horizontal
  };
}

const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 });

// Tick sumbu memakai satu format: angka penuh ber-titik ribuan, ringkas (rb/jt) hanya untuk ≥10.000.
const axisNumber = (value: number) => (Math.abs(value) >= 10_000 ? compactFormat.format(value) : numberFormat.format(value));

export const formatValue = (value: unknown, unit?: string) =>
  typeof value === 'number' && Number.isFinite(value) ? `${numberFormat.format(value)}${unit ? ` ${unit}` : ''}` : '—';

/** Pie dengan >8 irisan dilipat menjadi "Lainnya" agar warna tidak perlu dibuat baru. */
function pieData(spec: ChartSpec) {
  const values = spec.series[0].data;
  const items = spec.labels
    .map((name, index) => ({ name, value: values[index] ?? null }))
    .filter((item): item is { name: string; value: number } => item.value !== null && item.value > 0);
  if (items.length <= MAX_SERIES) return items;
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const rest = sorted.slice(MAX_SERIES - 1).reduce((total, item) => total + item.value, 0);
  return [...sorted.slice(0, MAX_SERIES - 1), { name: 'Lainnya', value: rest }];
}

export function buildChartOption(spec: ChartSpec, compact: boolean) {
  const valueFormatter = (value: unknown) => formatValue(value, spec.unit);
  const textStyle = { color: INK.secondary, fontSize: 11, fontFamily: 'Manrope, sans-serif' };
  const multi = spec.series.length > 1;
  const legend = { show: multi, type: 'scroll', top: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 14, textStyle };

  if (spec.type === 'pie' || spec.type === 'doughnut') {
    return {
      color: SERIES_COLORS,
      animationDuration: 450,
      tooltip: { trigger: 'item', valueFormatter, textStyle: { fontSize: 12 } },
      legend: { ...legend, show: true, type: 'scroll', top: 'auto', bottom: 0 },
      series: [{
        type: 'pie',
        radius: spec.type === 'doughnut' ? ['46%', '70%'] : [0, '70%'],
        center: ['50%', '45%'],
        itemStyle: { borderColor: INK.surface, borderWidth: 2, borderRadius: 4 },
        label: { show: !compact, color: INK.secondary, fontSize: 11, formatter: '{b}: {d}%' },
        labelLine: { lineStyle: { color: INK.axis } },
        emphasis: { scale: true, scaleSize: 4 },
        data: pieData(spec)
      }]
    };
  }

  const scatter = spec.type === 'scatter';
  const categoryAxis = {
    type: 'category',
    data: spec.labels,
    name: spec.horizontal ? undefined : spec.xLabel,
    nameLocation: 'middle',
    nameGap: 30,
    nameTextStyle: { color: INK.muted, fontSize: 11 },
    axisLine: { lineStyle: { color: INK.axis } },
    axisTick: { show: false },
    axisLabel: { color: INK.muted, fontSize: 11, hideOverlap: true }
  };
  const valueAxis = (name?: string) => ({
    type: 'value',
    name,
    nameTextStyle: { color: INK.muted, fontSize: 11, align: 'left' },
    axisLabel: { color: INK.muted, fontSize: 11, formatter: axisNumber },
    splitLine: { lineStyle: { color: INK.grid } }
  });

  const pointCount = spec.labels.length;
  const lastBarSeries = spec.series.reduce((last, item, index) => ((item.type ?? spec.type) === 'bar' ? index : last), -1);
  const series = spec.series.map((item, index) => {
    if (scatter) {
      return { type: 'scatter', name: item.name, data: item.points || [], symbolSize: 9, itemStyle: { borderColor: INK.surface, borderWidth: 2 } };
    }
    const kind = item.type ?? (spec.type === 'area' ? 'area' : spec.type === 'line' ? 'line' : 'bar');
    if (kind === 'bar') {
      const roundEnd = !spec.stacked || index === lastBarSeries;
      const radius = roundEnd ? (spec.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0;
      // Label nilai hanya bila batangnya sedikit dan satu seri — selektif, bukan di setiap titik.
      const showLabel = !multi && pointCount <= 12 && !compact;
      return {
        type: 'bar',
        name: item.name,
        data: item.data,
        stack: spec.stacked ? 'total' : undefined,
        barMaxWidth: 34,
        itemStyle: { borderRadius: radius, borderColor: INK.surface, borderWidth: 1 },
        label: { show: showLabel, position: spec.horizontal ? 'right' : 'top', color: INK.secondary, fontSize: 10, formatter: (params: { value: number }) => compactFormat.format(params.value) },
        emphasis: { focus: 'series' }
      };
    }
    const endLabel = multi && spec.series.length <= 4 && !compact;
    return {
      type: 'line',
      name: item.name,
      data: item.data,
      stack: spec.stacked && kind === 'area' ? 'total' : undefined,
      connectNulls: false,
      showSymbol: pointCount <= 24,
      symbol: 'circle',
      symbolSize: 8,
      lineStyle: { width: 2 },
      itemStyle: { borderColor: INK.surface, borderWidth: 2 },
      areaStyle: kind === 'area' ? { opacity: 0.14 } : undefined,
      endLabel: { show: endLabel, formatter: '{a}', color: INK.secondary, fontSize: 11, distance: 6 },
      emphasis: { focus: 'series' }
    };
  });

  const hasLineEndLabels = series.some((item) => (item as { endLabel?: { show: boolean } }).endLabel?.show);
  return {
    color: SERIES_COLORS,
    animationDuration: 450,
    tooltip: {
      trigger: scatter ? 'item' : 'axis',
      axisPointer: { type: spec.type === 'bar' ? 'shadow' : 'line', lineStyle: { color: INK.axis } },
      valueFormatter,
      confine: true,
      textStyle: { fontSize: 12 }
    },
    legend,
    grid: { top: multi ? 38 : 14, right: hasLineEndLabels ? 84 : 14, bottom: spec.xLabel && !spec.horizontal ? 30 : 6, left: 6, containLabel: true },
    xAxis: scatter ? { ...valueAxis(spec.xLabel), splitLine: { show: false } } : spec.horizontal ? valueAxis(spec.yLabel) : categoryAxis,
    yAxis: scatter ? valueAxis(spec.yLabel) : spec.horizontal ? { ...categoryAxis, inverse: true } : valueAxis(spec.yLabel),
    series
  };
}
