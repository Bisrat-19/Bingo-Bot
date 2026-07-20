import { prisma } from '@/server/database/prisma';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';

/**
 * Adjust a player's wallet.
 * Body: { userId | telegramId, delta?: number, set?: number }
 *  - `delta`: add (or subtract with a negative number)
 *  - `set`:   set an exact balance
 * Balance can never go below zero.
 */
export async function POST(req: Request) {
  const body = (await parseBody(req)) as Record<string, unknown>;
  const denied = await requireAdmin(req, body);
  if (denied) return denied;

  const where =
    typeof body.userId === 'string'
      ? { id: body.userId }
      : body.telegramId != null
        ? { telegramId: BigInt(String(body.telegramId)) }
        : null;
  if (!where) return jsonSafe({ ok: false, reason: 'userId or telegramId required' }, 400);

  const user = await prisma.user.findUnique({ where });
  if (!user) return jsonSafe({ ok: false, reason: 'User not found' }, 404);

  let coins = user.coins;
  if (body.set != null) coins = Math.max(0, Math.round(Number(body.set)));
  else if (body.delta != null) coins = Math.max(0, user.coins + Math.round(Number(body.delta)));
  else return jsonSafe({ ok: false, reason: 'delta or set required' }, 400);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { coins },
    select: { id: true, telegramId: true, username: true, coins: true, blocked: true },
  });
  return jsonSafe({ ok: true, user: updated });
}
