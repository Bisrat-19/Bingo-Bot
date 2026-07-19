// Mirrors the WebState DTO returned by the backend /api/state endpoint.
export type GameStatus =
  | 'WAITING_FOR_PLAYERS'
  | 'CARD_GENERATED'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'FINISHED'
  | 'CANCELLED';

export interface PlayerView {
  name: string;
  marks: number;
  hasBingo: boolean;
  isWinner: boolean;
}

export interface WebState {
  gameId: string;
  status: GameStatus;
  currentNumber: number | null;
  called: number[];
  countdownLeft: number | null;
  minPlayers: number;
  isHost: boolean;
  joined: boolean;
  card: number[][] | null; // 5x5, 0 = FREE
  marked: number[];
  hasBingo: boolean;
  players: PlayerView[];
  winner: { name: string } | null;
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
  retryAfterSec?: number;
  pattern?: string;
}
