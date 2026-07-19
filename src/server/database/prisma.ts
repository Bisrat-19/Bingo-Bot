import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

// A single PrismaClient reused across the process. In dev, Next's HMR would otherwise
// create a new client on every reload and exhaust DB connections — so we cache it on
// globalThis.
const makeClient = () =>
  new PrismaClient({
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });

// Preserve the event-log generic (so `$on('warn'|'error')` stays typed) via the factory.
const globalForPrisma = globalThis as unknown as { __prisma?: ReturnType<typeof makeClient> };

export const prisma = globalForPrisma.__prisma ?? makeClient();

if (!globalForPrisma.__prisma) {
  prisma.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));
  prisma.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'));
  globalForPrisma.__prisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  await prisma.$connect();
  logger.info('Connected to PostgreSQL');
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
