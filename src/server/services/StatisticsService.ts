import type { StatisticsRepository, LeaderboardRow } from '../repositories/statistics.repository';

// Thin service over the statistics repository. Kept separate so game logic doesn't
// depend on how stats are stored, and so it can be swapped/extended (e.g. Redis counters).
export class StatisticsService {
  constructor(private readonly repo: StatisticsRepository) {}

  recordGamePlayed(userIds: string[]): Promise<void> {
    return this.repo.incrementGamesPlayed(userIds);
  }

  recordWin(userId: string): Promise<void> {
    return this.repo.incrementGamesWon(userId);
  }

  recordBingoCalled(userId: string): Promise<void> {
    return this.repo.incrementBingosCalled(userId);
  }

  recordFalseBingo(userId: string): Promise<void> {
    return this.repo.incrementFalseBingos(userId);
  }

  leaderboard(limit = 10): Promise<LeaderboardRow[]> {
    return this.repo.leaderboard(limit);
  }

  forUser(userId: string) {
    return this.repo.getByUser(userId);
  }
}
