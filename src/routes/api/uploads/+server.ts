import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveImageUpload } from '$lib/server/uploads';

export const POST: RequestHandler = async ({ request }) => {
  const form = await request.formData().catch((e) => {
    console.error('[uploads] formData error:', e);
    return null;
  });
  const file = form?.get('image');
  if (!(file instanceof File)) {
    console.error(`[uploads] bukan file gambar, type=${typeof file}, keys=${form ? [...form.keys()].join(',') : 'null'}, contentType=${request.headers.get('content-type')}`);
    return json({ error: 'File gambar diperlukan.' }, { status: 400 });
  }
  try {
    const attachment = await saveImageUpload(file);
    console.log(`[uploads] OK: ${attachment.id} (${attachment.mimeType}, ${attachment.size} byte)`);
    return json({ attachment }, { status: 201 });
  } catch (error) {
    console.error(`[uploads] GAGAL: ${(error as Error).message} (file=${file.name}, type=${file.type}, size=${file.size})`);
    return json({ error: (error as Error).message }, { status: 400 });
  }
};
