/**
 * Probe ketersediaan: satu permintaan ringan ke tiap pasangan model-supplier setiap
 * beberapa menit, untuk menangkap kegagalan sesaat seperti
 * "Failed to get available channel for model X under group Y" yang tidak terlihat
 * pada uji beban singkat. Hasil digabung ke laporan sebagai skenario `ketersediaan`.
 *   bun scripts/poc/probe-availability.ts --session=S2 --minutes=60 --every=2 --keys=keys.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MATRIX, SUPPLIER_RATIO, type Supplier } from './config';
import { streamChat } from './client';

const arg = (name: string, fallback = '') =>
  (process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')) ?? fallback;
const SESSION = arg('session', 'S2');
const OUT = resolve(arg('out', 'data/poc-suppliers.json'));
const MINUTES = Number(arg('minutes', '60'));
const EVERY = Number(arg('every', '2'));
const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`);

const keys: Record<Supplier, string> = arg('keys')
  ? JSON.parse(await readFile(resolve(arg('keys')), 'utf8'))
  : Object.fromEntries(Object.keys(SUPPLIER_RATIO).map((s) => [s, process.env[`TOKENKU_KEY_${s.toUpperCase()}`] ?? ''])) as Record<Supplier, string>;

const pairs = MATRIX.flatMap((m) => m.suppliers.map((supplier) => ({ model: m.model, supplier })));
const samples: Record<string, unknown>[] = [];
const rounds = Math.max(1, Math.floor(MINUTES / EVERY));
log(`probe ketersediaan: ${pairs.length} pasangan, tiap ${EVERY} menit selama ${MINUTES} menit (${rounds} putaran)`);

for (let round = 0; round < rounds; round++) {
  const started = Date.now();
  const results = await Promise.all(pairs.map(async (p, i) => {
    const r = await streamChat(keys[p.supplier], p.model, [{ role: 'user', content: 'Balas satu kata: siap.' }], 256, 120_000);
    return {
      session: SESSION, model: p.model, supplier: p.supplier, scenario: 'ketersediaan', index: round * pairs.length + i,
      ok: r.ok, status: r.status, ...(r.error ? { error: r.error } : {}), ...(r.failureKind ? { failureKind: r.failureKind } : {}),
      ttftAnyMs: r.ttftAnyMs === null ? null : Math.round(r.ttftAnyMs), ttftMs: r.ttftMs === null ? null : Math.round(r.ttftMs),
      latencyMs: Math.round(r.latencyMs), inputTokens: r.inputTokens, outputTokens: r.outputTokens, reasoningTokens: r.reasoningTokens,
      finishReason: r.finishReason, emptyContent: r.emptyContent, probedAt: new Date(started).toISOString()
    };
  }));
  samples.push(...results);
  const failed = results.filter((r) => !r.ok);
  log(`putaran ${round + 1}/${rounds}: ${results.length - failed.length} ok, ${failed.length} gagal${failed.length ? ' — ' + failed.map((f) => `${f.model}@${f.supplier} ${f.status} ${(f.error || '').slice(0, 60)}`).join('; ') : ''}`);
  const wait = EVERY * 60_000 - (Date.now() - started);
  if (round < rounds - 1 && wait > 0) await new Promise((r) => setTimeout(r, wait));
}

const report = JSON.parse(await readFile(OUT, 'utf8'));
report.samples = [...report.samples.filter((s: any) => !(s.session === SESSION && s.scenario === 'ketersediaan')), ...samples];
await writeFile(OUT, JSON.stringify(report, null, 2), 'utf8');
log(`${samples.length} sampel ketersediaan ditulis ke ${OUT}`);
