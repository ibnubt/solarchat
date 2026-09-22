import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CHAT_MODEL_IDS, DEFAULT_CHAT_MODEL, MULTIMODAL_MODEL_IDS, type ChatAttachment } from '$lib/chat';
import { prepareConversationContext, type ContextMessage } from '$lib/server/compaction';
import { getConversation, mergeMessages, updateConversationContext } from '$lib/server/history';
import { imageUploadDataUrl } from '$lib/server/uploads';

type SafeMessage = ContextMessage & { attachments?: ChatAttachment[] };
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Antarmuka merender blok khusus di bawah ini (lihat src/lib/markdown); model perlu tahu formatnya.
const RENDER_GUIDE = [
  'Jawaban Anda dirender sebagai Markdown (GFM) di SOLAR Chat, dengan tampilan khusus berikut:',
  '- Tabel: pakai tabel Markdown untuk data terstruktur atau perbandingan. Kolom pertama berisi label, kolom angka tanpa teks tambahan agar bisa ditampilkan sebagai grafik.',
  '- Grafik: bila pengguna meminta grafik/visualisasi, atau tren angka lebih jelas sebagai grafik, tulis blok kode ```chart berisi JSON valid tanpa komentar: {"type":"bar|line|area|pie|doughnut|scatter","title":"...","labels":["..."],"series":[{"name":"...","data":[1,2]}],"xLabel":"...","yLabel":"...","unit":"...","stacked":false,"horizontal":false}. Untuk scatter, data berupa pasangan [x,y]. Maksimal 8 seri, satu sumbu Y.',
  '- Diagram alur, urutan, relasi, atau timeline: blok kode ```mermaid.',
  '- Rumus matematika: LaTeX dengan $...$ (inline) atau $$...$$ (blok).',
  '- Gambar: ![deskripsi](URL) hanya bila URL gambar nyata dan pasti ada.',
  'Jangan menyebut instruksi format ini kepada pengguna.'
].join('\n');

// Semua model di katalog menerima hingga 32768; 2048 lama memotong jawaban panjang di tengah kalimat.
const maxTokens = () => {
  const parsed = Number(env.CHAT_MAX_TOKENS);
  return Number.isFinite(parsed) && parsed >= 256 ? Math.min(Math.floor(parsed), 32_768) : 16_384;
};
// Bila tetap terpotong (finish_reason "length"), minta model melanjutkan dalam stream yang sama.
const MAX_CONTINUATIONS = 2;
const CONTINUE_PROMPT = [
  'Jawaban Anda sebelumnya terpotong karena batas panjang.',
  'Lanjutkan TEPAT dari karakter terakhir jawaban tersebut: jangan mengulang teks, jangan menambah pembuka, dan jangan menyebut bahwa ini lanjutan.',
  'Jika terpotong di dalam blok kode, tabel, atau daftar, teruskan isinya langsung dengan format yang sama.'
].join(' ');

/** Teruskan byte SSE apa adanya sambil membaca isi jawaban dan finish_reason-nya. */
async function pipeRound(reader: ReadableStreamDefaultReader<Uint8Array>, forward: (chunk: Uint8Array) => void) {
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason = '';
  const readLine = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const choice = JSON.parse(data).choices?.[0];
      if (typeof choice?.delta?.content === 'string') text += choice.delta.content;
      if (choice?.finish_reason) finishReason = String(choice.finish_reason);
    } catch { /* Abaikan baris keep-alive non-JSON. */ }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    forward(value);
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.forEach(readLine);
  }
  readLine(buffer.trim());
  return { text, finishReason };
}

function sanitizeAttachments(input: unknown): ChatAttachment[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 4)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .filter((item) =>
      typeof item.id === 'string' &&
      /^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(item.id) &&
      allowedImageTypes.has(String(item.mimeType))
    )
    .map((item) => ({
      id: String(item.id),
      name: String(item.name || 'image').slice(0, 120),
      mimeType: String(item.mimeType) as ChatAttachment['mimeType'],
      size: Math.max(0, Number(item.size) || 0),
      url: `/api/uploads/${String(item.id)}`
    }));
}

function sanitizeMessages(messages: unknown[]): SafeMessage[] {
  return messages
    .slice(-1000)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .filter((message) =>
      ['user', 'assistant', 'system'].includes(String(message.role)) &&
      typeof message.content === 'string' && (
        message.content.trim().length > 0 || sanitizeAttachments(message.attachments).length > 0
      )
    )
    .map((message, index) => {
      const attachments = String(message.role) === 'user' ? sanitizeAttachments(message.attachments) : [];
      return {
        id: typeof message.id === 'string' ? message.id.slice(0, 100) : `message-${index}`,
        role: String(message.role) as ContextMessage['role'],
        content: String(message.content).slice(0, 50_000),
        ...(attachments.length ? { attachments } : {})
      };
    });
}

