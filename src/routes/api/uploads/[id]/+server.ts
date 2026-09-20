import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteImageUpload, readImageUpload } from '$lib/server/uploads';

export const GET: RequestHandler = async ({ params }) => {
  const image = await readImageUpload(params.id);
  if (!image) return json({ error: 'Gambar tidak ditemukan.' }, { status: 404 });
  return new Response(image.data, {
    headers: {
      'Content-Type': image.mimeType,
      'Content-Length': String(image.data.byteLength),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    }
  });
};

export const DELETE: RequestHandler = async ({ params }) =>
  json({ success: await deleteImageUpload(params.id) });
