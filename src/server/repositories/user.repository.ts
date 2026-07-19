import type { PrismaClient, User } from '@prisma/client';
import type { TgUser } from '../types/index';

export class UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Ensure a User row exists for this Telegram account, keeping name/username fresh.
  async upsertFromTelegram(u: TgUser): Promise<User> {
    return this.prisma.user.upsert({
      where: { telegramId: u.telegramId },
      create: { telegramId: u.telegramId, username: u.username, firstName: u.firstName },
      update: { username: u.username, firstName: u.firstName },
    });
  }

  findByTelegramId(telegramId: bigint): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { telegramId } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
