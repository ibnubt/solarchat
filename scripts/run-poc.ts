import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { PocAggregate, PocReport, PocSample, PocStatus, PocUseCaseResult } from '../src/lib/poc/types';

const apiKey = process.env.TOKENKU_API_KEY;
const endpoint = process.env.TOKENKU_API_URL || 'https://api.tokenku.ai/v1/chat/completions';
const modelsEndpoint = endpoint.replace(/\/chat\/completions\/?$/, '/models');
const reportPath = resolve(process.env.POC_REPORT_FILE || './data/poc-report.json');
const targetModels = ['gpt-5.6-luna', 'deepseek-v4-flash'];
let runId = `poc-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
let startedAt = new Date().toISOString();
const samples: PocSample[] = [];
let availableModels: string[] = [];

if (!apiKey) throw new Error('TOKENKU_API_KEY belum dikonfigurasi.');

type Message = { role: 'system' | 'user' | 'assistant' | 'tool'; content: unknown; tool_call_id?: string };
type RequestOptions = {
  useCase: string;
  scenario: string;
  model: string;
  messages: Message[];
  maxTokens?: number;
  timeoutMs?: number;
  tools?: unknown[];
  toolChoice?: unknown;
  metadata?: PocSample['metadata'];
};

const round = (value: number) => Math.round(value * 10) / 10;
const estimateTokens = (value: unknown) => Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round(sorted[index]);
};
const median = (values: number[]) => percentile(values, 50);
const errorText = (raw: string) => {
  try {
    const parsed = JSON.parse(raw);
    return String(parsed?.error?.message || parsed?.error || parsed?.message || raw).slice(0, 500);
  } catch { return raw.slice(0, 500); }
};

async function perform(options: RequestOptions): Promise<PocSample> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 180_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  const startedIso = new Date().toISOString();
  let httpStatus: number | null = null;
  let firstTokenAt = 0;
  let output = '';
  let finishReason: string | null = null;
  let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {};
  const toolCalls = new Map<number, { name: string; arguments: string }>();
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens ?? 96,
    stream: true,
    stream_options: { include_usage: true }
  };
  if (options.tools) body.tools = options.tools;
  if (options.toolChoice) body.tool_choice = options.toolChoice;

  const makeSample = (overrides: Partial<PocSample>): PocSample => ({
    id: crypto.randomUUID(),
    useCase: options.useCase,
    scenario: options.scenario,
    model: options.model,
    status: 'failed',
    startedAt: startedIso,
    httpStatus,
    ttftMs: firstTokenAt ? round(firstTokenAt - started) : null,
    latencyMs: round(performance.now() - started),
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    outputTokensPerSecond: null,
    finishReason,
    metadata: { ...options.metadata },
    ...overrides
  });

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    httpStatus = response.status;
    if (!response.ok || !response.body) {
      const message = errorText(await response.text());
      const unsupported = /model_not_found|no available channel|not supported/i.test(message);
      return makeSample({ status: unsupported ? 'unsupported' : 'failed', error: message });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const processEvent = (event: string) => {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const payload = JSON.parse(data);
          if (payload.usage) usage = { ...usage, ...payload.usage };
          const choice = payload.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta = choice?.delta;
          if (delta?.content) {
            if (!firstTokenAt) firstTokenAt = performance.now();
            output += delta.content;
          }
          if (Array.isArray(delta?.tool_calls)) {
            if (!firstTokenAt) firstTokenAt = performance.now();
            for (const call of delta.tool_calls) {
              const index = Number(call.index || 0);
              const current = toolCalls.get(index) || { name: '', arguments: '' };
              current.name += call.function?.name || '';
              current.arguments += call.function?.arguments || '';
              toolCalls.set(index, current);
            }
          }
        } catch { /* Event non-JSON/keep-alive tidak masuk statistik. */ }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      events.forEach(processEvent);
    }
    if (buffer.trim()) processEvent(buffer);

    const ended = performance.now();
    const outputTokens = usage.completion_tokens ?? estimateTokens(output);
    const inputTokens = usage.prompt_tokens ?? estimateTokens(options.messages);
    const generationSeconds = firstTokenAt ? Math.max((ended - firstTokenAt) / 1000, 0.001) : null;
    return makeSample({
      status: 'success',
      ttftMs: firstTokenAt ? round(firstTokenAt - started) : null,
      latencyMs: round(ended - started),
      inputTokens,
      outputTokens,
      totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
      outputTokensPerSecond: generationSeconds ? round(outputTokens / generationSeconds) : null,
      metadata: {
        ...options.metadata,
        outputPreview: output.replace(/\s+/g, ' ').trim().slice(0, 280),
        outputChars: output.length,
        visibleEstimatedTokens: output ? estimateTokens(output) : 0,
        toolCallCount: toolCalls.size,
        toolCallName: toolCalls.get(0)?.name || '',
        toolCallArguments: toolCalls.get(0)?.arguments.slice(0, 300) || ''
      }
    });
  } catch (error) {
    const elapsed = performance.now() - started;
    const timedOut = controller.signal.aborted && elapsed >= timeoutMs * 0.9;
    const message = timedOut ? `Client timeout setelah ${timeoutMs} ms` : `Stream terputus: ${(error as Error).message}`;
    return makeSample({ error: message.slice(0, 500), metadata: { ...options.metadata, timeoutTriggered: timedOut, streamInterrupted: !timedOut } });
  } finally {
    clearTimeout(timeout);
  }
}

async function add(options: RequestOptions) {
  const sample = await perform(options);
  samples.push(sample);
  console.log(`${sample.status.toUpperCase().padEnd(11)} ${sample.useCase} ${sample.model} · ${sample.scenario} · ${sample.latencyMs} ms`);
  return sample;
}

function aggregate(model: string): PocAggregate {
  const rows = samples.filter((sample) => sample.model === model);
  const metricRows = rows.filter((sample) => sample.httpStatus !== null && sample.httpStatus >= 200 && sample.httpStatus < 300 && !sample.metadata?.excludeFromMetrics);
  const throughputRows = metricRows.filter((sample) => sample.useCase === 'UC-07' && sample.outputTokensPerSecond !== null);
  const attempted = rows.filter((sample) => !['skipped', 'unsupported'].includes(sample.status));
  const success = attempted.filter((sample) => sample.status === 'success').length;
  return {
    model,
    requests: rows.length,
    successful: rows.filter((sample) => sample.status === 'success').length,
    failed: rows.filter((sample) => sample.status === 'failed').length,
    unsupported: rows.filter((sample) => sample.status === 'unsupported').length,
    successRate: attempted.length ? round((success / attempted.length) * 100) : 0,
    p50LatencyMs: median(metricRows.map((sample) => sample.latencyMs)),
    p95LatencyMs: percentile(metricRows.map((sample) => sample.latencyMs), 95),
    p99LatencyMs: percentile(metricRows.map((sample) => sample.latencyMs), 99),
    medianTtftMs: median(metricRows.flatMap((sample) => sample.ttftMs === null ? [] : [sample.ttftMs])),
    medianOutputTokensPerSecond: median(throughputRows.flatMap((sample) => sample.outputTokensPerSecond === null ? [] : [sample.outputTokensPerSecond])),
    totalInputTokens: metricRows.reduce((sum, sample) => sum + (sample.inputTokens || 0), 0),
    totalOutputTokens: metricRows.reduce((sum, sample) => sum + (sample.outputTokens || 0), 0),
    maxSuccessfulInputTokens: Math.max(0, ...metricRows.map((sample) => sample.inputTokens || 0)),
    maxSuccessfulConcurrency: Math.max(0, ...metricRows.map((sample) => Number(sample.metadata?.concurrency || 0))),
    rateLimitOccurrences: rows.filter((sample) => sample.httpStatus === 429).length
  };
}

const definitions = [
  ['UC-01', 'Multi-Model Access'], ['UC-02', 'Model Switching'], ['UC-03', 'Long Context'],
  ['UC-04', 'Function / Tool Calling'], ['UC-05', 'Multimodal'], ['UC-06', 'Concurrent Request'],
  ['UC-07', 'High Token Generation'], ['UC-08', 'Model Latency Comparison'], ['UC-09', 'Sustained Load Test'],
  ['UC-10', 'Burst Traffic Test'], ['UC-11', 'Token Throughput Test'], ['UC-12', 'Payload Size Test'],
  ['UC-13', 'Response Size Test'], ['UC-14', 'Performance Consistency'], ['UC-15', 'Error & Timeout Test'],
  ['UC-16', 'Rate Limit Test'], ['UC-17', 'Cross-Model Performance'], ['UC-18', 'Aggregator Overhead']
] as const;

function useCaseRows(id: string) {
  const direct = samples.filter((sample) => sample.useCase === id);
  if (id === 'UC-08' || id === 'UC-17') return samples.filter((sample) => sample.useCase === 'UC-08' || (sample.useCase === 'UC-01' && sample.scenario === 'model-access-smoke'));
  if (id === 'UC-11') return samples.filter((sample) => ['UC-03', 'UC-07'].includes(sample.useCase));
  if (id === 'UC-12') return samples.filter((sample) => sample.useCase === 'UC-03');
  if (id === 'UC-13') return samples.filter((sample) => sample.useCase === 'UC-07');
  if (id === 'UC-14') return samples.filter((sample) => sample.useCase === 'UC-08');
  if (id === 'UC-16') return samples.filter((sample) => ['UC-06', 'UC-10'].includes(sample.useCase));
  return direct;
}

function useCases(): PocUseCaseResult[] {
  return definitions.map(([id, name]) => {
    const rows = useCaseRows(id);
    const statuses = new Set(rows.map((row) => row.status));
    let status: PocUseCaseResult['status'] = 'skipped';
    if (statuses.has('success') && (statuses.has('failed') || statuses.has('unsupported'))) status = 'partial';
    else if (statuses.has('success')) status = 'success';
    else if (statuses.has('failed')) status = 'failed';
    else if (statuses.has('unsupported')) status = 'unsupported';
    const ok = rows.filter((row) => row.status === 'success').length;
    const failed = rows.filter((row) => row.status === 'failed').length;
    const unsupported = rows.filter((row) => row.status === 'unsupported').length;
    const rateLimits = rows.filter((row) => row.httpStatus === 429).length;
    if (id === 'UC-16' && rateLimits === 0 && rows.some((row) => row.status === 'success')) status = 'partial';
    const summary = id === 'UC-16'
      ? `${rateLimits} rate-limit teramati dari ${rows.length} request load.`
      : id === 'UC-18'
        ? 'Tidak tersedia kredensial direct provider untuk baseline yang sebanding.'
        : `${ok} sukses, ${failed} gagal, ${unsupported} tidak didukung dari ${rows.length} bukti request.`;
    return { id, name, status, summary };
  });
}

function buildFindings(aggregates: PocAggregate[]) {
  const gpt = aggregates.find((item) => item.model === 'gpt-5.6-luna');
  const long = samples.filter((sample) => sample.useCase === 'UC-03' && sample.httpStatus === 200).sort((a, b) => (b.inputTokens || 0) - (a.inputTokens || 0))[0];
  const tool = samples.filter((sample) => sample.useCase === 'UC-04');
  const multimodal = samples.filter((sample) => sample.useCase === 'UC-05');
  const findings = aggregates.map((item) =>
    item.unsupported && !item.successful
      ? `${item.model} tidak tersedia pada grup akun Tokenku saat pengujian.`
      : `${item.model} menyelesaikan ${item.successful} request dengan success rate ${item.successRate}%.`
  );
  findings.push(
    gpt?.unsupported && !gpt.successful ? 'gpt-5.6-luna mengembalikan model_not_found.' : 'gpt-5.6-luna tersedia dan menerima request.',
    long ? `Long context terbesar yang diterima API tercatat ${long.inputTokens?.toLocaleString('id-ID')} input token dengan latency ${long.latencyMs.toLocaleString('id-ID')} ms.` : 'Tidak ada workload long context yang diterima API.',
    `${tool.filter((row) => row.status === 'success' && row.metadata?.toolCallValid).length}/${tool.length} tool-call menghasilkan nama fungsi dan JSON argument yang valid.`,
    multimodal.length
      ? `Multimodal: ${multimodal.map((item) => `${item.model}=${item.status}`).join(', ')}.`
      : 'Multimodal tidak dijalankan.'
  );
  findings.push(...aggregates.map((item) => `${item.model}: concurrency maksimum ${item.maxSuccessfulConcurrency || '—'}, HTTP 429 sebanyak ${item.rateLimitOccurrences}.`));
  return findings;
}

function report(): PocReport {
  const aggregates = targetModels.map(aggregate);
  return {
    schemaVersion: 1,
    runId,
    profile: 'Controlled full POC · staged guardrails',
    startedAt,
    completedAt: new Date().toISOString(),
    endpoint: new URL(endpoint).origin,
    targetModels,
    availableModels,
    methodology: {
      timing: 'TTFT diukur dari request start sampai content/tool delta pertama; latency sampai stream selesai.',
      tokenSource: 'Token memakai field usage dari API. Jika tidak tersedia, digunakan estimasi panjang payload ÷ 4. Median output tok/s memakai workload high-output.',
      percentileNote: 'P50/P95/P99 bersifat observasional; interpretasikan P99 dengan hati-hati bila sampel model kurang dari 100.',
      guardrails: 'Concurrency dinaikkan 1→10→25→50→100 dan dihentikan jika error tahap melebihi 10%.'
    },
    aggregates,
    useCases: useCases(),
    findings: buildFindings(aggregates),
    limitations: [
      ...(!availableModels.includes('gpt-5.6-luna') ? ['gpt-5.6-luna tidak tercantum di /v1/models saat pengujian.'] : []),
      'UC-18 membutuhkan endpoint dan kredensial direct provider untuk model identik; baseline tersebut tidak tersedia.',
      'Input processing rate adalah proxy input token/TTFT, bukan telemetry internal provider.',
      'Kualitas jawaban dinilai hanya pada fixture deterministik; evaluasi subjektif bahasa panjang berada di luar POC otomatis ini.'
    ],
    samples
  };
}

async function save() {
  await mkdir(dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.tmp`;
  await writeFile(temporary, JSON.stringify(report(), null, 2), 'utf8');
  await rename(temporary, reportPath);
}

