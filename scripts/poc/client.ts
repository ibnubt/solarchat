export type Msg = { role: 'user' | 'assistant' | 'system'; content: string };

export type CallResult = {
  ok: boolean;
  status: number;
  /** Token pertama apa pun, termasuk penalaran: inilah saat antarmuka berhenti terlihat diam. */
  ttftAnyMs: number | null;
  /** Token isi jawaban pertama: saat teks jawaban mulai terbaca pengguna. */
  ttftMs: number | null;
  latencyMs: number;
  text: string;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** Benar bila seluruh jatah token habis untuk menalar sehingga jawaban kosong. */
  emptyContent: boolean;
  /** 'upstream' = ditolak/putus oleh Tokenku; 'transport' = jaringan sisi penguji, bukan salah supplier. */
  failureKind?: 'upstream' | 'transport';
  transportRetries?: number;
  error?: string;
};

const BASE = process.env.TOKENKU_API_URL || 'https://api.tokenku.ai/v1/chat/completions';
const ORIGIN = new URL(BASE).origin;

/**
 * Satu laptop tidak sanggup memegang puluhan stream sekaligus; tanpa batas ini soket putus
 * dan kegagalan kita sendiri akan tercatat seolah-olah supplier yang bermasalah.
 */
const MAX_INFLIGHT = Number(process.env.POC_MAX_INFLIGHT || 8);
let inflight = 0;
const waiting: Array<() => void> = [];

async function withLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) await new Promise<void>((r) => waiting.push(r));
  inflight += 1;
  try { return await fn(); }
  finally { inflight -= 1; waiting.shift()?.(); }
}

const TRANSPORT = /socket|unable to connect|econnreset|epipe|network|fetch failed|terminated/i;
const isTransport = (message: string) => TRANSPORT.test(message);

/** Satu permintaan streaming; mengukur TTFT dari mulai request sampai potongan isi pertama. */
/** Coba ulang hanya untuk kegagalan jaringan sisi penguji; penolakan dari Tokenku dicatat apa adanya. */
export async function streamChat(key: string, model: string, messages: Msg[], maxTokens: number, timeoutMs = 300_000): Promise<CallResult> {
  let last: CallResult | null = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    const r = await withLimit(() => streamOnce(key, model, messages, maxTokens, timeoutMs));
    if (r.ok || r.failureKind !== 'transport') return attempt ? { ...r, transportRetries: attempt } : r;
    last = r;
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
  return { ...(last as CallResult), transportRetries: 2 };
}

async function streamOnce(key: string, model: string, messages: Msg[], maxTokens: number, timeoutMs: number): Promise<CallResult> {
  const started = performance.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true } }),
      signal: abort.signal
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      return { ok: false, status: res.status, ttftAnyMs: null, ttftMs: null, latencyMs: performance.now() - started, text: '', finishReason: '', inputTokens: 0, outputTokens: 0, reasoningTokens: 0, emptyContent: false, failureKind: 'upstream', error: detail.replace(/\s+/g, ' ').slice(0, 300) };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', text = '', finishReason = '', ttft: number | null = null, ttftAny: number | null = null, inTok = 0, outTok = 0, reasonTok = 0;
    const readLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      try {
        const payload = JSON.parse(data);
        const choice = payload.choices?.[0];
        const delta = choice?.delta || {};
        if (ttftAny === null && (delta.content || delta.reasoning_content || delta.reasoning)) ttftAny = performance.now() - started;
        if (typeof delta.content === 'string' && delta.content) {
          if (ttft === null) ttft = performance.now() - started;
          text += delta.content;
        }
        if (choice?.finish_reason) finishReason = String(choice.finish_reason);
        if (payload.usage) {
          inTok = payload.usage.prompt_tokens || inTok;
          outTok = payload.usage.completion_tokens || outTok;
          reasonTok = payload.usage.completion_tokens_details?.reasoning_tokens ?? reasonTok;
        }
      } catch { /* baris keep-alive non-JSON */ }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(readLine);
    }
    readLine(buffer.trim());
    const latencyMs = performance.now() - started;
    const common = { status: res.status, ttftAnyMs: ttftAny, ttftMs: ttft, latencyMs, text, finishReason, inputTokens: inTok, outputTokens: outTok, reasoningTokens: reasonTok, emptyContent: !text };
    if (!text && !finishReason) return { ok: false, ...common, failureKind: 'upstream' as const, error: 'stream kosong' };
    return { ok: true, ...common };
  } catch (error) {
    const err = error as Error;
    const message = err.name === 'AbortError' ? 'timeout' : err.message;
    return { ok: false, status: 0, ttftAnyMs: null, ttftMs: null, latencyMs: performance.now() - started, text: '', finishReason: '', inputTokens: 0, outputTokens: 0, reasoningTokens: 0, emptyContent: false, failureKind: isTransport(message) ? 'transport' : 'upstream', error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Pemakaian kumulatif akun dalam USD (endpoint melaporkan sen). */
export async function accountUsageUsd(key: string) {
  const url = `${ORIGIN}/v1/dashboard/billing/usage?start_date=2026-01-01&end_date=2027-01-01`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    const j = await r.json() as any;
    return typeof j.total_usage === 'number' ? j.total_usage / 100 : null;
  } catch { return null; }
}
