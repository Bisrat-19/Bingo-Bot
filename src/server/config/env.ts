// Next.js loads .env / .env.local automatically, so no dotenv import is needed here.
import { z } from 'zod';

// Validate + coerce environment variables once at startup. Fail fast on misconfig.
const schema = z.object({
  BOT_TOKEN: z.string().min(10, 'BOT_TOKEN is required (get one from @BotFather)'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),

  COUNTDOWN_SECONDS: z.coerce.number().int().min(5).max(600).default(60),
  DRAW_INTERVAL_SECONDS: z.coerce.number().int().min(2).max(120).default(10),
  MIN_PLAYERS: z.coerce.number().int().min(1).max(100).default(2),
  MAX_PLAYERS: z.coerce.number().int().min(2).max(1000).default(20),
  FALSE_BINGO_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(300).default(30),

  // Web / Mini App
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Public HTTPS base URL of the Mini App (e.g. a cloudflared tunnel). When set, the
  // bot shows an "Open Game" web_app button; when empty, it falls back to inline play.
  WEBAPP_URL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim().replace(/\/$/, '') : undefined)),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
export type AppConfig = typeof config;
