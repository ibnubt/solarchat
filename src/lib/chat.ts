export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  url: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
};

export type ModelProvider = 'tokenku' | 'dge';

export type ModelOption = {
  value: string;
  label: string;
  multimodal: boolean;
  cost: string;
  provider: ModelProvider;
};

// Kurasi model dengan biaya rendah dari katalog Tokenku yang diberikan pengguna.
export const CHAT_MODELS: ModelOption[] = [
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', multimodal: true, cost: '$0.07 / $0.42', provider: 'tokenku' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', multimodal: true, cost: '$0.08 / $0.32', provider: 'tokenku' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', multimodal: true, cost: '$0.24 / $2.00', provider: 'tokenku' },
  { value: 'deepseek-v4-1-flash', label: 'DeepSeek V4.1 Flash', multimodal: false, cost: '$0.02 / $0.90', provider: 'tokenku' },
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', multimodal: false, cost: '$0.17 / $0.50', provider: 'tokenku' },
  { value: 'glm-5.3-flash', label: 'GLM-5.3 Flash', multimodal: false, cost: '$0.03 / $0.09', provider: 'tokenku' },
  { value: 'gpt-oss-120b', label: 'GPT OSS 120B', multimodal: false, cost: '$0.14 / $0.72', provider: 'tokenku' },
  { value: 'doubao-seed-2-0-mini-260428', label: 'Doubao Seed 2.0 Mini', multimodal: false, cost: '$0.03 / $0.30', provider: 'tokenku' },
  // Endpoint OpenAI-compatible DGE; nama model upstream diambil dari LLM_MODEL_NAME di server.
  { value: 'dge-qwen3.8-27b', label: 'DGE Qwen3.8-27B', multimodal: true, cost: 'Internal', provider: 'dge' }
];

export const DEFAULT_CHAT_MODEL = 'gpt-5.6-luna';
export const CHAT_MODEL_IDS = new Set(CHAT_MODELS.map((model) => model.value));
export const MULTIMODAL_MODEL_IDS = new Set(
  CHAT_MODELS.filter((model) => model.multimodal).map((model) => model.value)
);

/**
 * Saat jawaban dilanjutkan setelah terpotong, model kadang mengulang ekor teks sebelumnya.
 * Buang awalan `next` yang sama dengan akhiran `previous` (minimal 12 karakter).
 */
export function trimContinuationOverlap(previous: string, next: string, maxOverlap = 400) {
  for (const candidate of [next, next.replace(/^\s+/, '')]) {
    for (let size = Math.min(candidate.length, previous.length, maxOverlap); size >= 12; size -= 1) {
      if (previous.endsWith(candidate.slice(0, size))) return candidate.slice(size);
    }
  }
  return next;
}
