import { NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { config } from './config/env';
import { logger } from './config/logger';
import { getContainer } from './container';
import { verifyInitData } from './auth';
import { verifySession } from './auth/jwt';
import type { TgUser } from './types/index';

function bearerToken(req?: Request): string {
  const auth = req?.headers.get('authorization') ?? '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

function cookieToken(req?: Request): string {
  const cookie = req?.headers.get('cookie') ?? '';
  const m = /(?:^|;\s*)bingo_session=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : '';
}

export interface ApiBody {
  initData?: string;
  cardNumber?: number;
  number?: number;
  /** Bulk mark (AUTO -> MANUAL carry-over). */
  numbers?: number[];
  /** Paging for history. */
  take?: number;
  devUser?: string;
  devUsername?: string;
  devFirst?: string;
}

// JSON response that safely serializes Prisma BigInt fields.
export function jsonSafe(data: unknown, status = 200): NextResponse {
  const body = JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return new NextResponse(body, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Identity always comes from validated Telegram initData — never from the client.
export async function resolveUser(body: ApiBody, req?: Request): Promise<User | null> {
  // 1) our own session JWT (normal path after login) — bearer header or cookie
  const token = bearerToken(req) || cookieToken(req);
  if (token) {
    const session = verifySession(token);
    if (session && session.scope === 'session') {
      const user = await getContainer().room.userById(session.sub);
      if (user) return user;
    }
  }

  // 2) fall back to raw Telegram initData (first call / no session yet)
  const raw = body.initData ?? '';
  let tg: TgUser | null = verifyInitData(raw);

  if (config.NODE_ENV === 'development') {
    logger.debug(
      { hasToken: Boolean(token), initDataLen: raw.length, verified: Boolean(tg) },
      'auth attempt',
    );
  }
  if (!tg && config.NODE_ENV === 'development' && body.devUser) {
    tg = {
      telegramId: BigInt(body.devUser),
      username: body.devUsername || 'dev',
      firstName: body.devFirst || 'Dev',
    };
  }
  if (!tg) return null;
  return getContainer().room.ensureUser(tg);
}

/**
 * Admin gate for both entry points:
 *  - the Mini App panel  -> validated Telegram initData + ADMIN_TELEGRAM_IDS
 *  - the standalone dashboard -> `Authorization: Bearer <ADMIN_API_TOKEN>`
 * Returns null when authorized, or a ready-to-return error response.
 */
export async function requireAdmin(req: Request, body: ApiBody): Promise<NextResponse | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (config.ADMIN_API_TOKEN && token && token === config.ADMIN_API_TOKEN) return null;

  const user = await resolveUser(body).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);
  if (!config.ADMIN_TELEGRAM_IDS.includes(String(user.telegramId))) {
    return jsonSafe({ ok: false, reason: 'Admins only.' }, 403);
  }
  return null;
}

export async function parseBody(req: Request): Promise<ApiBody> {
  try {
    return (await req.json()) as ApiBody;
  } catch {
    return {};
  }
}
