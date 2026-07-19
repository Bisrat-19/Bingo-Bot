import type { Player, Prisma, PrismaClient } from '@prisma/client';
import type { Card } from '../types/index';

export type PlayerWithUser = Player & {
  user: { id: string; telegramId: bigint; username: string | null; firstName: string | null };
};

export class PlayerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  add(gameId: string, userId: string, card: Card): Promise<Player> {
    return this.prisma.player.create({
      data: { gameId, userId, card: card as unknown as Prisma.InputJsonValue },
    });
  }

  findByGameAndUser(gameId: string, userId: string): Promise<Player | null> {
    return this.prisma.player.findUnique({ where: { userId_gameId: { userId, gameId } } });
  }

  findById(id: string): Promise<Player | null> {
    return this.prisma.player.findUnique({ where: { id } });
  }

  listByGame(gameId: string): Promise<PlayerWithUser[]> {
    return this.prisma.player.findMany({
      where: { gameId, leftAt: null },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
  }

  countActive(gameId: string): Promise<number> {
    return this.prisma.player.count({ where: { gameId, leftAt: null } });
  }

  // Append a number to the player's marked list (Postgres array push — no read-modify-write).
  async addMark(playerId: string, number: number): Promise<Player> {
    return this.prisma.player.update({
      where: { id: playerId },
      data: { markedNumbers: { push: number } },
    });
  }

  setHasBingo(playerId: string, hasBingo: boolean): Promise<Player> {
    return this.prisma.player.update({ where: { id: playerId }, data: { hasBingo } });
  }

  setCardMessageId(playerId: string, cardMessageId: number): Promise<Player> {
    return this.prisma.player.update({ where: { id: playerId }, data: { cardMessageId } });
  }

  leave(playerId: string): Promise<Player> {
    return this.prisma.player.update({ where: { id: playerId }, data: { leftAt: new Date() } });
  }
}
