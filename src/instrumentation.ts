// Next.js runs this once when the server process starts (both `next dev` and
// `next start`). It boots the Telegram bot and the continuous Bingo room in the SAME
// process that serves the API routes, so they share in-memory state (timers, mutex).
//
// NOTE: requires a persistent Node server (Docker / Railway / Render / VPS), not
// serverless — the room's timers and the bot's polling must keep running.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const g = globalThis as unknown as { __botStarted?: boolean };
  if (g.__botStarted) return;
  g.__botStarted = true;

  const { logger } = await import('./server/config/logger');
  try {
    const { getContainer } = await import('./server/container');
    const { connectDatabase } = await import('./server/database/prisma');
    const { COMMAND_MENU } = await import('./server/commands/index');

    await connectDatabase();

    const container = getContainer();
    const { bot, room } = container;

    // Seed the 100-card catalog (once), close interrupted rounds, open a fresh one.
    await room.boot();

    const me = await bot.telegram.getMe();
    container.botUsername = me.username;
    await bot.telegram.setMyCommands(COMMAND_MENU);

    void bot.launch().catch((err) => logger.error({ err }, 'bot launch failed'));
    logger.info({ username: me.username }, 'Bingo bot started 🎲 (polling)');
  } catch (err) {
    g.__botStarted = false;
    logger.error({ err }, 'failed to start bot/room');
  }
}
