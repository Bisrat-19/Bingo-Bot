import type { PrismaClient, Winner } from '@prisma/client';

export interface CreateWinnerInput {
  gameId: string;
  userId: string;
  pattern: string;
  numbersCalled: number;
  durationMs: number;
}

export class WinnerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(input: CreateWinnerInput): Promise<Winner> {
    return this.prisma.winner.create({ data: input });
  }

  listByUser(userId: string, limit = 10): Promise<Winner[]> {
    return this.prisma.winner.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
