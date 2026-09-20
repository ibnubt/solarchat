import { env } from '$env/dynamic/private';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'tokenku_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

const username = () => env.APP_USERNAME || 'solar';
const password = () => env.APP_PASSWORD || 'solar2026';
const secret = () => env.SESSION_SECRET || 'development-secret-change-before-deploy';

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function validateCredentials(inputUsername: string, inputPassword: string) {
  const expectedUser = Buffer.from(username());
  const actualUser = Buffer.from(inputUsername);
  const expectedPassword = Buffer.from(password());
  const actualPassword = Buffer.from(inputPassword);

  return expectedUser.length === actualUser.length &&
    expectedPassword.length === actualPassword.length &&
    timingSafeEqual(expectedUser, actualUser) &&
    timingSafeEqual(expectedPassword, actualPassword);
}

export function createSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({ user: username(), expires: Date.now() + SESSION_TTL_SECONDS * 1000 })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined) {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (session.user !== username() || Number(session.expires) < Date.now()) return null;
    return String(session.user);
  } catch {
    return null;
  }
}
