import { env } from '$env/dynamic/private';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ChatAttachment } from '$lib/chat';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const mimeExtensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
} as const;
const extensionMimes: Record<string, ChatAttachment['mimeType']> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

const uploadDirectory = () => resolve(env.UPLOAD_DATA_DIR || './data/uploads');
const safeId = (value: string) => /^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(value) ? value : null;

export async function saveImageUpload(file: File): Promise<ChatAttachment> {
  const mimeType = file.type as ChatAttachment['mimeType'];
  const extension = mimeExtensions[mimeType];
  if (!extension) throw new Error('Format gambar harus JPEG, PNG, atau WebP.');
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('Ukuran gambar maksimal 5 MB.');
  const data = Buffer.from(await file.arrayBuffer());
  const signatureValid =
    (mimeType === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) ||
    (mimeType === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mimeType === 'image/webp' && data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP');
  if (!signatureValid) throw new Error('Isi file tidak sesuai dengan format gambar.');

  const id = `${crypto.randomUUID()}.${extension}`;
  await mkdir(uploadDirectory(), { recursive: true });
  await writeFile(resolve(uploadDirectory(), id), data, { flag: 'wx' });
  return {
    id,
    name: file.name.replace(/[^a-zA-Z0-9._ -]/g, '').slice(0, 120) || `image.${extension}`,
    mimeType,
    size: file.size,
    url: `/api/uploads/${id}`
  };
}

export async function readImageUpload(id: string) {
  const validId = safeId(id);
  if (!validId) return null;
  try {
    const extension = validId.split('.').pop() || '';
    return { data: await readFile(resolve(uploadDirectory(), validId)), mimeType: extensionMimes[extension] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function deleteImageUpload(id: string) {
  const validId = safeId(id);
  if (!validId) return false;
  try {
    await unlink(resolve(uploadDirectory(), validId));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function imageUploadDataUrl(id: string) {
  const image = await readImageUpload(id);
  return image ? `data:${image.mimeType};base64,${image.data.toString('base64')}` : null;
}
