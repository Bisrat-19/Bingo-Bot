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

  /// Secret used to sign session JWTs. Falls back to a value derived from BOT_TOKEN,
  /// but set an explicit random secret in production.
  JWT_SECRET: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length >= 16 ? v.trim() : undefined)),
  /// Session lifetime in seconds (default 7 days).
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(60 * 60 * 24 * 30).default(604800),
  /// Max age of a Telegram initData payload we'll accept at login (replay protection).
  INITDATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(86400).default(86400),

  /// Bearer token for the standalone admin dashboard (sent as `Authorization: Bearer …`).
  /// Leave empty to allow only Telegram-authenticated admins.
  ADMIN_API_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),

  /// Optional dedicated chat/group for admin review messages. When set, approve/reject
  /// notifications go ONLY here instead of into each admin's private chat — so an admin
  /// who is also a player never sees admin controls in their own conversation.
  ADMIN_CHAT_ID: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),

  /// Comma-separated Telegram user IDs allowed to open the admin panel.
  ADMIN_TELEGRAM_IDS: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // ---- Continuous room (defaults; admins override these live in the DB) ----
  /// Seconds of card selection AFTER the first player picks a card.
  SELECTION_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
  /// How long the winner is shown before the next round's selection opens.
  WINNER_DISPLAY_SECONDS: z.coerce.number().int().min(2).max(60).default(8),
  /// Size of the fixed card catalog.
  CARD_POOL_SIZE: z.coerce.number().int().min(10).max(500).default(100),

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
