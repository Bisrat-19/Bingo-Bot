import { prisma } from '@/server/database/prisma';
import { getContainer } from '@/server/container';
import { jsonSafe, parseBody, requireAdmin } from '@/server/webapi';

// At-a-glance numbers for the dashboard home screen.
export async function POST(req: Request) {
  const body = (await parseBody(req)) as Record<string, unknown>;
  const denied = await requireAdmin(req, body);
  if (denied) return denied;

  const [users, blocked, rounds, winners, coinsAgg, recentWinners, room] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { blocked: true } }),
    prisma.round.count(),
    prisma.winner.count(),
    prisma.user.aggregate({ _sum: { coins: true } }),
    prisma.winner.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        cardNumber: true,
        pattern: true,
        numbersCalled: true,
        durationMs: true,
        createdAt: true,
        user: { select: { username: true, firstName: true, telegramId: true } },
      },
    }),
    getContainer().room.getState(),
  ]);

  return jsonSafe({
    ok: true,
    totals: {
      users,
      blockedUsers: blocked,
      rounds,
      winners,
      coinsInCirculation: coinsAgg._sum.coins ?? 0,
    },
    room: { phase: room.phase, players: room.playersCount, pot: room.pot, called: room.called.length },
    recentWinners,
  });
}
