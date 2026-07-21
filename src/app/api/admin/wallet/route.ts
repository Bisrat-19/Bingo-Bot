import { prisma } from '@/server/database/prisma';
import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';

/**
 * Adjust a player's wallet.
 * Body: { userId | telegramId, delta?: number, set?: number }
 *  - `delta`: add (or subtract with a negative number)
 *  - `set`:   set an exact balance
 *
 * Goes through WalletService so the change lands in the ledger as ADMIN_ADJUST. An
 * unexplained balance must never appear in the audit trail — every coin a player holds
 * has to trace back to a deposit, a prize, a bonus, or a named admin adjustment.
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

  let delta: number;
  if (body.set != null) {
    const target = Math.round(Number(body.set));
    if (!Number.isFinite(target)) return jsonSafe({ ok: false, reason: 'set must be a number' }, 400);
    delta = Math.max(0, target) - user.coins;
  } else if (body.delta != null) {
    delta = Math.round(Number(body.delta));
    if (!Number.isFinite(delta)) return jsonSafe({ ok: false, reason: 'delta must be a number' }, 400);
    // Never let a subtraction push the balance negative — clamp it to zero instead.
    if (user.coins + delta < 0) delta = -user.coins;
  } else {
    return jsonSafe({ ok: false, reason: 'delta or set required' }, 400);
  }

  const { wallet } = getContainer();
  if (delta > 0) await wallet.credit(user.id, delta, 'ADMIN_ADJUST');
  else if (delta < 0) await wallet.debit(user.id, -delta, 'ADMIN_ADJUST');

  const updated = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, telegramId: true, username: true, coins: true, blocked: true },
  });
  return jsonSafe({ ok: true, user: updated, delta });
}
