import crypto from 'crypto';
import { config } from '../config/env';

/**
 * Minimal HS256 JWT (sign/verify) built on node:crypto — no extra dependency.
 * Used for the app's own session after Telegram's initData has been validated once.
 */

export interface SessionPayload {
  /** our internal user id */
  sub: string;
  /** telegram user id, for logging/debugging */
  tg: string;
  /**
   * 'session' — a full session token used on every API call.
   * 'launch'  — short-lived token the bot embeds in the Mini App URL; it can ONLY be
   *             exchanged for a session, never used to call the game API directly.
   */
  scope: 'session' | 'launch';
  iat: number;
  exp: number;
}

// Prefer an explicit secret in production; otherwise derive a stable one from the bot
// token so the app still works out of the box.
const SECRET: Buffer = config.JWT_SECRET
  ? Buffer.from(config.JWT_SECRET)
  : crypto.createHash('sha256').update(`${config.BOT_TOKEN}:session`).digest();

const b64 = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

function signature(data: string): string {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

export function signSession(
  userId: string,
  telegramId: bigint,
  ttlSeconds: number,
  scope: 'session' | 'launch' = 'session',
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: userId,
    tg: String(telegramId),
    scope,
    iat: now,
    exp: now + ttlSeconds,
  };
  const data = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify(payload))}`;
  return `${data}.${signature(data)}`;
}

/** Returns the payload when the token is authentic and unexpired, else null. */
export function verifySession(token: string): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const data = `${parts[0]}.${parts[1]}`;
  const expected = signature(data);
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as SessionPayload;
    if (!payload.sub || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null; // expired
    if (payload.scope !== 'session' && payload.scope !== 'launch') return null;
    return payload;
  } catch {
    return null;
  }
}
