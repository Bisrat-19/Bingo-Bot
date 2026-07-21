import type { PrismaClient, User } from '@prisma/client';
import type { TgUser } from '../types/index';

export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Ensure a User row exists, seeding new players with the configured starting coins. */
  async upsertFromTelegram(u: TgUser, startingCoins: number): Promise<User> {
    return this.prisma.user.upsert({
      where: { telegramId: u.telegramId },
      create: {
        telegramId: u.telegramId,
        username: u.username,
        firstName: u.firstName,
        coins: startingCoins,
      },
      update: { username: u.username, firstName: u.firstName },
    });
  }

  findByTelegramId(telegramId: bigint): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** Mark a player registered (idempotent — re-registering keeps the original date). */
  markRegistered(userId: string, phone?: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { registered: true, registeredAt: new Date(), ...(phone ? { phone } : {}) },
    });
  }

  /**
   * Atomically charge coins. Conditional on the balance being sufficient, so two
   * concurrent charges can never overdraw an account.
   */
  async chargeCoins(userId: string, amount: number): Promise<boolean> {
    if (amount <= 0) return true;
    const res = await this.prisma.user.updateMany({
      where: { id: userId, coins: { gte: amount } },
      data: { coins: { decrement: amount } },
    });
    return res.count === 1;
  }

  async addCoins(userId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.prisma.user.update({ where: { id: userId }, data: { coins: { increment: amount } } });
  }

  async coins(userId: string): Promise<number> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
    return u?.coins ?? 0;
  }
}
