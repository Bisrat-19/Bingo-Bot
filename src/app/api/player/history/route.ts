import { prisma } from '@/server/database/prisma';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

/** The player's recent rounds, newest first. */
export async function POST(req: Request) {
  const body = await parseBody(req);
  const user = await resolveUser(body, req).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);

  const take = Math.min(Number(body.take) || 20, 50);
  const entries = await prisma.entry.findMany({
    where: { userId: user.id, round: { status: 'FINISHED' } },
    orderBy: { createdAt: 'desc' },
    take: take * 3, // a player may hold several cards in one round
    select: {
      cardNumber: true,
      round: {
        select: {
          id: true,
          pot: true,
          entryFee: true,
          winnerId: true,
          winnerCardNo: true,
          endedAt: true,
          createdAt: true,
        },
      },
    },
  });

  // Collapse the rows into one entry per round, listing every card the player held.
  const byRound = new Map<string, { cards: number[]; round: (typeof entries)[0]['round'] }>();
  for (const e of entries) {
    const hit = byRound.get(e.round.id);
    if (hit) hit.cards.push(e.cardNumber);
    else byRound.set(e.round.id, { cards: [e.cardNumber], round: e.round });
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const cut = settings?.houseCutPercent ?? 20;

  const games = [...byRound.values()]
    .slice(0, take)
    .map(({ cards, round }) => ({
      // Short, readable id for the screen.
      code: round.id.slice(-8).toUpperCase(),
      playedAt: round.endedAt ?? round.createdAt,
      stake: round.entryFee,
      prize: Math.floor((round.pot * (100 - cut)) / 100),
      myCards: cards.sort((a, b) => a - b),
      winnerCard: round.winnerCardNo,
      won: round.winnerId === user.id,
      winners: round.winnerId ? 1 : 0,
    }));

  return jsonSafe({ ok: true, games });
}
