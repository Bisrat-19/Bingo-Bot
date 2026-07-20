import { FREE, WinningPattern, type BingoResult, type Card } from '../types/index';

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

  /** Every completed line on the card, with the numbers that form it. */
  findLines(card: Card, markedNumbers: number[], calledNumbers: number[]): WinLine[] {
    const grid = this.markGrid(card, this.validMarks(markedNumbers, calledNumbers));
    const lines: WinLine[] = [];
    const nums = (cells: [number, number][]) =>
      cells.map(([r, c]) => card[r][c]).filter((n) => n !== FREE);

    for (let r = 0; r < 5; r++) {
      if (grid[r].every(Boolean)) {
        lines.push({
          pattern: WinningPattern.HORIZONTAL,
          numbers: nums([0, 1, 2, 3, 4].map((c) => [r, c] as [number, number])),
        });
      }
    }
    for (let c = 0; c < 5; c++) {
      if (grid.every((row) => row[c])) {
        lines.push({
          pattern: WinningPattern.VERTICAL,
          numbers: nums([0, 1, 2, 3, 4].map((r) => [r, c] as [number, number])),
        });
      }
    }
    if ([0, 1, 2, 3, 4].every((i) => grid[i][i])) {
      lines.push({
        pattern: WinningPattern.DIAGONAL,
        numbers: nums([0, 1, 2, 3, 4].map((i) => [i, i] as [number, number])),
      });
    }
    if ([0, 1, 2, 3, 4].every((i) => grid[i][4 - i])) {
      lines.push({
        pattern: WinningPattern.DIAGONAL,
        numbers: nums([0, 1, 2, 3, 4].map((i) => [i, 4 - i] as [number, number])),
      });
    }
    return lines;
  }

  /** Convenience: is there any completed line at all? */
  validate(card: Card, markedNumbers: number[], calledNumbers: number[]): BingoResult {
    const lines = this.findLines(card, markedNumbers, calledNumbers);
    return lines.length ? { won: true, pattern: lines[0].pattern } : { won: false };
  }
}
