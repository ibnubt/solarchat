import { json, redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, verifySessionToken } from '$lib/server/auth';

const publicPaths = ['/login', '/api/auth/login'];

export const handle: Handle = async ({ event, resolve }) => {
  // Paksa HTTPS: redirect semua request HTTP ke HTTPS
  const proto = event.request.headers.get('x-forwarded-proto') || event.url.protocol.replace(':', '');
  if (proto !== 'https') {
    const url = new URL(event.request.url);
    url.protocol = 'https:';
    url.port = '';
    throw redirect(308, url.toString());
  }

  const pathname = event.url.pathname;
  const user = verifySessionToken(event.cookies.get(SESSION_COOKIE));
  event.locals.user = user;

  if (pathname === '/login' && user) throw redirect(303, '/');
  if (publicPaths.includes(pathname) || pathname.startsWith('/_app/')) return resolve(event);

  if (!user) {
    if (pathname.startsWith('/api/')) return json({ error: 'Sesi berakhir. Silakan masuk kembali.' }, { status: 401 });
    throw redirect(303, `/login?returnTo=${encodeURIComponent(pathname)}`);
  }

  return resolve(event);
};
