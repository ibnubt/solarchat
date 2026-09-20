import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { CHAT_MODEL_IDS, DEFAULT_CHAT_MODEL, MULTIMODAL_MODEL_IDS, type ChatAttachment } from '$lib/chat';
import { prepareConversationContext, type ContextMessage } from '$lib/server/compaction';
import { getConversation, updateConversationContext } from '$lib/server/history';
import { imageUploadDataUrl } from '$lib/server/uploads';

type SafeMessage = ContextMessage & { attachments?: ChatAttachment[] };
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

  const safeMessages = sanitizeMessages(body.messages);
  if (safeMessages.length === 0) return json({ error: 'Pesan tidak valid.' }, { status: 400 });
  const hasImages = safeMessages.some((message) => message.attachments?.length);
  if (hasImages && !MULTIMODAL_MODEL_IDS.has(model)) {
    return json({ error: 'Model yang dipilih hanya mendukung teks.' }, { status: 400 });
  }

  try {
    const storedConversation = conversationId ? await getConversation(conversationId) : null;
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
    const upstreamMessages: Array<{ role: ContextMessage['role']; content: string | Array<Record<string, unknown>> }> = [];
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

    const upstream = await fetch(
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
          messages: upstreamMessages,
          max_tokens: 2048,
          stream: true,
          stream_options: { include_usage: true }
        })
      }
    );

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      return json({ error: detail || `Tokenku merespons dengan status ${upstream.status}.` }, { status: upstream.status || 502 });
    }

    const encoder = new TextEncoder();
    const upstreamReader = upstream.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (prepared.compacted && prepared.context) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'context.compacted', context: prepared.context })}\n\n`));
        }
        try {
          while (true) {
            const { done, value } = await upstreamReader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        return upstreamReader.cancel();
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
