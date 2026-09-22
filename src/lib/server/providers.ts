import { env } from '$env/dynamic/private';
import type { ModelOption } from '$lib/chat';

export type Upstream = {
  /** Nama penyedia untuk pesan error ke pengguna. */
  name: string;
  url: string;
  apiKey: string;
  /** Nama model yang dikirim ke upstream. */
  model: string;
  /** Model & opsi tambahan untuk meringkas konteks lama pada penyedia yang sama. */
  summaryModel: string;
  summaryBody?: Record<string, unknown>;
};

/** `https://host`, `https://host/v1`, atau URL lengkap `/chat/completions` → endpoint chat completions. */
const chatCompletionsUrl = (base: string) => {
  const trimmed = base.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return /\/v\d+$/.test(trimmed) ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
};

export function resolveUpstream(option: ModelOption): Upstream | { error: string } {
  if (option.provider === 'dge') {
    if (!env.LLM_API_KEY || !env.LLM_BASE_URL) return { error: 'LLM_API_KEY dan LLM_BASE_URL untuk model DGE belum dikonfigurasi.' };
    const model = env.LLM_MODEL_NAME || 'Qwen/Qwen3.8-27B';
    return {
      name: 'DGE',
      url: chatCompletionsUrl(env.LLM_BASE_URL),
      apiKey: env.LLM_API_KEY,
      model,
      // Ringkasan tetap di DGE (tidak dikirim ke penyedia lain) dan tanpa mode berpikir agar kuota token utuh.
      summaryModel: model,
      summaryBody: { chat_template_kwargs: { enable_thinking: false } }
    };
  }
  if (!env.TOKENKU_API_KEY) return { error: 'TOKENKU_API_KEY belum dikonfigurasi.' };
  return {
    name: 'Tokenku',
    url: env.TOKENKU_API_URL || 'https://api.tokenku.ai/v1/chat/completions',
    apiKey: env.TOKENKU_API_KEY,
    model: option.value,
    summaryModel: env.TOKENKU_COMPACTION_MODEL || option.value
  };
}
