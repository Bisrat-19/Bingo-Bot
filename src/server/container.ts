import { Markup, Telegraf } from 'telegraf';
import { registerHandlers } from './commands/index';
import { config } from './config/env';
import { logger } from './config/logger';
import { prisma } from './database/prisma';
import { BingoValidator } from './game/BingoValidator';
import { CardGenerator } from './game/CardGenerator';
import { NumberCaller } from './game/NumberCaller';
import { TimerService } from './game/TimerService';
import { makeErrorHandler } from './middlewares/error';
import { CatalogRepository } from './repositories/catalog.repository';
import { RoundRepository } from './repositories/round.repository';
import { StatisticsRepository } from './repositories/statistics.repository';
import { UserRepository } from './repositories/user.repository';
import { WinnerRepository } from './repositories/winner.repository';
import { RoomService } from './services/RoomService';
import { SettingsService } from './services/SettingsService';
import { WalletService } from './services/WalletService';
import { StatisticsService } from './services/StatisticsService';
import { KeyedMutex } from './utils/Mutex';

// Manual dependency-injection container. Composition happens exactly once, here.
export interface AppContainer {
  bot: Telegraf;
  room: RoomService;
  stats: StatisticsService;
  settings: SettingsService;
  wallet: WalletService;
  timers: TimerService;
  /** Set after getMe() during boot; used to build group deep links. */
  botUsername?: string;
}

export function buildContainer(): AppContainer {
  const bot = new Telegraf(config.BOT_TOKEN);

  const userRepo = new UserRepository(prisma);
  const roundRepo = new RoundRepository(prisma);
  const catalogRepo = new CatalogRepository(prisma);
  const winnerRepo = new WinnerRepository(prisma);
  const statsRepo = new StatisticsRepository(prisma);

  const mutex = new KeyedMutex();
  const timers = new TimerService();
  const cardGen = new CardGenerator();
  const validator = new BingoValidator();
  const caller = new NumberCaller();

  const stats = new StatisticsService(statsRepo);
  const settings = new SettingsService(prisma);
  const wallet = new WalletService(prisma, logger);
  const room = new RoomService(
    userRepo,
    roundRepo,
    catalogRepo,
    winnerRepo,
    stats,
    cardGen,
    validator,
    caller,
    timers,
    mutex,
    settings,
    wallet,
    logger,
  );

  const container: AppContainer = { bot, room, stats, settings, wallet, timers };

  bot.catch(makeErrorHandler(logger));

  /**
   * Ping every configured admin with the request details (and the receipt photo) plus
   * inline Approve/Reject buttons, so payouts can be handled today. The same actions are
   * exposed as API endpoints for the future admin dashboard.
   */
  const notifyAdmins = async (txId: string): Promise<void> => {
    const tx = await wallet.byId(txId);
    if (!tx) return;
    const who = tx.user.username ? `@${tx.user.username}` : (tx.user.firstName ?? 'player');
    const caption =
      `🔐 <b>ADMIN REVIEW</b>\n` +
      `${tx.type === 'DEPOSIT' ? '💰 <b>Deposit</b>' : '💸 <b>Withdrawal</b>'} request\n\n` +
      `From: ${who} (<code>${tx.user.telegramId}</code>)\n` +
      `Name: <b>${tx.fullName}</b>\n` +
      `Phone: <code>${tx.phone}</code>\n` +
      `Amount: <b>${tx.amount}</b> birr\n` +
      `Ref: <code>${tx.id.slice(-8)}</code>`;
    const kb = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Approve', `tx:approve:${tx.id}`),
        Markup.button.callback('❌ Reject', `tx:reject:${tx.id}`),
      ],
    ]);

    // Prefer a dedicated admin chat; otherwise fall back to DMing each admin.
    const targets = config.ADMIN_CHAT_ID ? [config.ADMIN_CHAT_ID] : config.ADMIN_TELEGRAM_IDS;
    for (const adminId of targets) {
      try {
        if (tx.receiptFileId) {
          await bot.telegram.sendPhoto(adminId, tx.receiptFileId, {
            caption,
            parse_mode: 'HTML',
            ...kb,
          });
        } else {
          await bot.telegram.sendMessage(adminId, caption, { parse_mode: 'HTML', ...kb });
        }
      } catch (err) {
        logger.warn({ err, adminId }, 'could not notify admin');
      }
    }
  };

  registerHandlers(bot, room, stats, wallet, settings, notifyAdmins, () => container.botUsername);

  // Admin approve/reject straight from the notification.
  bot.action(/^tx:(approve|reject):(.+)$/, async (ctx) => {
    const from = String(ctx.from?.id ?? '');
    if (!config.ADMIN_TELEGRAM_IDS.includes(from)) {
      await ctx.answerCbQuery('Admins only.', { show_alert: true });
      return;
    }
    const [, action, txId] = ctx.match as unknown as RegExpExecArray;
    const res =
      action === 'approve' ? await wallet.approve(txId, from) : await wallet.reject(txId, from);

    if (!res.ok) {
      await ctx.answerCbQuery(res.reason, { show_alert: true });
      return;
    }
    await ctx.answerCbQuery(action === 'approve' ? '✅ Approved' : '❌ Rejected');

    const tx = res.tx;
    const amount = tx.approvedAmount ?? tx.amount;
    const msg =
      action === 'approve'
        ? tx.type === 'DEPOSIT'
          ? `✅ <b>Deposit approved</b>\n\n+<b>${amount}</b> coins added.\nNew balance: <b>${res.balance}</b>`
          : `✅ <b>Withdrawal sent</b>\n\n<b>${amount}</b> birr sent to <code>${tx.phone}</code>.\nBalance: <b>${res.balance}</b>`
        : tx.type === 'DEPOSIT'
          ? `❌ <b>Deposit rejected</b>\n\nRef <code>${tx.id.slice(-8)}</code>. Contact support if this is a mistake.`
          : `❌ <b>Withdrawal rejected</b>\n\nYour <b>${tx.amount}</b> coins have been returned.\nBalance: <b>${res.balance}</b>`;

    const target = await prisma.user.findUnique({ where: { id: tx.userId } });
    if (target) {
      try {
        await bot.telegram.sendMessage(Number(target.telegramId), msg, { parse_mode: 'HTML' });
      } catch (err) {
        logger.warn({ err }, 'could not notify user of review');
      }
    }
  });

  return container;
}

// Cached singleton so API route handlers and the bot/room timers (started in
// instrumentation) share the SAME in-memory state. Cached on globalThis to survive HMR.
const globalForContainer = globalThis as unknown as { __container?: AppContainer };

export function getContainer(): AppContainer {
  if (!globalForContainer.__container) {
    globalForContainer.__container = buildContainer();
  }
  return globalForContainer.__container;
}
