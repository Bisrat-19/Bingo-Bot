import type { Entry, Prisma, PrismaClient, Round, RoundStatus } from '@prisma/client';

export type EntryWithCardAndUser = Entry & {
  card: { number: number; numbers: Prisma.JsonValue };
  user: { id: string; telegramId: bigint; username: string | null; firstName: string | null };
};

/**
 * The round aggregate: the round itself plus its entries (players+cards) and calls.
 * Kept together because they always change as one unit.
 */
export class RoundRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---- Round ----

  create(): Promise<Round> {
    return this.prisma.round.create({ data: {} });
  }

  /** The newest round — the room only ever has one "current" round. */
  current(): Promise<Round | null> {
    return this.prisma.round.findFirst({ orderBy: { createdAt: 'desc' } });
  }

  findById(id: string): Promise<Round | null> {
    return this.prisma.round.findUnique({ where: { id } });
  }

  update(id: string, data: Prisma.RoundUpdateInput): Promise<Round> {
    return this.prisma.round.update({ where: { id }, data });
  }

  setStatus(id: string, status: RoundStatus): Promise<Round> {
    return this.prisma.round.update({ where: { id }, data: { status } });
  }

  /** Close any rounds left mid-flight by a previous process (timers were lost). */
  async abandonUnfinished(): Promise<number> {
    const res = await this.prisma.round.updateMany({
      where: { status: { in: ['SELECTING', 'PLAYING'] } },
      data: { status: 'FINISHED', endedAt: new Date() },
    });
    return res.count;
  }

  /**
   * Atomically claim the win. Conditional on winnerId still being null AND the round
   * still PLAYING, so concurrent BINGO presses can succeed at most once.
   */
  async claimWinner(
    roundId: string,
    userId: string,
    cardNumber: number,
    pattern: string,
    line: number[],
  ): Promise<boolean> {
    const res = await this.prisma.round.updateMany({
      where: { id: roundId, winnerId: null, status: 'PLAYING' },
      data: {
        winnerId: userId,
        winnerCardNo: cardNumber,
        winnerPattern: pattern,
        winnerLine: line,
        status: 'FINISHED',
        endedAt: new Date(),
      },
    });
    return res.count === 1;
  }

  // ---- Entries (a player's card in this round) ----

  /**
   * Claim a card for a player. The unique indexes on (roundId, cardNumber) and
   * (roundId, userId) make this race-safe: a duplicate throws and we report "taken".
   */
  createEntry(roundId: string, userId: string, cardNumber: number): Promise<Entry> {
    return this.prisma.entry.create({ data: { roundId, userId, cardNumber } });
  }

  /** Move a player to a different free card (still race-safe via the unique index). */
  updateEntryCard(entryId: string, cardNumber: number): Promise<Entry> {
    return this.prisma.entry.update({ where: { id: entryId }, data: { cardNumber } });
  }

  findEntry(roundId: string, userId: string): Promise<EntryWithCardAndUser | null> {
    return this.prisma.entry.findUnique({
      where: { roundId_userId: { roundId, userId } },
      include: { card: true, user: true },
    });
  }

  listEntries(roundId: string): Promise<EntryWithCardAndUser[]> {
    return this.prisma.entry.findMany({
      where: { roundId },
      include: { card: true, user: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async takenCardNumbers(roundId: string): Promise<number[]> {
    const rows = await this.prisma.entry.findMany({
      where: { roundId },
      select: { cardNumber: true },
    });
    return rows.map((r) => r.cardNumber);
  }

  countEntries(roundId: string): Promise<number> {
    return this.prisma.entry.count({ where: { roundId } });
  }

  addMark(entryId: string, number: number): Promise<Entry> {
    return this.prisma.entry.update({
      where: { id: entryId },
      data: { marked: { push: number } },
    });
  }

  setHasBingo(entryId: string, hasBingo: boolean): Promise<Entry> {
    return this.prisma.entry.update({ where: { id: entryId }, data: { hasBingo } });
  }

  // ---- Calls (drawn numbers) ----

  addCall(roundId: string, number: number, order: number): Promise<unknown> {
    return this.prisma.call.create({ data: { roundId, number, order } });
  }

  async listCalls(roundId: string): Promise<number[]> {
    const rows = await this.prisma.call.findMany({
      where: { roundId },
      orderBy: { order: 'asc' },
      select: { number: true },
    });
    return rows.map((r) => r.number);
  }
}
