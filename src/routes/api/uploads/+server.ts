import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveImageUpload } from '$lib/server/uploads';

export const POST: RequestHandler = async ({ request }) => {
  const form = await request.formData().catch(() => null);
  const file = form?.get('image');
  if (!(file instanceof File)) return json({ error: 'File gambar diperlukan.' }, { status: 400 });
  try {
    return json({ attachment: await saveImageUpload(file) }, { status: 201 });
  } catch (error) {
    return json({ error: (error as Error).message }, { status: 400 });
  }
};
