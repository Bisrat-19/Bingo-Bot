import { getContainer } from '@/server/container';
import { mainMenuKeyboard } from '@/server/telegram/menus';
import { jsonSafe, parseBody, resolveUser } from '@/server/webapi';

/**
 * Register the current Telegram user. Identity comes from verified initData, so the
 * client can't register someone else. On success we push the main menu keyboard into
 * the chat so the Register button is replaced immediately.
 */
export async function POST(req: Request) {
  const body = await parseBody(req);
  const user = await resolveUser(body, req).catch(() => null);
  if (!user) return jsonSafe({ ok: false, reason: 'Not authenticated.' }, 401);

  const { room, bot } = getContainer();
  const wasRegistered = user.registered;
  const updated = await room.register(user);

  if (!wasRegistered) {
    // Best effort — never fail the request because a Telegram message didn't send.
    const kb = mainMenuKeyboard(updated.id, updated.telegramId);
    try {
      await bot.telegram.sendMessage(
        Number(updated.telegramId),
        `✅ <b>Registration complete!</b>\n\nWelcome, ${updated.firstName ?? 'player'} — you start with <b>${updated.coins}</b> birr.\n\nTap <b>🎮 Play Game</b> to join the live Bingo room.`,
        { parse_mode: 'HTML', ...(kb ?? {}) },
      );
    } catch {
      /* user may have blocked the bot */
    }
  }

  return jsonSafe({ ok: true, registered: true, coins: updated.coins });
}
