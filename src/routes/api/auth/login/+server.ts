import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  validateCredentials
} from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!validateCredentials(username, password)) {
    return json({ error: 'Username atau password tidak sesuai.' }, { status: 401 });
  }

  cookies.set(SESSION_COOKIE, createSessionToken(), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_SECONDS
  });

  return json({ success: true });
};
