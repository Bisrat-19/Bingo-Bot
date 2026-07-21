import { prisma } from '@/server/database/prisma';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';

/**
 * Paged user list for the admin dashboard.
 * Body: { search?: string, skip?: number, take?: number }
 */
export async function POST(req: Request) {
  const body = (await parseBody(req)) as Record<string, unknown>;
  const denied = await requireAdmin(req, body);
  if (denied) return denied;

  const search = typeof body.search === 'string' ? body.search.trim() : '';
  const skip = Number(body.skip) || 0;
  const take = Math.min(Number(body.take) || 50, 200);

  const where = search
    ? {
        OR: [
          { username: { contains: search, mode: 'insensitive' as const } },
          { firstName: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        telegramId: true,
        username: true,
        firstName: true,
        coins: true,
        blocked: true,
        registered: true,
        phone: true,
        createdAt: true,
        statistics: {
          select: { gamesPlayed: true, gamesWon: true, bingosCalled: true, falseBingos: true },
        },
      },
    }),
  ]);

  return jsonSafe({ ok: true, total, skip, take, users });
}
