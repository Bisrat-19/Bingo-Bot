import { MAX_NUMBER } from '../types/index';

/**
 * Draws unique random numbers for a game. Stateless with respect to storage — the
 * caller supplies which numbers were already called, and we return the next one.
 */
export class NumberCaller {
  /** Return a random uncalled number in [1, MAX_NUMBER], or null if the pool is empty. */
  drawNext(alreadyCalled: number[]): number | null {
    const called = new Set(alreadyCalled);
    if (called.size >= MAX_NUMBER) return null;

    const remaining: number[] = [];
    for (let n = 1; n <= MAX_NUMBER; n++) if (!called.has(n)) remaining.push(n);

    const idx = Math.floor(Math.random() * remaining.length);
    return remaining[idx];
  }
}
