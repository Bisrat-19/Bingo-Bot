import type { PrismaClient, Statistics } from '@prisma/client';

export class StatisticsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private ensure(userId: string) {
    // upsert with no-op update so a row always exists before incrementing.
    return this.prisma.statistics.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async incrementGamesPlayed(userIds: string[]): Promise<void> {
    await Promise.all(
      userIds.map(async (userId) => {
        await this.ensure(userId);
        await this.prisma.statistics.update({
          where: { userId },
          data: { gamesPlayed: { increment: 1 } },
        });
      }),
    );
  }

  async incrementGamesWon(userId: string): Promise<void> {
    await this.ensure(userId);
    await this.prisma.statistics.update({
      where: { userId },
      data: { gamesWon: { increment: 1 } },
    });
  }

  async incrementBingosCalled(userId: string): Promise<void> {
    await this.ensure(userId);
    await this.prisma.statistics.update({
      where: { userId },
      data: { bingosCalled: { increment: 1 } },
    });
  }

  async incrementFalseBingos(userId: string): Promise<void> {
    await this.ensure(userId);
    await this.prisma.statistics.update({
      where: { userId },
      data: { falseBingos: { increment: 1 } },
    });
  }

  getByUser(userId: string): Promise<Statistics | null> {
    return this.prisma.statistics.findUnique({ where: { userId } });
  }
}
