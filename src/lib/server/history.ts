import { env } from '$env/dynamic/private';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ChatAttachment } from '$lib/chat';

export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
};

export type ConversationContext = {
  summary: string;
  compactedThroughId: string;
  summarizedMessages: number;
  estimatedTokensAfter: number;
  compactedAt: string;
};

export type StoredConversation = {
  id: string;
  title: string;
  model: string;
  messages: StoredMessage[];
  context?: ConversationContext;
  createdAt: string;
  updatedAt: string;
};

export type ConversationSummary = Omit<StoredConversation, 'messages' | 'context'> & { messageCount: number };

export const MAX_STORED_MESSAGES = 1000;

const dataFile = () => resolve(env.CHAT_DATA_FILE || './data/conversations.json');
let writeQueue = Promise.resolve();
// File JSON bisa membesar; simpan hasil parse selama mtime & ukuran file tidak berubah.
let cache: { file: string; mtimeMs: number; size: number; data: StoredConversation[] } | null = null;

async function readAllUnsafe(): Promise<StoredConversation[]> {
  const file = dataFile();
  try {
    const info = await stat(file);
    if (cache && cache.file === file && cache.mtimeMs === info.mtimeMs && cache.size === info.size) return cache.data;
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    const data = Array.isArray(parsed) ? parsed : [];
    cache = { file, mtimeMs: info.mtimeMs, size: info.size, data };
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeAllUnsafe(conversations: StoredConversation[]) {
  const file = dataFile();
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(conversations, null, 2), 'utf8');
  await rename(temporary, file);
  const info = await stat(file);
  cache = { file, mtimeMs: info.mtimeMs, size: info.size, data: conversations };
}

const byUpdatedDesc = (a: StoredConversation, b: StoredConversation) =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

export const toSummary = ({ messages, context: _context, ...rest }: StoredConversation): ConversationSummary => ({
  ...rest,
  messageCount: messages.length
});

export async function listConversations() {
  await writeQueue;
  return [...(await readAllUnsafe())].sort(byUpdatedDesc);
}

export async function listConversationSummaries(offset: number, limit: number) {
  const all = await listConversations();
  const page = all.slice(offset, offset + limit).map(toSummary);
  return { conversations: page, total: all.length, nextOffset: offset + page.length < all.length ? offset + page.length : null };
}

export async function getConversation(id: string) {
  await writeQueue;
  return (await readAllUnsafe()).find((item) => item.id === id) || null;
}

/** Ambil `limit` pesan terakhir sebelum pesan `before` (atau dari paling akhir). */
export async function getConversationPage(id: string, before: string | null, limit: number) {
  const conversation = await getConversation(id);
  if (!conversation) return null;
  const end = before ? conversation.messages.findIndex((message) => message.id === before) : conversation.messages.length;
  const safeEnd = end < 0 ? 0 : end;
  const start = Math.max(0, safeEnd - limit);
  return {
    conversation: { ...toSummary(conversation), ...(conversation.context ? { context: conversation.context } : {}) },
    messages: conversation.messages.slice(start, safeEnd),
    hasMore: start > 0
  };
}

/** Gabungkan pesan berdasarkan id: yang sudah ada diperbarui di tempat, yang baru ditambahkan di akhir. */
export function mergeMessages<T extends { id: string }>(existing: T[], incoming: T[], max = MAX_STORED_MESSAGES) {
  const merged = [...existing];
  const positions = new Map(merged.map((message, index) => [message.id, index]));
  for (const message of incoming) {
    const position = positions.get(message.id);
    if (position === undefined) {
      positions.set(message.id, merged.length);
      merged.push(message);
    } else {
      merged[position] = message;
    }
  }
  return merged.slice(-max);
}

const newerContext = (current?: ConversationContext, next?: ConversationContext) => {
  if (!current) return next;
  if (!next) return current;
  return new Date(next.compactedAt).getTime() > new Date(current.compactedAt).getTime() ? next : current;
};

/**
 * Klien hanya memegang sebagian riwayat, jadi `patch.messages` digabung ke pesan tersimpan
 * alih-alih menimpanya. Judul & waktu dibuat mengikuti data pertama.
 */
export async function upsertConversation(patch: StoredConversation) {
  let saved = patch;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const conversations = [...(await readAllUnsafe())];
    const index = conversations.findIndex((item) => item.id === patch.id);
    if (index < 0) {
      conversations.push(patch);
    } else {
      const existing = conversations[index];
      const context = newerContext(existing.context, patch.context);
      saved = {
        ...existing,
        model: patch.model,
        messages: mergeMessages(existing.messages, patch.messages),
        ...(context ? { context } : {}),
        updatedAt: patch.updatedAt
      };
      conversations[index] = saved;
    }
    await writeAllUnsafe(conversations);
  });
  await writeQueue;
  return saved;
}

export async function deleteConversation(id: string) {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const conversations = await readAllUnsafe();
    await writeAllUnsafe(conversations.filter((item) => item.id !== id));
  });
  await writeQueue;
}

export async function updateConversationContext(id: string, context: ConversationContext) {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const conversations = [...(await readAllUnsafe())];
    const index = conversations.findIndex((item) => item.id === id);
    if (index < 0) return;
    conversations[index] = { ...conversations[index], context };
    await writeAllUnsafe(conversations);
  });
  await writeQueue;
}
