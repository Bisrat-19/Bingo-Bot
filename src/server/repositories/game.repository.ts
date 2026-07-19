import type { Game, GameStatus, Prisma, PrismaClient } from '@prisma/client';

const ACTIVE_STATUSES: GameStatus[] = [
  'WAITING_FOR_PLAYERS',
  'CARD_GENERATED',
  'COUNTDOWN',
  'PLAYING',
];

export interface CreateGameInput {
  chatId: bigint;
  hostId: string;
  intervalMs: number;
  countdownSec: number;
  minPlayers: number;
  maxPlayers: number;
  patterns: string[];
}

export class GameRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(input: CreateGameInput): Promise<Game> {
    return this.prisma.game.create({ data: input });
  }

  findById(id: string): Promise<Game | null> {
    return this.prisma.game.findUnique({ where: { id } });
  }

  // The single non-finished game in a chat, if any (we allow one active game per chat).
  findActiveByChat(chatId: bigint): Promise<Game | null> {
    return this.prisma.game.findFirst({
      where: { chatId, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // All non-finished games across every chat (used for crash recovery on boot).
  findAllActive(): Promise<Game[]> {
    return this.prisma.game.findMany({ where: { status: { in: ACTIVE_STATUSES } } });
  }

  update(id: string, data: Prisma.GameUpdateInput): Promise<Game> {
    return this.prisma.game.update({ where: { id }, data });
  }

  setStatus(id: string, status: GameStatus): Promise<Game> {
    return this.prisma.game.update({ where: { id }, data: { status } });
  }

  setCurrentNumber(id: string, currentNumber: number): Promise<Game> {
    return this.prisma.game.update({ where: { id }, data: { currentNumber } });
  }

  /**
   * Atomically claim the winner slot. Returns true only for the caller that actually
   * won. Because the update is conditional on `winnerId: null` AND `status: PLAYING`,
   * concurrent presses (even across processes) can succeed at most once.
   */
  async claimWinner(gameId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.game.updateMany({
      where: { id: gameId, winnerId: null, status: 'PLAYING' },
      data: { winnerId: userId, status: 'FINISHED', endedAt: new Date() },
    });
    return result.count === 1;
  }
}
