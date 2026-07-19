import { NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { config } from './config/env';
import { getContainer } from './container';
import { verifyInitData } from './auth';
import type { TgUser } from './types/index';

export interface ApiBody {
  initData?: string;
  gameId?: string;
  number?: number;
  devUser?: string;
  devUsername?: string;
  devFirst?: string;
}

// JSON response that safely serializes Prisma BigInt fields (chatId/telegramId).
export function jsonSafe(data: unknown, status = 200): NextResponse {
  const body = JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return new NextResponse(body, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// Resolve the acting user from validated Telegram initData. Identity is NEVER taken
// from the client directly. The dev fallback only works in development.
export async function resolveUser(body: ApiBody): Promise<User | null> {
  let tg: TgUser | null = verifyInitData(body.initData ?? '');
  if (!tg && config.NODE_ENV === 'development' && body.devUser) {
    tg = {
      telegramId: BigInt(body.devUser),
      username: body.devUsername || 'dev',
      firstName: body.devFirst || 'Dev',
    };
  }
  if (!tg) return null;
  return getContainer().gameService.ensureUser(tg);
}

// Parse the JSON body defensively (never throws).
export async function parseBody(req: Request): Promise<ApiBody> {
  try {
    return (await req.json()) as ApiBody;
  } catch {
    return {};
  }
}
