// Mirrors the RoomState DTO returned by /api/room/state.
export type RoomPhase = 'SELECTING' | 'PLAYING' | 'FINISHED';

export interface RoomState {
  roundId: string;
  phase: RoomPhase;
  /** Selection countdown; null until the first player picks a card. */
  secondsLeft: number | null;
  poolSize: number;
  takenCards: number[];
  /** Every card this player holds this round, in the order they took them. */
  myCards: { cardNumber: number; card: number[][]; marked: number[]; hasBingo: boolean }[];
  /** How many cards one player may hold (admin configurable). */
  maxCards: number;
  /** Distinct players in the round. */
  playersCount: number;
  /** Total cards in play, which is what the pot is built from. */
  cardsCount: number;
  called: number[];
  currentNumber: number | null;
  hasBingo: boolean;
  registered: boolean;
  coins: number | null;
  entryFee: number;
  pot: number;
  winAmount: number;
  isAdmin: boolean;
  winner: {
    name: string;
    cardNumber: number;
    prize: number;
    pattern: string | null;
    /** Numbers forming the winning line — highlighted on the winner's card. */
    line: number[];
    card: number[][] | null;
  } | null;
  nextRoundInSec: number | null;
}

export interface GameSettings {
  selectionSeconds: number;
  drawIntervalSeconds: number;
  winnerDisplaySeconds: number;
  minPlayers: number;
  startingCoins: number;
  entryFee: number;
  falseBingoCooldownSec: number;
  patterns: string[];
  maxCardsPerPlayer: number;
}

export const ALL_PATTERNS = [
  { key: 'HORIZONTAL', label: 'Horizontal line' },
  { key: 'VERTICAL', label: 'Vertical line' },
  { key: 'DIAGONAL', label: 'Diagonal' },
  { key: 'FOUR_CORNERS', label: 'Four corners' },
  { key: 'FULL_HOUSE', label: 'Full house' },
];

export interface ActionResult {
  ok: boolean;
  reason?: string;
  retryAfterSec?: number;
  pattern?: string;
  cardNumber?: number;
  number?: number;
}
