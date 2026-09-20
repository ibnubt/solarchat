import { env } from '$env/dynamic/private';
import type { ConversationContext } from '$lib/server/history';

export type ContextMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

const numberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export const estimateTokens = (messages: Array<Pick<ContextMessage, 'content'>>) =>
  messages.reduce((total, message) => total + Math.ceil(message.content.length / 4) + 4, 0);

const summaryMessage = (summary: string): ContextMessage => ({
  id: 'conversation-memory',
  role: 'system',
  content: [
    'RINGKASAN KONTEKS PERCAKAPAN SEBELUMNYA',
    'Gunakan ringkasan ini sebagai memori faktual. Jangan menyebut bahwa konteks telah diringkas kecuali ditanya.',
    '',
    summary
  ].join('\n')
});

function tailWithinBudget(messages: ContextMessage[], budget: number) {
  const selected: ContextMessage[] = [];
  let tokens = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const cost = Math.ceil(message.content.length / 4) + 4;
    if (selected.length > 0 && tokens + cost > budget) break;
    selected.unshift(message);
    tokens += cost;
  }
  return selected;
}

async function generateSummary(
  fetcher: typeof fetch,
  model: string,
  previousSummary: string,
  newMessages: ContextMessage[]
) {
  const transcript = newMessages
    .map((message) => `[${message.role.toUpperCase()}]\n${message.content}`)
    .join('\n\n');
  const response = await fetcher(
    env.TOKENKU_API_URL || 'https://api.tokenku.ai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TOKENKU_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: env.TOKENKU_COMPACTION_MODEL || model,
        stream: false,
        max_tokens: numberFromEnv(env.COMPACTION_MAX_TOKENS, 2048),
        messages: [
          {
            role: 'system',
            content: [
              'Anda adalah mesin compaction percakapan.',
              'Buat ringkasan lanjutan yang ringkas, faktual, dan dapat dipakai model lain untuk melanjutkan percakapan.',
              'Pertahankan tujuan pengguna, preferensi, batasan, keputusan, nama, angka, tanggal, hasil penting, serta pekerjaan yang belum selesai.',
              'Jangan mengarang. Jangan menjelaskan proses peringkasan.',
              'Gunakan Markdown dengan bagian: Tujuan, Fakta & Preferensi, Keputusan/Hasil, dan Hal Belum Selesai.'
            ].join(' ')
          },
          {
            role: 'user',
            content: `${previousSummary ? `RINGKASAN SEBELUMNYA:\n${previousSummary}\n\n` : ''}PESAN BARU YANG HARUS DIGABUNGKAN:\n${transcript}`
          }
        ]
      })
    }
  );

  if (!response.ok) throw new Error(`Compaction gagal dengan status ${response.status}.`);
  const result = await response.json();
  const summary = result?.choices?.[0]?.message?.content;
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('Compaction tidak menghasilkan ringkasan.');
  return summary.trim();
}

export async function prepareConversationContext(options: {
  fetcher: typeof fetch;
  model: string;
  messages: ContextMessage[];
  currentContext?: ConversationContext | null;
}) {
  const trigger = numberFromEnv(env.CONTEXT_COMPACT_TRIGGER, 24_000);
  const keepRecent = Math.max(4, numberFromEnv(env.CONTEXT_KEEP_RECENT_MESSAGES, 16));
  const { fetcher, model, messages, currentContext } = options;

  const compactedIndex = currentContext
    ? messages.findIndex((message) => message.id === currentContext.compactedThroughId)
    : -1;
  const contextIsValid = !currentContext || compactedIndex >= 0;
  const existingSummary = contextIsValid ? currentContext?.summary || '' : '';
  const unsummarizedStart = contextIsValid && currentContext ? compactedIndex + 1 : 0;
  const unsummarized = messages.slice(unsummarizedStart);
  const currentInput = existingSummary ? [summaryMessage(existingSummary), ...unsummarized] : unsummarized;
  const beforeTokens = estimateTokens(currentInput);

  if (beforeTokens < trigger || unsummarized.length <= keepRecent) {
    return { messages: currentInput, context: currentContext || null, compacted: false, estimatedTokens: beforeTokens };
  }

  const summarizeEnd = messages.length - keepRecent;
  const messagesToSummarize = messages.slice(unsummarizedStart, summarizeEnd);
  if (messagesToSummarize.length === 0) {
    return { messages: currentInput, context: currentContext || null, compacted: false, estimatedTokens: beforeTokens };
  }

  try {
    const summary = await generateSummary(fetcher, model, existingSummary, messagesToSummarize);
    const recentMessages = messages.slice(summarizeEnd);
    const context: ConversationContext = {
      summary,
      compactedThroughId: messages[summarizeEnd - 1].id,
      summarizedMessages: (contextIsValid ? currentContext?.summarizedMessages || 0 : 0) + messagesToSummarize.length,
      estimatedTokensAfter: estimateTokens([summaryMessage(summary), ...recentMessages]),
      compactedAt: new Date().toISOString()
    };
    return {
      messages: [summaryMessage(summary), ...recentMessages],
      context,
      compacted: true,
      estimatedTokens: context.estimatedTokensAfter
    };
  } catch {
    const summaryPrefix = existingSummary ? [summaryMessage(existingSummary)] : [];
    const reserved = estimateTokens(summaryPrefix);
    const recentMessages = tailWithinBudget(unsummarized, Math.max(2_000, trigger - reserved));
    return {
      messages: [...summaryPrefix, ...recentMessages],
      context: currentContext || null,
      compacted: false,
      estimatedTokens: estimateTokens([...summaryPrefix, ...recentMessages])
    };
  }
}
