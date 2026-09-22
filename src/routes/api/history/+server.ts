import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ChatAttachment } from '$lib/chat';
import {
  deleteConversation,
  getConversationPage,
  listConversationSummaries,
  MAX_STORED_MESSAGES,
  toSummary,
  upsertConversation,
  type ConversationContext,
  type StoredConversation
} from '$lib/server/history';

const allowedRoles = new Set(['user', 'assistant']);
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
      name: String(item.name || 'image').replace(/[^a-zA-Z0-9._ -]/g, '').slice(0, 120),
      mimeType: String(item.mimeType) as ChatAttachment['mimeType'],
      size: Math.max(0, Math.min(5 * 1024 * 1024, Number(item.size) || 0)),
      url: `/api/uploads/${String(item.id)}`
    }));
}

function sanitizeConversation(input: unknown): StoredConversation | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (typeof value.id !== 'string' || !Array.isArray(value.messages)) return null;

  const messages = value.messages
    .slice(-MAX_STORED_MESSAGES)
    .filter((message): message is Record<string, unknown> => !!message && typeof message === 'object')
    .filter((message) => allowedRoles.has(String(message.role)) && typeof message.content === 'string')
    .map((message) => {
      const attachments = sanitizeAttachments(message.attachments);
      return {
        id: String(message.id).slice(0, 100),
        role: String(message.role) as 'user' | 'assistant',
        content: String(message.content).slice(0, 50_000),
        ...(attachments.length ? { attachments } : {})
      };
    });

  const now = new Date().toISOString();
  const rawContext = value.context && typeof value.context === 'object'
    ? value.context as Record<string, unknown>
    : null;
  const context: ConversationContext | undefined = rawContext &&
    typeof rawContext.summary === 'string' &&
    typeof rawContext.compactedThroughId === 'string'
    ? {
        summary: rawContext.summary.slice(0, 50_000),
        compactedThroughId: rawContext.compactedThroughId.slice(0, 100),
        summarizedMessages: Math.max(0, Number(rawContext.summarizedMessages) || 0),
        estimatedTokensAfter: Math.max(0, Number(rawContext.estimatedTokensAfter) || 0),
        compactedAt: String(rawContext.compactedAt || now)
      }
    : undefined;
  return {
    id: value.id.slice(0, 100),
    title: String(value.title || 'Percakapan baru').slice(0, 80),
    model: String(value.model || 'gpt-5.6-luna').slice(0, 80),
    messages,
    ...(context ? { context } : {}),
    createdAt: String(value.createdAt || now),
    updatedAt: String(value.updatedAt || now)
  };
}

const intParam = (value: string | null, fallback: number, max: number) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
};

/**
 * Tanpa `id`: daftar ringkas percakapan (tanpa isi pesan), berhalaman lewat `offset` & `limit`.
 * Dengan `id`: satu halaman pesan terbaru, atau pesan sebelum `before` untuk memuat yang lebih lama.
 */
export const GET: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id) {
    const offset = intParam(url.searchParams.get('offset'), 0, Number.MAX_SAFE_INTEGER);
    const limit = Math.max(1, intParam(url.searchParams.get('limit'), 30, 100));
    return json(await listConversationSummaries(offset, limit));
  }
  const limit = Math.max(1, intParam(url.searchParams.get('limit'), 30, 200));
  const page = await getConversationPage(id, url.searchParams.get('before'), limit);
  if (!page) return json({ error: 'Percakapan tidak ditemukan.' }, { status: 404 });
  return json(page);
};

/** Pesan yang dikirim digabung (berdasarkan id) ke riwayat tersimpan, bukan menggantikannya. */
export const PUT: RequestHandler = async ({ request }) => {
  const conversation = sanitizeConversation(await request.json().catch(() => null));
  if (!conversation) return json({ error: 'Data percakapan tidak valid.' }, { status: 400 });
  return json({ conversation: toSummary(await upsertConversation(conversation)) });
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'ID percakapan diperlukan.' }, { status: 400 });
  await deleteConversation(id);
  return json({ success: true });
};
