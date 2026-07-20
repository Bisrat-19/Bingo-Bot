// Mirrors the RoomState DTO returned by /api/room/state.
export type RoomPhase = 'SELECTING' | 'PLAYING' | 'FINISHED';

export interface RoomState {
  roundId: string;
  phase: RoomPhase;
  /** Selection countdown; null until the first player picks a card. */
  secondsLeft: number | null;
  poolSize: number;
  takenCards: number[];
  myCardNumber: number | null;
  playersCount: number;
  called: number[];
  currentNumber: number | null;
  card: number[][] | null; // 5x5, 0 = FREE
  marked: number[];
  hasBingo: boolean;
  winner: {
    name: string;
    cardNumber: number;
    pattern: string | null;
    /** Numbers forming the winning line — highlighted on the winner's card. */
    line: number[];
    card: number[][] | null;
  } | null;
  nextRoundInSec: number | null;
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
  retryAfterSec?: number;
  pattern?: string;
  cardNumber?: number;
  number?: number;
}
