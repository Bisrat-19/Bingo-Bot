import { DEFAULT_PATTERNS, FREE, WinningPattern, type BingoResult, type Card } from '../types/index';

export interface WinLine {
  pattern: WinningPattern;
  /** The non-FREE numbers making up the line — used to highlight the winning pattern
   *  and to enforce the "must claim on the last called number" rule. */
  numbers: number[];
}

/**
 * Validates Bingo patterns SERVER-SIDE only. It never trusts the client: the caller
 * passes the numbers the player marked AND the numbers actually called, so an un-called
 * number can never contribute to a win. The FREE centre always counts.
 */
export class BingoValidator {
  private markGrid(card: Card, validMarks: Set<number>): boolean[][] {
    return card.map((row) => row.map((value) => value === FREE || validMarks.has(value)));
  }

  private validMarks(markedNumbers: number[], calledNumbers: number[]): Set<number> {
    const called = new Set(calledNumbers);
    // Anti-cheat: only marks that were genuinely called are honored.
    return new Set(markedNumbers.filter((n) => called.has(n)));
  }

  /**
   * Every completed pattern on the card, with the numbers that form it.
   * `enabled` lets the admin decide which patterns count as a win.
   */
  findLines(
    card: Card,
    markedNumbers: number[],
    calledNumbers: number[],
    enabled: WinningPattern[] = DEFAULT_PATTERNS,
  ): WinLine[] {
    const grid = this.markGrid(card, this.validMarks(markedNumbers, calledNumbers));
    const lines: WinLine[] = [];
    const on = new Set(enabled);
    const nums = (cells: [number, number][]) =>
      cells.map(([r, c]) => card[r][c]).filter((n) => n !== FREE);
    const all = (cells: [number, number][]) => cells.every(([r, c]) => grid[r][c]);

    if (on.has(WinningPattern.HORIZONTAL)) {
      for (let r = 0; r < 5; r++) {
        const cells = [0, 1, 2, 3, 4].map((c) => [r, c] as [number, number]);
        if (all(cells)) lines.push({ pattern: WinningPattern.HORIZONTAL, numbers: nums(cells) });
      }
    }
    if (on.has(WinningPattern.VERTICAL)) {
      for (let c = 0; c < 5; c++) {
        const cells = [0, 1, 2, 3, 4].map((r) => [r, c] as [number, number]);
        if (all(cells)) lines.push({ pattern: WinningPattern.VERTICAL, numbers: nums(cells) });
      }
    }
    if (on.has(WinningPattern.DIAGONAL)) {
      const main = [0, 1, 2, 3, 4].map((i) => [i, i] as [number, number]);
      const anti = [0, 1, 2, 3, 4].map((i) => [i, 4 - i] as [number, number]);
      if (all(main)) lines.push({ pattern: WinningPattern.DIAGONAL, numbers: nums(main) });
      if (all(anti)) lines.push({ pattern: WinningPattern.DIAGONAL, numbers: nums(anti) });
    }
    if (on.has(WinningPattern.FOUR_CORNERS)) {
      const corners: [number, number][] = [
        [0, 0],
        [0, 4],
        [4, 0],
        [4, 4],
      ];
      if (all(corners)) lines.push({ pattern: WinningPattern.FOUR_CORNERS, numbers: nums(corners) });
    }
    if (on.has(WinningPattern.FULL_HOUSE)) {
      const every: [number, number][] = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) every.push([r, c]);
      if (all(every)) lines.push({ pattern: WinningPattern.FULL_HOUSE, numbers: nums(every) });
    }
    return lines;
  }

  /** Convenience: is there any completed pattern at all? */
  validate(
    card: Card,
    markedNumbers: number[],
    calledNumbers: number[],
    enabled: WinningPattern[] = DEFAULT_PATTERNS,
  ): BingoResult {
    const lines = this.findLines(card, markedNumbers, calledNumbers, enabled);
    return lines.length ? { won: true, pattern: lines[0].pattern } : { won: false };
  }
}
