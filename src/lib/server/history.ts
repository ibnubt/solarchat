import { env } from '$env/dynamic/private';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
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

const dataFile = () => resolve(env.CHAT_DATA_FILE || './data/conversations.json');
let writeQueue = Promise.resolve();

async function readAllUnsafe(): Promise<StoredConversation[]> {
  try {
    const parsed = JSON.parse(await readFile(dataFile(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
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
}

export async function listConversations() {
  await writeQueue;
  return (await readAllUnsafe()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export async function getConversation(id: string) {
  await writeQueue;
  return (await readAllUnsafe()).find((item) => item.id === id) || null;
}

export async function saveConversation(conversation: StoredConversation) {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const conversations = await readAllUnsafe();
    const index = conversations.findIndex((item) => item.id === conversation.id);
    if (index >= 0) conversations[index] = conversation;
    else conversations.push(conversation);
    await writeAllUnsafe(conversations);
  });
  await writeQueue;
  return conversation;
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
    const conversations = await readAllUnsafe();
    const index = conversations.findIndex((item) => item.id === id);
    if (index < 0) return;
    conversations[index] = { ...conversations[index], context };
    await writeAllUnsafe(conversations);
  });
  await writeQueue;
}
