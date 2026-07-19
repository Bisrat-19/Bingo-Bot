// Next.js runs this once when the server process starts (both `next dev` and
// `next start`). We use it to boot the Telegram bot (long-polling) and the game engine
// in the SAME process that serves the API routes, so they share in-memory state.
//
// NOTE: this requires a persistent Node server (Docker / Railway / Render / VPS), not a
// serverless platform — the bot's polling loop and the number-calling timers must keep
// running between requests.

export async function register(): Promise<void> {
  // Only run in the Node.js server runtime (never Edge / browser).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const g = globalThis as unknown as { __botStarted?: boolean };
  if (g.__botStarted) return;
  g.__botStarted = true;

  const { logger } = await import('./server/config/logger');
  try {
    const { getContainer } = await import('./server/container');
    const { connectDatabase } = await import('./server/database/prisma');
    const { runtime } = await import('./server/config/runtime');
    const { COMMAND_MENU } = await import('./server/commands/index');

    await connectDatabase();

    const { bot, gameService } = getContainer();

    // A restarted server can't resume in-flight games (timers were lost) — cancel them.
    await gameService.recoverStaleGames();

    const me = await bot.telegram.getMe();
    runtime.botUsername = me.username;
    await bot.telegram.setMyCommands(COMMAND_MENU);

    // Don't await: launch() resolves only when the bot stops.
    void bot.launch().catch((err) => logger.error({ err }, 'bot launch failed'));

    logger.info({ username: me.username }, 'Bingo bot started 🎲 (polling)');
  } catch (err) {
    g.__botStarted = false; // allow a retry on next reload
    logger.error({ err }, 'failed to start bot');
  }
}
