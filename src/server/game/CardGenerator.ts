import { COLUMNS, FREE, type Card } from '../types/index';

// Column ranges for 75-ball Bingo, indexed by column position 0..4.
const COLUMN_RANGES: [number, number][] = [
  [1, 15], // B
  [16, 30], // I
  [31, 45], // N
  [46, 60], // G
  [61, 75], // O
];

/**
 * Generates unique 5x5 Bingo cards. Each column draws 5 distinct numbers from its
 * own range, so a card can never contain duplicates, and the center is FREE.
 */
export class CardGenerator {
  /** Fisher–Yates over [lo, hi], returning the first `count` values. */
  private sample(lo: number, hi: number, count: number): number[] {
    const pool: number[] = [];
    for (let i = lo; i <= hi; i++) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }

  generate(): Card {
    const card: Card = Array.from({ length: 5 }, () => new Array<number>(5).fill(0));
    for (let c = 0; c < COLUMNS.length; c++) {
      const [lo, hi] = COLUMN_RANGES[c];
      const nums = this.sample(lo, hi, 5);
      for (let r = 0; r < 5; r++) card[r][c] = nums[r];
    }
    card[2][2] = FREE; // center free space
    return card;
  }

  /** The full list of numbers on a card (excluding the FREE center). */
  static numbersOf(card: Card): number[] {
    const out: number[] = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (card[r][c] !== FREE) out.push(card[r][c]);
      }
    }
    return out;
  }
}
