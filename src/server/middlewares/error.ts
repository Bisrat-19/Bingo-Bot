import type { Context } from 'telegraf';
import type { Logger } from '../config/logger';

// Central error boundary. Registered via bot.catch — keeps one bad update from
// crashing the process, and never leaks stack traces to users.
export function makeErrorHandler(logger: Logger) {
  return async (err: unknown, ctx: Context): Promise<void> => {
    logger.error({ err, updateType: ctx.updateType }, 'unhandled bot error');
    try {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Something went wrong. Try again.');
      else if (ctx.chat) await ctx.reply('⚠️ Something went wrong. Please try again.');
    } catch {
      // ignore secondary failures
    }
  };
}
