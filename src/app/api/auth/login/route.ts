import { NextResponse } from 'next/server';
import { verifyInitData } from '@/server/auth';
import { signSession, verifySession } from '@/server/auth/jwt';
import { config } from '@/server/config/env';
import { logger } from '@/server/config/logger';
import { getContainer } from '@/server/container';
import { jsonSafe, parseBody } from '@/server/webapi';

/**
 * Exchange Telegram's signed `initData` for our own session JWT.
 *
 * This runs ONCE per session. Every later request authenticates with the JWT
 * (Authorization: Bearer …, or the httpOnly cookie), so we don't re-verify the HMAC
 * on every call and the session survives even if initData is no longer available.
 */
export async function POST(req: Request) {
  const body = (await parseBody(req)) as { initData?: string; launchToken?: string };
  const initData = body.initData ?? '';
  const launchToken = body.launchToken ?? '';

  const container = getContainer();
  let user = null;

  // Path 1: a signed launch token from the bot's Play button (works on every client).
  if (launchToken) {
    const claims = verifySession(launchToken);
    if (claims?.scope === 'launch') user = await container.room.userById(claims.sub);
  }

  // Path 2: Telegram's own signed initData (preferred when the client provides it).
  if (!user && initData) {
    const tg = verifyInitData(initData);
    if (tg) user = await container.room.ensureUser(tg);
  }

  if (!user) {
    logger.warn(
      { initDataLen: initData.length, hasLaunchToken: Boolean(launchToken) },
      'login rejected: no valid credentials',
    );
    return jsonSafe(
      { ok: false, reason: 'Sign-in failed. Please reopen the game from the bot.' },
      401,
    );
  }
  const token = signSession(user.id, user.telegramId, config.SESSION_TTL_SECONDS);

  const res = NextResponse.json({
    ok: true,
    token,
    user: {
      id: user.id,
      telegramId: String(user.telegramId),
      username: user.username,
      firstName: user.firstName,
      registered: user.registered,
      coins: user.coins,
    },
  });

  // Cookie as a secondary transport. The Mini App runs in a webview, so it primarily
  // uses the bearer token; SameSite=None is required for the cookie to survive there.
  res.cookies.set('bingo_session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: config.SESSION_TTL_SECONDS,
  });

  logger.info({ userId: user.id, telegramId: String(user.telegramId) }, 'session issued');
  return res;
}
