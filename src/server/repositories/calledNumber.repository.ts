import type { CalledNumber, PrismaClient } from '@prisma/client';

export class CalledNumberRepository {
  constructor(private readonly prisma: PrismaClient) {}

  add(gameId: string, number: number, order: number): Promise<CalledNumber> {
    return this.prisma.calledNumber.create({ data: { gameId, number, order } });
  }

  async listNumbers(gameId: string): Promise<number[]> {
    const rows = await this.prisma.calledNumber.findMany({
      where: { gameId },
      orderBy: { order: 'asc' },
      select: { number: true },
    });
    return rows.map((r) => r.number);
  }

  count(gameId: string): Promise<number> {
    return this.prisma.calledNumber.count({ where: { gameId } });
  }
}
