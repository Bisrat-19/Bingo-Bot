import { prisma } from '@/server/database/prisma';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

/**
 * Everything the Wallet and Profile screens need: account, the three balance buckets,
 * and lifetime stats.
 */
export async function POST(req: Request) {
  const body = await parseBody(req);
  const user = await resolveUser(body, req).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);

  const [stats, withdrawn, deposited, ledger] = await Promise.all([
    prisma.statistics.findUnique({ where: { userId: user.id } }),
    prisma.transaction.aggregate({
      where: { userId: user.id, type: 'WITHDRAWAL', status: 'APPROVED' },
      _sum: { approvedAmount: true, amount: true },
    }),
    prisma.transaction.aggregate({
      where: { userId: user.id, type: 'DEPOSIT', status: 'APPROVED' },
      _sum: { approvedAmount: true, amount: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
      // refId ties a movement to the round/transaction that caused it, so the wallet can
      // show "Stake · Game #ABCD1234" instead of a bare "Stake".
      select: { delta: true, balanceAfter: true, reason: true, refId: true, createdAt: true },
    }),
  ]);

  return jsonSafe({
    ok: true,
    account: {
      username: user.username,
      firstName: user.firstName,
      telegramId: user.telegramId,
      phone: user.phone,
    },
    balances: {
      total: user.coins,
      main: user.mainBalance,
      bonus: user.bonusBalance,
      deposited: user.depositBalance,
    },
    stats: {
      totalWithdrawal: withdrawn._sum.approvedAmount ?? withdrawn._sum.amount ?? 0,
      totalDeposit: deposited._sum.approvedAmount ?? deposited._sum.amount ?? 0,
      gamesWon: stats?.gamesWon ?? 0,
      gamesPlayed: stats?.gamesPlayed ?? 0,
      // No referral system yet; reported honestly rather than faked.
      totalInvites: 0,
    },
    ledger,
  });
}