function shortPrompt(index = 0) {
  return `Benchmark ${index}. Balas tepat dengan kata OK tanpa penjelasan.`;
}

function longPrompt(targetTokens: number) {
  const targetChars = targetTokens * 4;
  const filler = 'Catatan operasional netral untuk pengujian kapasitas konteks. Abaikan kalimat ini saat menjawab. ';
  const start = 'KODE_AWAL=ALFA-17. ';
  const middle = ' KODE_TENGAH=TENGAH-42. ';
  const end = ' KODE_AKHIR=OMEGA-93.';
  const remaining = Math.max(0, targetChars - start.length - middle.length - end.length - 220);
  const half = Math.floor(remaining / 2);
  const first = filler.repeat(Math.ceil(half / filler.length)).slice(0, half);
  const second = filler.repeat(Math.ceil((remaining - half) / filler.length)).slice(0, remaining - half);
  return `${start}${first}${middle}${second}${end}\nJawab hanya: ALFA-17 | TENGAH-42 | OMEGA-93`;
}

function createPngFixture() {
  const width = 320;
  const height = 180;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const offset = y * stride + 1 + x * 3;
      const left = x < width / 2;
      raw[offset] = left ? 226 : 41;
      raw[offset + 1] = left ? 66 : 91;
      raw[offset + 2] = left ? 54 : 176;
    }
  }
  const crc32 = (buffer: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const name = Buffer.from(type);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

async function runPool(total: number, concurrency: number, task: (index: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(total, concurrency) }, async () => {
    while (true) {
      const index = next++;
      if (index >= total) return;
      await task(index);
    }
  }));
}

