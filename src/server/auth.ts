import crypto from 'crypto';
import { config } from './config/env';
import type { TgUser } from './types/index';

/**
 * Validates a Telegram Mini App `initData` string per the official algorithm:
 *   secret = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)
 *   hash   = HMAC_SHA256(key=secret, data=dataCheckString)
 * where dataCheckString is the remaining params (minus `hash`) sorted and joined by \n.
 * Returns the authenticated Telegram user, or null if the signature is invalid.
 *
 * The server NEVER trusts a client-supplied user id — identity always comes from here.
 */
export function verifyInitData(initData: string): TgUser | null {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(config.BOT_TOKEN).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  // Constant-time comparison.
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Replay protection: reject payloads older than the configured window.
  const authDate = Number(params.get('auth_date'));
  if (Number.isFinite(authDate) && authDate > 0) {
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > config.INITDATA_MAX_AGE_SECONDS) return null;
  }

  const userJson = params.get('user');
  if (!userJson) return null;
  try {
    const u = JSON.parse(userJson) as { id: number; username?: string; first_name?: string };
    return { telegramId: BigInt(u.id), username: u.username, firstName: u.first_name };
  } catch {
    return null;
  }
}
