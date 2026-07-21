import type { BingoCard, Prisma, PrismaClient } from '@prisma/client';
import type { Card } from '../types/index';

// The fixed 100-card catalog. Generated once, then permanent — card #7 always has the
// same numbers, so players can favour "their" card number.
export class CatalogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  count(): Promise<number> {
    return this.prisma.bingoCard.count();
  }

  async createMany(cards: { number: number; numbers: Card }[]): Promise<void> {
    await this.prisma.bingoCard.createMany({
      data: cards.map((c) => ({
        number: c.number,
        numbers: c.numbers as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }

  get(number: number): Promise<BingoCard | null> {
    return this.prisma.bingoCard.findUnique({ where: { number } });
  }

  /** Every card, ordered. Read once at runtime and cached by the caller. */
  all(): Promise<BingoCard[]> {
    return this.prisma.bingoCard.findMany({ orderBy: { number: 'asc' } });
  }

  listNumbers(): Promise<{ number: number }[]> {
    return this.prisma.bingoCard.findMany({ select: { number: true }, orderBy: { number: 'asc' } });
  }
}