async function main() {
  console.log(`Memulai ${runId}`);
  const modelResponse = await fetch(modelsEndpoint, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (modelResponse.ok) {
    const payload = await modelResponse.json() as { data?: Array<{ id?: string }> };
    availableModels = payload.data?.flatMap((item) => item.id ? [item.id] : []) || [];
  }
  console.log(`Model tersedia: ${availableModels.length}`);

  for (const model of targetModels) {
    await add({ useCase: 'UC-01', scenario: 'model-access-smoke', model, messages: [{ role: 'user', content: shortPrompt() }], maxTokens: 16, timeoutMs: 45_000, metadata: { listedInModels: availableModels.includes(model) } });
  }
  await save();

  const activeModels = targetModels.filter((model) => samples.some((sample) => sample.model === model && sample.status === 'success'));
  for (const model of ['deepseek-v4-flash', 'gpt-5.6-luna', 'deepseek-v4-flash']) {
    await add({ useCase: 'UC-02', scenario: 'switch-sequence', model, messages: [{ role: 'user', content: 'Model switching check. Balas SWITCH-OK.' }], maxTokens: 24, timeoutMs: 45_000 });
  }

  const shippingTool = [{
    type: 'function',
    function: {
      name: 'calculate_shipping_cost',
      description: 'Hitung biaya kirim untuk rute dan berat tertentu.',
      parameters: {
        type: 'object',
        properties: { origin: { type: 'string' }, destination: { type: 'string' }, weight_kg: { type: 'number' } },
        required: ['origin', 'destination', 'weight_kg'],
        additionalProperties: false
      }
    }
  }];
  for (const model of activeModels) {
    for (let index = 0; index < 3; index++) {
      const sample = await add({ useCase: 'UC-04', scenario: `tool-call-${index + 1}`, model, messages: [{ role: 'user', content: `Hitung ongkir dari Jakarta ke Bandung untuk paket ${index + 2} kg menggunakan tool.` }], tools: shippingTool, toolChoice: { type: 'function', function: { name: 'calculate_shipping_cost' } }, maxTokens: 128 });
      const callName = String(sample.metadata?.toolCallName || '');
      const args = String(sample.metadata?.toolCallArguments || '');
      let valid = false;
      try { const parsed = JSON.parse(args); valid = callName === 'calculate_shipping_cost' && parsed.origin && parsed.destination && typeof parsed.weight_kg === 'number'; } catch { valid = false; }
      sample.metadata = { ...sample.metadata, toolCallValid: valid };
      if (!valid && sample.status === 'success') { sample.status = 'failed'; sample.error = 'Tool call tidak lengkap atau arguments bukan JSON valid.'; }
    }

    const fixture = createPngFixture();
    const image = `data:image/png;base64,${fixture.toString('base64')}`;
    const multi = await add({ useCase: 'UC-05', scenario: 'image-color-fixture', model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Sebutkan warna bidang di sisi kiri dan warna bidang di sisi kanan gambar.' }, { type: 'image_url', image_url: { url: image } }] }], maxTokens: 128 });
    const preview = String(multi.metadata?.outputPreview || '').toUpperCase();
    multi.metadata = { ...multi.metadata, answerAccurate: preview.includes('MERAH') && preview.includes('BIRU') };
    if (multi.status === 'success' && !multi.metadata.answerAccurate) { multi.status = 'failed'; multi.error = 'Respons tidak menyebut merah dan biru.'; }

    for (const target of [500, 5_000, 20_000, 50_000]) {
      const long = await add({ useCase: 'UC-03', scenario: `input-${target}-tokens`, model, messages: [{ role: 'user', content: longPrompt(target) }], maxTokens: 512, timeoutMs: 240_000, metadata: { targetInputTokens: target } });
      const preview = String(long.metadata?.outputPreview || '');
      const accurate = ['ALFA-17', 'TENGAH-42', 'OMEGA-93'].every((code) => preview.includes(code));
      long.metadata = { ...long.metadata, retrievalAccurate: accurate };
      if (long.status === 'success' && !accurate) { long.status = 'failed'; long.error = 'Needle retrieval tidak lengkap.'; }
      if ((long.httpStatus === null || long.httpStatus >= 400) && target >= 20_000) break;
    }

    for (const target of [200, 500, 1_000, 2_000]) {
      const high = await add({ useCase: 'UC-07', scenario: `output-${target}-tokens`, model, messages: [{ role: 'user', content: `Langsung tulis esai Bahasa Indonesia sekitar ${target} token tentang arsitektur sistem terdistribusi. Jangan gunakan tabel.` }], maxTokens: target + 1_024, timeoutMs: 300_000, metadata: { targetOutputTokens: target } });
      const visibleTokens = Number(high.metadata?.visibleEstimatedTokens || 0);
      high.metadata = { ...high.metadata, targetAchievement: round((visibleTokens / target) * 100) };
      if (high.status === 'success' && visibleTokens < target * 0.6) { high.status = 'failed'; high.error = 'Visible response kurang dari 60% target output.'; }
    }

    for (let index = 0; index < 10; index++) {
      await add({ useCase: 'UC-08', scenario: `latency-repeat-${index + 1}`, model, messages: [{ role: 'user', content: shortPrompt(index) }], maxTokens: 16, timeoutMs: 60_000 });
    }
  }
  await save();

  for (const model of activeModels) {
    let loadGateOpen = true;
    for (const level of [1, 10, 25, 50, 100]) {
      if (!loadGateOpen) {
        samples.push({ id: crypto.randomUUID(), useCase: level === 100 ? 'UC-10' : 'UC-06', scenario: `concurrency-${level}`, model, status: 'skipped', startedAt: new Date().toISOString(), httpStatus: null, ttftMs: null, latencyMs: 0, inputTokens: null, outputTokens: null, totalTokens: null, outputTokensPerSecond: null, finishReason: null, error: 'Dilewati oleh guardrail tahap sebelumnya.', metadata: { concurrency: level } });
        continue;
      }
      const before = samples.length;
      await Promise.all(Array.from({ length: level }, (_, index) => add({ useCase: level === 100 ? 'UC-10' : 'UC-06', scenario: `concurrency-${level}`, model, messages: [{ role: 'user', content: shortPrompt(index) }], maxTokens: 16, timeoutMs: 90_000, metadata: { concurrency: level, batchIndex: index + 1 } })));
      const stage = samples.slice(before);
      const errorRate = stage.filter((sample) => sample.status !== 'success').length / stage.length;
      loadGateOpen = errorRate <= 0.1;
      await save();
    }

    await runPool(30, 5, async (index) => {
      await add({ useCase: 'UC-09', scenario: 'sustained-30x-c5', model, messages: [{ role: 'user', content: shortPrompt(index) }], maxTokens: 16, timeoutMs: 90_000, metadata: { concurrency: 5, sequence: index + 1 } });
    });

    const timeout = await add({ useCase: 'UC-15', scenario: 'client-timeout-guard', model, messages: [{ role: 'user', content: 'Tulis analisis panjang tentang sistem terdistribusi.' }], maxTokens: 1_000, timeoutMs: 10, metadata: { excludeFromMetrics: true, expectedTimeout: true } });
    if (timeout.metadata?.timeoutTriggered) { timeout.status = 'success'; timeout.error = undefined; }
  }

  samples.push({ id: crypto.randomUUID(), useCase: 'UC-18', scenario: 'direct-provider-baseline', model: 'direct-provider', status: 'skipped', startedAt: new Date().toISOString(), httpStatus: null, ttftMs: null, latencyMs: 0, inputTokens: null, outputTokens: null, totalTokens: null, outputTokensPerSecond: null, finishReason: null, error: 'Direct-provider credentials tidak tersedia.' });
  await save();
  console.log(`Selesai. Report tersimpan di ${reportPath}`);
}

async function repairFunctionalResults() {
  const existing = JSON.parse(await readFile(reportPath, 'utf8')) as PocReport;
  runId = existing.runId;
  startedAt = existing.startedAt;
  availableModels = existing.availableModels;
  samples.push(...existing.samples.filter((sample) => !['UC-03', 'UC-05', 'UC-07'].includes(sample.useCase)));
  const model = 'deepseek-v4-flash';

  const fixture = createPngFixture();
  const image = `data:image/png;base64,${fixture.toString('base64')}`;
  const multi = await add({ useCase: 'UC-05', scenario: 'image-color-fixture', model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Sebutkan warna bidang di sisi kiri dan warna bidang di sisi kanan gambar.' }, { type: 'image_url', image_url: { url: image } }] }], maxTokens: 256, timeoutMs: 120_000, metadata: { repairedRun: true } });
  const preview = String(multi.metadata?.outputPreview || '').toUpperCase();
  multi.metadata = { ...multi.metadata, answerAccurate: preview.includes('MERAH') && preview.includes('BIRU') };
  if (multi.status === 'success' && !multi.metadata.answerAccurate) { multi.status = 'failed'; multi.error = 'Respons tidak menyebut merah dan biru.'; }

  for (const target of [500, 5_000, 20_000, 50_000]) {
    const long = await add({ useCase: 'UC-03', scenario: `input-${target}-tokens`, model, messages: [{ role: 'user', content: longPrompt(target) }], maxTokens: 512, timeoutMs: 300_000, metadata: { targetInputTokens: target, repairedRun: true } });
    const output = String(long.metadata?.outputPreview || '');
    const accurate = ['ALFA-17', 'TENGAH-42', 'OMEGA-93'].every((code) => output.includes(code));
    long.metadata = { ...long.metadata, retrievalAccurate: accurate };
    if (long.status === 'success' && !accurate) { long.status = 'failed'; long.error = 'Needle retrieval tidak lengkap.'; }
    if ((long.httpStatus === null || long.httpStatus >= 400) && target >= 20_000) break;
  }

  for (const target of [200, 500, 1_000, 2_000]) {
    const high = await add({ useCase: 'UC-07', scenario: `output-${target}-tokens`, model, messages: [{ role: 'user', content: `Langsung tulis esai Bahasa Indonesia sekitar ${target} token tentang arsitektur sistem terdistribusi. Jangan gunakan tabel.` }], maxTokens: target + 1_024, timeoutMs: 300_000, metadata: { targetOutputTokens: target, repairedRun: true } });
    const visibleTokens = Number(high.metadata?.visibleEstimatedTokens || 0);
    high.metadata = { ...high.metadata, targetAchievement: round((visibleTokens / target) * 100) };
    if (high.status === 'success' && visibleTokens < target * 0.6) { high.status = 'failed'; high.error = 'Visible response kurang dari 60% target output.'; }
  }
  await save();
  console.log(`Retest selesai. Report diperbarui di ${reportPath}`);
}

async function retestLargeOutput() {
  const existing = JSON.parse(await readFile(reportPath, 'utf8')) as PocReport;
  runId = existing.runId;
  startedAt = existing.startedAt;
  availableModels = existing.availableModels;
  samples.push(...existing.samples.filter((sample) => !(sample.useCase === 'UC-07' && sample.scenario === 'output-2000-tokens')));
  const target = 2_000;
  const high = await add({ useCase: 'UC-07', scenario: 'output-2000-tokens', model: 'deepseek-v4-flash', messages: [{ role: 'user', content: 'Langsung tulis esai Bahasa Indonesia sekitar 2000 token tentang arsitektur sistem terdistribusi. Jangan gunakan tabel.' }], maxTokens: 2_500, timeoutMs: 300_000, metadata: { targetOutputTokens: target, repairedRun: true } });
  const visibleTokens = Number(high.metadata?.visibleEstimatedTokens || 0);
  high.metadata = { ...high.metadata, targetAchievement: round((visibleTokens / target) * 100) };
  if (high.status === 'success' && visibleTokens < target * 0.6) { high.status = 'failed'; high.error = 'Visible response kurang dari 60% target output.'; }
  await save();
  console.log(`Retest output besar selesai. Report diperbarui di ${reportPath}`);
}

async function runGptContinuation() {
  const existing = JSON.parse(await readFile(reportPath, 'utf8')) as PocReport;
  runId = `poc-comparison-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  startedAt = existing.startedAt;
  samples.push(...existing.samples.filter((sample) => sample.model !== 'gpt-5.6-luna'));

  const modelResponse = await fetch(modelsEndpoint, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (modelResponse.ok) {
    const payload = await modelResponse.json() as { data?: Array<{ id?: string }> };
    availableModels = payload.data?.flatMap((item) => item.id ? [item.id] : []) || [];
  } else {
    availableModels = existing.availableModels;
  }

  const model = 'gpt-5.6-luna';
  const smoke = await add({ useCase: 'UC-01', scenario: 'model-access-smoke', model, messages: [{ role: 'user', content: shortPrompt() }], maxTokens: 16, timeoutMs: 60_000, metadata: { listedInModels: availableModels.includes(model), continuationRun: true } });
  if (smoke.status !== 'success') {
    await save();
    console.log('GPT belum dapat diuji lebih lanjut; smoke test gagal.');
    return;
  }

  await add({ useCase: 'UC-02', scenario: 'switch-sequence', model, messages: [{ role: 'user', content: 'Model switching check. Balas SWITCH-OK.' }], maxTokens: 24, timeoutMs: 60_000, metadata: { continuationRun: true } });

  const shippingTool = [{
    type: 'function',
    function: {
      name: 'calculate_shipping_cost',
      description: 'Hitung biaya kirim untuk rute dan berat tertentu.',
      parameters: {
        type: 'object',
        properties: { origin: { type: 'string' }, destination: { type: 'string' }, weight_kg: { type: 'number' } },
        required: ['origin', 'destination', 'weight_kg'],
        additionalProperties: false
      }
    }
  }];
  for (let index = 0; index < 3; index++) {
    const sample = await add({ useCase: 'UC-04', scenario: `tool-call-${index + 1}`, model, messages: [{ role: 'user', content: `Hitung ongkir dari Jakarta ke Bandung untuk paket ${index + 2} kg menggunakan tool.` }], tools: shippingTool, toolChoice: { type: 'function', function: { name: 'calculate_shipping_cost' } }, maxTokens: 128, timeoutMs: 120_000, metadata: { continuationRun: true } });
    const callName = String(sample.metadata?.toolCallName || '');
    const args = String(sample.metadata?.toolCallArguments || '');
    let valid = false;
    try {
      const parsed = JSON.parse(args);
      valid = callName === 'calculate_shipping_cost' && parsed.origin && parsed.destination && typeof parsed.weight_kg === 'number';
    } catch { valid = false; }
    sample.metadata = { ...sample.metadata, toolCallValid: valid };
    if (!valid && sample.status === 'success') { sample.status = 'failed'; sample.error = 'Tool call tidak lengkap atau arguments bukan JSON valid.'; }
  }

  const fixture = createPngFixture();
  const image = `data:image/png;base64,${fixture.toString('base64')}`;
  const multi = await add({ useCase: 'UC-05', scenario: 'image-color-fixture', model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Sebutkan warna bidang di sisi kiri dan warna bidang di sisi kanan gambar.' }, { type: 'image_url', image_url: { url: image } }] }], maxTokens: 256, timeoutMs: 120_000, metadata: { continuationRun: true } });
  const multiPreview = String(multi.metadata?.outputPreview || '').toUpperCase();
  multi.metadata = { ...multi.metadata, answerAccurate: multiPreview.includes('MERAH') && multiPreview.includes('BIRU') };
  if (multi.status === 'success' && !multi.metadata.answerAccurate) { multi.status = 'failed'; multi.error = 'Respons tidak menyebut merah dan biru.'; }

  for (const target of [500, 5_000, 20_000, 50_000]) {
    const long = await add({ useCase: 'UC-03', scenario: `input-${target}-tokens`, model, messages: [{ role: 'user', content: longPrompt(target) }], maxTokens: 512, timeoutMs: 300_000, metadata: { targetInputTokens: target, continuationRun: true } });
    const output = String(long.metadata?.outputPreview || '');
    const accurate = ['ALFA-17', 'TENGAH-42', 'OMEGA-93'].every((code) => output.includes(code));
    long.metadata = { ...long.metadata, retrievalAccurate: accurate };
    if (long.status === 'success' && !accurate) { long.status = 'failed'; long.error = 'Needle retrieval tidak lengkap.'; }
    if ((long.httpStatus === null || long.httpStatus >= 400) && target >= 20_000) break;
  }

  for (const target of [200, 500, 1_000, 2_000]) {
    const high = await add({ useCase: 'UC-07', scenario: `output-${target}-tokens`, model, messages: [{ role: 'user', content: `Langsung tulis esai Bahasa Indonesia sekitar ${target} token tentang arsitektur sistem terdistribusi. Jangan gunakan tabel.` }], maxTokens: target + 1_024, timeoutMs: 300_000, metadata: { targetOutputTokens: target, continuationRun: true } });
    const visibleTokens = Number(high.metadata?.visibleEstimatedTokens || 0);
    high.metadata = { ...high.metadata, targetAchievement: round((visibleTokens / target) * 100) };
    if (high.status === 'success' && visibleTokens < target * 0.6) { high.status = 'failed'; high.error = 'Visible response kurang dari 60% target output.'; }
  }

  for (let index = 0; index < 10; index++) {
    await add({ useCase: 'UC-08', scenario: `latency-repeat-${index + 1}`, model, messages: [{ role: 'user', content: shortPrompt(index) }], maxTokens: 16, timeoutMs: 90_000, metadata: { continuationRun: true } });
  }
  await save();

  let loadGateOpen = true;
  for (const level of [1, 10, 25, 50, 100]) {
    if (!loadGateOpen) {
      samples.push({ id: crypto.randomUUID(), useCase: level === 100 ? 'UC-10' : 'UC-06', scenario: `concurrency-${level}`, model, status: 'skipped', startedAt: new Date().toISOString(), httpStatus: null, ttftMs: null, latencyMs: 0, inputTokens: null, outputTokens: null, totalTokens: null, outputTokensPerSecond: null, finishReason: null, error: 'Dilewati oleh guardrail tahap sebelumnya.', metadata: { concurrency: level, continuationRun: true } });
      continue;
    }
    const before = samples.length;
    await Promise.all(Array.from({ length: level }, (_, index) => add({ useCase: level === 100 ? 'UC-10' : 'UC-06', scenario: `concurrency-${level}`, model, messages: [{ role: 'user', content: shortPrompt(index) }], maxTokens: 16, timeoutMs: 120_000, metadata: { concurrency: level, batchIndex: index + 1, continuationRun: true } })));
    const stage = samples.slice(before);
    const errorRate = stage.filter((sample) => sample.status !== 'success').length / stage.length;
    loadGateOpen = errorRate <= 0.1;
    await save();
  }

  await runPool(30, 5, async (index) => {
    await add({ useCase: 'UC-09', scenario: 'sustained-30x-c5', model, messages: [{ role: 'user', content: shortPrompt(index) }], maxTokens: 16, timeoutMs: 120_000, metadata: { concurrency: 5, sequence: index + 1, continuationRun: true } });
  });

  const timeout = await add({ useCase: 'UC-15', scenario: 'client-timeout-guard', model, messages: [{ role: 'user', content: 'Tulis analisis panjang tentang sistem terdistribusi.' }], maxTokens: 1_000, timeoutMs: 10, metadata: { excludeFromMetrics: true, expectedTimeout: true, continuationRun: true } });
  if (timeout.metadata?.timeoutTriggered) { timeout.status = 'success'; timeout.error = undefined; }
  await save();
  console.log(`Suite GPT selesai. Report gabungan tersimpan di ${reportPath}`);
}

async function retestGptMultimodal() {
  const existing = JSON.parse(await readFile(reportPath, 'utf8')) as PocReport;
  runId = existing.runId;
  startedAt = existing.startedAt;
  availableModels = existing.availableModels;
  samples.push(...existing.samples.filter((sample) => !(sample.model === 'gpt-5.6-luna' && sample.useCase === 'UC-05')));

  const fixture = createPngFixture();
  const image = `data:image/png;base64,${fixture.toString('base64')}`;
  const multi = await add({
    useCase: 'UC-05',
    scenario: 'image-color-fixture',
    model: 'gpt-5.6-luna',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Jangan jelaskan proses. Jawab hanya warna bidang kiri dan kanan dengan format: kiri [warna], kanan [warna].' }, { type: 'image_url', image_url: { url: image } }] }],
    maxTokens: 1_024,
    timeoutMs: 180_000,
    metadata: { continuationRun: true, multimodalRetest: true }
  });
  const preview = String(multi.metadata?.outputPreview || '').toUpperCase();
  const accurate = preview.includes('MERAH') && preview.includes('BIRU');
  multi.metadata = { ...multi.metadata, answerAccurate: accurate };
  if (multi.status === 'success' && !accurate) { multi.status = 'failed'; multi.error = 'Respons tidak menyebut merah dan biru.'; }
  await save();
  console.log(`Retest multimodal GPT selesai. Report diperbarui di ${reportPath}`);
}

async function refreshReport() {
  const existing = JSON.parse(await readFile(reportPath, 'utf8')) as PocReport;
  runId = existing.runId;
  startedAt = existing.startedAt;
  availableModels = existing.availableModels;
  samples.push(...existing.samples);
  await save();
  console.log(`Agregasi report diperbarui di ${reportPath}`);
}

const task = process.env.POC_GPT_ONLY === '1'
  ? runGptContinuation
  : process.env.POC_RETEST_GPT_MULTIMODAL === '1'
    ? retestGptMultimodal
  : process.env.POC_REFRESH_REPORT === '1'
    ? refreshReport
  : process.env.POC_RETEST_OUTPUT === '1'
    ? retestLargeOutput
    : process.env.POC_REPAIR === '1'
      ? repairFunctionalResults
      : main;
await task().catch(async (error) => {
  console.error(error);
  await save().catch(() => undefined);
  process.exitCode = 1;
});
