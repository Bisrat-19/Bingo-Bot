import { FREE, WinningPattern, type BingoResult, type Card } from '../types/index';

/**
 * Validates Bingo patterns SERVER-SIDE only. It never trusts the client: the caller
 * passes the set of numbers the player marked AND that were actually called, so an
 * un-called number can never contribute to a win. The FREE center always counts.
 */
export class BingoValidator {
  /** Build the 5x5 boolean "is this cell marked" grid from the card + valid marks. */
  private markGrid(card: Card, validMarks: Set<number>): boolean[][] {
    return card.map((row) =>
      row.map((value) => value === FREE || validMarks.has(value)),
    );
  }

  private anyRow(m: boolean[][]): boolean {
    return m.some((row) => row.every(Boolean));
  }

  private anyCol(m: boolean[][]): boolean {
    for (let c = 0; c < 5; c++) if (m.every((row) => row[c])) return true;
    return false;
  }

  private anyDiagonal(m: boolean[][]): boolean {
    const main = [0, 1, 2, 3, 4].every((i) => m[i][i]);
    const anti = [0, 1, 2, 3, 4].every((i) => m[i][4 - i]);
    return main || anti;
  }

  /**
   * @param card         the player's 5x5 card
   * @param markedNumbers numbers the player daubed
   * @param calledNumbers numbers actually called by the server
   * @param enabled       which patterns count as a win (defaults to all three lines)
   */
  validate(
    card: Card,
    markedNumbers: number[],
    calledNumbers: number[],
    enabled: WinningPattern[] = [
      WinningPattern.HORIZONTAL,
      WinningPattern.VERTICAL,
      WinningPattern.DIAGONAL,
    ],
  ): BingoResult {
    const calledSet = new Set(calledNumbers);
    // Anti-cheat: only marks that were genuinely called are honored.
    const validMarks = new Set(markedNumbers.filter((n) => calledSet.has(n)));
    const grid = this.markGrid(card, validMarks);

    if (enabled.includes(WinningPattern.HORIZONTAL) && this.anyRow(grid)) {
      return { won: true, pattern: WinningPattern.HORIZONTAL };
    }
    if (enabled.includes(WinningPattern.VERTICAL) && this.anyCol(grid)) {
      return { won: true, pattern: WinningPattern.VERTICAL };
    }
    if (enabled.includes(WinningPattern.DIAGONAL) && this.anyDiagonal(grid)) {
      return { won: true, pattern: WinningPattern.DIAGONAL };
    }
    return { won: false };
  }
}