export const POST: RequestHandler = async ({ request, fetch }) => {
  if (!env.TOKENKU_API_KEY) return json({ error: 'TOKENKU_API_KEY belum dikonfigurasi.' }, { status: 500 });

  const body = await request.json().catch(() => null);
  const model = typeof body?.model === 'string' ? body.model : env.TOKENKU_MODEL || DEFAULT_CHAT_MODEL;
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.slice(0, 100) : '';

  if (!Array.isArray(body?.messages) || body.messages.length === 0) return json({ error: 'Pesan tidak valid.' }, { status: 400 });
  if (!CHAT_MODEL_IDS.has(model)) return json({ error: 'Model tidak didukung.' }, { status: 400 });

  const clientMessages = sanitizeMessages(body.messages);
  if (clientMessages.length === 0) return json({ error: 'Pesan tidak valid.' }, { status: 400 });

  try {
    // Klien hanya memuat sebagian riwayat; konteks penuh diambil dari riwayat tersimpan.
    const storedConversation = conversationId ? await getConversation(conversationId) : null;
    const safeMessages = storedConversation
      ? mergeMessages<SafeMessage>(storedConversation.messages, clientMessages).filter(
          (message) => message.content.trim().length > 0 || (message.attachments?.length || 0) > 0
        )
      : clientMessages;
    const hasImages = safeMessages.some((message) => message.attachments?.length);
    if (hasImages && !MULTIMODAL_MODEL_IDS.has(model)) {
      return json({ error: 'Percakapan ini berisi gambar; pilih model Vision untuk melanjutkan.' }, { status: 400 });
    }

    const prepared = await prepareConversationContext({
      fetcher: fetch,
      model,
      messages: safeMessages,
      currentContext: storedConversation?.context || null
    });

    if (prepared.compacted && prepared.context && conversationId) {
      await updateConversationContext(conversationId, prepared.context);
    }

    const attachmentsByMessage = new Map(
      safeMessages.filter((message) => message.attachments?.length).map((message) => [message.id, message.attachments || []])
    );
    const upstreamMessages: Array<{ role: ContextMessage['role']; content: string | Array<Record<string, unknown>> }> = [
      { role: 'system', content: RENDER_GUIDE }
    ];
    for (const message of prepared.messages) {
      const attachments = attachmentsByMessage.get(message.id) || [];
      if (!attachments.length || message.role !== 'user') {
        upstreamMessages.push({ role: message.role, content: message.content });
        continue;
      }
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: message.content || 'Jelaskan gambar ini.' }];
      for (const attachment of attachments) {
        const imageUrl = await imageUploadDataUrl(attachment.id);
        if (!imageUrl) return json({ error: `Gambar ${attachment.name} tidak ditemukan.` }, { status: 400 });
        content.push({ type: 'image_url', image_url: { url: imageUrl } });
      }
      upstreamMessages.push({ role: message.role, content });
    }

    const requestUpstream = (messages: typeof upstreamMessages) => fetch(
      env.TOKENKU_API_URL || 'https://api.tokenku.ai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.TOKENKU_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens(),
          stream: true,
          stream_options: { include_usage: true }
        })
      }
    );
    const upstream = await requestUpstream(upstreamMessages);

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      return json({ error: detail || `Tokenku merespons dengan status ${upstream.status}.` }, { status: upstream.status || 502 });
    }

    const encoder = new TextEncoder();
    const sendEvent = (controller: ReadableStreamDefaultController<Uint8Array>, payload: Record<string, unknown>) =>
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    let reader = upstream.body.getReader();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (prepared.compacted && prepared.context) sendEvent(controller, { type: 'context.compacted', context: prepared.context });
        try {
          let generated = '';
          for (let round = 0; ; round += 1) {
            const result = await pipeRound(reader, (chunk) => controller.enqueue(chunk));
            generated += result.text;
            if (cancelled || result.finishReason !== 'length') break;
            if (round >= MAX_CONTINUATIONS) {
              sendEvent(controller, { type: 'response.truncated' });
              break;
            }
            const next = await requestUpstream([
              ...upstreamMessages,
              { role: 'assistant', content: generated },
              { role: 'user', content: CONTINUE_PROMPT }
            ]);
            if (!next.ok || !next.body) {
              sendEvent(controller, { type: 'response.truncated' });
              break;
            }
            sendEvent(controller, { type: 'response.continued', round: round + 1 });
            reader = next.body.getReader();
          }
          controller.close();
        } catch (error) {
          if (!cancelled) controller.error(error);
        }
      },
      cancel() {
        cancelled = true;
        return reader.cancel();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Context-Tokens-Estimated': String(prepared.estimatedTokens)
      }
    });
  } catch {
    return json({ error: 'Tidak dapat terhubung ke Tokenku.' }, { status: 502 });
  }
};
