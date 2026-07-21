import type { PrismaClient, User } from '@prisma/client';
import type { TgUser } from '../types/index';

export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Ensure a User row exists, seeding new players with the configured starting coins.
   *
   * The seed is written to the ledger in the same transaction, so a player's balance
   * always equals the sum of their ledger entries. Without this, every account starts
   * life with coins that no audit can explain.
   */
  async upsertFromTelegram(u: TgUser, startingCoins: number): Promise<User> {
    const existing = await this.prisma.user.findUnique({ where: { telegramId: u.telegramId } });
    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { username: u.username, firstName: u.firstName },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          telegramId: u.telegramId,
          username: u.username,
          firstName: u.firstName,
          coins: startingCoins,
        },
      });
      if (startingCoins > 0) {
        await tx.ledgerEntry.create({
          data: {
            userId: created.id,
            delta: startingCoins,
            balanceAfter: startingCoins,
            reason: 'SIGNUP_BONUS',
          },
        });
      }
      return created;
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

  // NOTE: coin movements deliberately do NOT live here. Every credit and debit goes
  // through WalletService, which writes the matching ledger entry in the same
  // transaction. A "quick" helper on this repository would be a silent way to move
  // money without an audit trail.

  async coins(userId: string): Promise<number> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
    return u?.coins ?? 0;
  }
}
