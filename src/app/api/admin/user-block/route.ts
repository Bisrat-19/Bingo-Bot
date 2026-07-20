import { prisma } from '@/server/database/prisma';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';

/**
 * Block / unblock a player.
 * Body: { userId | telegramId, blocked: boolean }
 * Blocked players cannot take a card in any round.
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

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { blocked: Boolean(body.blocked) },
    select: { id: true, telegramId: true, username: true, coins: true, blocked: true },
  });
  return jsonSafe({ ok: true, user: updated });
}
