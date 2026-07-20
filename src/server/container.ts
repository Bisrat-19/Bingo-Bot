import { Telegraf } from 'telegraf';
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
import { StatisticsService } from './services/StatisticsService';
import { KeyedMutex } from './utils/Mutex';

// Manual dependency-injection container. Composition happens exactly once, here.
export interface AppContainer {
  bot: Telegraf;
  room: RoomService;
  stats: StatisticsService;
  settings: SettingsService;
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
    logger,
  );

  const container: AppContainer = { bot, room, stats, settings, timers };

  bot.catch(makeErrorHandler(logger));
  registerHandlers(bot, room, stats, () => container.botUsername);

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
