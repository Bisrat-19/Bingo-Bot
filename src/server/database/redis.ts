import { Redis } from 'ioredis';
import { config } from '../config/env';
import { logger } from '../config/logger';

// Redis is OPTIONAL. When REDIS_URL is empty we run without it and rely on the
// in-process mutex + the atomic DB winner-claim for correctness.
let client: Redis | null = null;

export function getRedis(): Redis | null {
  if (!config.REDIS_URL) return null;
  if (!client) {
    client = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    client.on('error', (err: Error) => logger.warn({ err }, 'redis error'));
    client.on('connect', () => logger.info('Connected to Redis'));
  }
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
