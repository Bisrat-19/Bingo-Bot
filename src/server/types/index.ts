// Shared domain types. GameStatus mirrors the Prisma enum so we don't couple every
// module to the generated client.

export enum GameStatus {
  WAITING_FOR_PLAYERS = 'WAITING_FOR_PLAYERS',
  CARD_GENERATED = 'CARD_GENERATED',
  COUNTDOWN = 'COUNTDOWN',
  PLAYING = 'PLAYING',
  FINISHED = 'FINISHED',
  CANCELLED = 'CANCELLED',
}

export enum WinningPattern {
  HORIZONTAL = 'HORIZONTAL', // any straight row
  VERTICAL = 'VERTICAL', // any straight column
  DIAGONAL = 'DIAGONAL', // either diagonal
  FOUR_CORNERS = 'FOUR_CORNERS', // the four corner cells
  FULL_HOUSE = 'FULL_HOUSE', // the whole card
}

/** Patterns enabled by default (admin can change these live). */
export const DEFAULT_PATTERNS = [
  WinningPattern.HORIZONTAL,
  WinningPattern.VERTICAL,
  WinningPattern.DIAGONAL,
];

// A Bingo card is a 5x5 matrix of numbers; the center (2,2) holds FREE (0).
export type Card = number[][];

export const FREE = 0;
export const CARD_SIZE = 5;
export const MAX_NUMBER = 75;

// Column ranges for 75-ball Bingo: B=1-15, I=16-30, N=31-45, G=46-60, O=61-75.
export const COLUMNS = ['B', 'I', 'N', 'G', 'O'] as const;

export interface BingoResult {
  won: boolean;
  pattern?: WinningPattern;
}

// Minimal Telegram-user shape passed around the app.
export interface TgUser {
  telegramId: bigint;
  username?: string;
  firstName?: string;
}
