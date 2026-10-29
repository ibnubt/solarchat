import { json, redirect, type Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, verifySessionToken } from '$lib/server/auth';

const publicPaths = ['/login', '/api/auth/login'];

export const handle: Handle = async ({ event, resolve }) => {
  // Paksa HTTPS: redirect semua request HTTP ke HTTPS.
  // Akses langsung dari mesin sendiri dikecualikan, jika tidak `bun run dev` selalu dialihkan
  // ke https://localhost yang tidak ada. Di produksi header x-forwarded-proto selalu dikirim tunnel.
  const forwarded = event.request.headers.get('x-forwarded-proto');
  const proto = forwarded || event.url.protocol.replace(':', '');
  const isLocal = !forwarded && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(event.url.hostname);
  if (proto !== 'https' && !isLocal) {
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
