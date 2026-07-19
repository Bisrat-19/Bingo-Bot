// Optional seed script: run with `npm run db:seed`. Creates a couple of demo users
// with statistics so the /leaderboard command has something to show in development.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const demo = [
    { telegramId: 1001n, username: 'ada', firstName: 'Ada', gamesPlayed: 12, gamesWon: 5 },
    { telegramId: 1002n, username: 'linus', firstName: 'Linus', gamesPlayed: 9, gamesWon: 3 },
    { telegramId: 1003n, username: 'grace', firstName: 'Grace', gamesPlayed: 15, gamesWon: 7 },
  ];

  for (const d of demo) {
    const user = await prisma.user.upsert({
      where: { telegramId: d.telegramId },
      create: { telegramId: d.telegramId, username: d.username, firstName: d.firstName },
      update: {},
    });
    await prisma.statistics.upsert({
      where: { userId: user.id },
      create: { userId: user.id, gamesPlayed: d.gamesPlayed, gamesWon: d.gamesWon },
      update: { gamesPlayed: d.gamesPlayed, gamesWon: d.gamesWon },
    });
  }
  // eslint-disable-next-line no-console
  console.log('Seeded demo users + statistics.');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
