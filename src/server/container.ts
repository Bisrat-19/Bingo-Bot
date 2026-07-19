import { Telegraf } from 'telegraf';
import { config } from './config/env';
import { logger } from './config/logger';
import { registerHandlers } from './commands/index';
import { GameController } from './controllers/GameController';
import { prisma } from './database/prisma';
import { BingoValidator } from './game/BingoValidator';
import { CardGenerator } from './game/CardGenerator';
import { GameEngine } from './game/GameEngine';
import { NumberCaller } from './game/NumberCaller';
import { TimerService } from './game/TimerService';
import { makeErrorHandler } from './middlewares/error';
import { CalledNumberRepository } from './repositories/calledNumber.repository';
import { GameRepository } from './repositories/game.repository';
import { PlayerRepository } from './repositories/player.repository';
import { StatisticsRepository } from './repositories/statistics.repository';
import { UserRepository } from './repositories/user.repository';
import { WinnerRepository } from './repositories/winner.repository';
import { GameService } from './services/GameService';
import { NotificationService } from './services/NotificationService';
import { StatisticsService } from './services/StatisticsService';
import { KeyedMutex } from './utils/Mutex';

// Manual dependency-injection container. Composition happens exactly once, here.
// Everything downstream receives its collaborators via the constructor (testable, SOLID).
export interface AppContainer {
  bot: Telegraf;
  gameService: GameService;
  timers: TimerService;
}

export function buildContainer(): AppContainer {
  const bot = new Telegraf(config.BOT_TOKEN);

  // Repositories
  const userRepo = new UserRepository(prisma);
  const gameRepo = new GameRepository(prisma);
  const playerRepo = new PlayerRepository(prisma);
  const calledRepo = new CalledNumberRepository(prisma);
  const winnerRepo = new WinnerRepository(prisma);
  const statsRepo = new StatisticsRepository(prisma);

  // Cross-cutting
  const mutex = new KeyedMutex();
  const timers = new TimerService();

  // Domain / engine
  const cardGen = new CardGenerator();
  const validator = new BingoValidator();
  const caller = new NumberCaller();

  // Services
  const statsService = new StatisticsService(statsRepo);
  const notifier = new NotificationService(bot, logger);
  const engine = new GameEngine(
    gameRepo,
    playerRepo,
    calledRepo,
    statsService,
    notifier,
    caller,
    timers,
    logger,
  );
  const gameService = new GameService(
    userRepo,
    gameRepo,
    playerRepo,
    calledRepo,
    winnerRepo,
    statsService,
    notifier,
    engine,
    cardGen,
    validator,
    mutex,
    logger,
  );

  // Telegram wiring
  const controller = new GameController(gameService, statsService, notifier);
  bot.catch(makeErrorHandler(logger));
  registerHandlers(bot, controller);

  return { bot, gameService, timers };
}

// Cached singleton so every API route handler and the bot (started in instrumentation)
// share the SAME in-memory state (mutex, timers, board/countdown maps). Cached on
// globalThis to survive Next.js HMR in development.
const globalForContainer = globalThis as unknown as { __container?: AppContainer };

export function getContainer(): AppContainer {
  if (!globalForContainer.__container) {
    globalForContainer.__container = buildContainer();
  }
  return globalForContainer.__container;
}
