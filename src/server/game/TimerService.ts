// Tracks all active timers per game so they can be cleared on finish/cancel/shutdown.
// Keeping this centralized prevents "zombie" intervals firing after a game ends.

type TimerHandle = ReturnType<typeof setTimeout>;

export class TimerService {
  private intervals = new Map<string, TimerHandle>();
  private timeouts = new Map<string, TimerHandle>();

  setInterval(gameId: string, fn: () => void, ms: number): void {
    this.clearInterval(gameId);
    this.intervals.set(gameId, setInterval(fn, ms));
  }

  setTimeout(gameId: string, fn: () => void, ms: number): void {
    this.clearTimeout(gameId);
    this.timeouts.set(
      gameId,
      setTimeout(() => {
        this.timeouts.delete(gameId);
        fn();
      }, ms),
    );
  }

  clearInterval(gameId: string): void {
    const h = this.intervals.get(gameId);
    if (h) {
      clearInterval(h);
      this.intervals.delete(gameId);
    }
  }

  clearTimeout(gameId: string): void {
    const h = this.timeouts.get(gameId);
    if (h) {
      clearTimeout(h);
      this.timeouts.delete(gameId);
    }
  }

  clearAll(gameId: string): void {
    this.clearInterval(gameId);
    this.clearTimeout(gameId);
  }

  shutdown(): void {
    for (const h of this.intervals.values()) clearInterval(h);
    for (const h of this.timeouts.values()) clearTimeout(h);
    this.intervals.clear();
    this.timeouts.clear();
  }
}
