<script lang="ts">
  import { BarChart3, FileDown, Table2 } from 'lucide-svelte';
  import ChartBlock from './ChartBlock.svelte';
  import CopyButton from './CopyButton.svelte';
  import type { ChartSpec } from './chart';
  import { parseNumber, type TableData } from './parse';

  const PREVIEW_ROWS = 30;
  let { table }: { table: TableData } = $props();

  let view: 'table' | 'chart' = $state('table');
  let showAll = $state(false);

  // Kolom dianggap angka bila ≥80% sel terisinya bisa dibaca sebagai angka.
  const numericColumns = $derived(
    table.header.map((_, column) => {
      const cells = table.rows.map((row) => row[column] ?? '').filter((cell) => cell.trim() && cell.trim() !== '-');
      return cells.length > 0 && cells.filter((cell) => parseNumber(cell) !== null).length / cells.length >= 0.8;
    })
  );

  // Satu sumbu Y: kolom persen tidak dicampur dengan kolom nilai, dan seri yang >50× lebih kecil dibuang.
  const chartColumns = $derived.by(() => {
    const numeric = numericColumns.map((isNumeric, index) => (isNumeric && index > 0 ? index : -1)).filter((index) => index > 0);
    const isPercent = (column: number) => table.rows.filter((row) => /%\s*$/.test(row[column] ?? '')).length >= table.rows.length * 0.8;
    const plain = numeric.filter((column) => !isPercent(column));
    const sameUnit = plain.length ? plain : numeric;
    const peak = (column: number) => Math.max(...table.rows.map((row) => Math.abs(parseNumber(row[column] ?? '') ?? 0)));
    const largest = Math.max(...sameUnit.map(peak), 0);
    return sameUnit.filter((column) => largest === 0 || peak(column) * 50 >= largest).slice(0, 8);
  });

  const chartSpec = $derived.by((): ChartSpec | null => {
    const columns = chartColumns;
    if (!columns.length || table.rows.length < 2) return null;
    return {
      type: table.rows.length > 12 ? 'line' : 'bar',
      labels: table.rows.map((row) => row[0] ?? ''),
      series: columns.map((column) => ({ name: table.header[column] || `Kolom ${column + 1}`, data: table.rows.map((row) => parseNumber(row[column] ?? '')) })),
      xLabel: table.header[0]
    };
  });

  const visibleRows = $derived(showAll ? table.rowsHtml : table.rowsHtml.slice(0, PREVIEW_ROWS));
  const alignOf = (column: number) => table.align[column] || (numericColumns[column] ? 'right' : null);

  const asDelimited = (separator: string) => {
    const quote = (value: string) => (separator === ',' && /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value.replace(/\t|\n/g, ' '));
    return [table.header, ...table.rows].map((row) => row.map(quote).join(separator)).join('\n');
  };

  function downloadCsv() {
    const blob = new Blob(['﻿', asDelimited(',')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tabel.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<figure class="rb rb-table-block">
  <figcaption class="rb-toolbar">
    <span class="rb-title">{table.rows.length} baris · {table.header.length} kolom</span>
    <div class="rb-actions">
      {#if chartSpec}
        <div class="rb-segment" role="tablist" aria-label="Tampilan tabel">
          <button type="button" role="tab" aria-selected={view === 'table'} class:active={view === 'table'} onclick={() => (view = 'table')}><Table2 size={14} /><span>Tabel</span></button>
          <button type="button" role="tab" aria-selected={view === 'chart'} class:active={view === 'chart'} onclick={() => (view = 'chart')}><BarChart3 size={14} /><span>Grafik</span></button>
        </div>
      {/if}
      <CopyButton text={() => asDelimited('\t')} label="Salin" />
      <button type="button" class="rb-action" onclick={downloadCsv} aria-label="Unduh CSV" title="Unduh CSV"><FileDown size={14} /><span>CSV</span></button>
    </div>
  </figcaption>

  {#if view === 'chart' && chartSpec}
    <ChartBlock spec={chartSpec} embedded />
  {:else}
    <div class="rb-scroll">
      <table class="rb-table">
        <thead><tr>{#each table.headerHtml as cell, column}<th style:text-align={alignOf(column)}>{@html cell}</th>{/each}</tr></thead>
        <tbody>
          {#each visibleRows as row}
            <tr>{#each row as cell, column}<td class:num={numericColumns[column]} style:text-align={alignOf(column)}>{@html cell}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if table.rowsHtml.length > PREVIEW_ROWS}
      <button type="button" class="rb-more" onclick={() => (showAll = !showAll)}>
        {showAll ? 'Tampilkan lebih sedikit' : `Tampilkan semua ${table.rowsHtml.length} baris`}
      </button>
    {/if}
  {/if}
</figure>
