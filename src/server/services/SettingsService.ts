import type { PrismaClient, Settings } from '@prisma/client';

export interface EditableSettings {
  selectionSeconds: number;
  drawIntervalSeconds: number;
  winnerDisplaySeconds: number;
  minPlayers: number;
  startingCoins: number;
  entryFee: number;
  falseBingoCooldownSec: number;
  /** Which patterns count as a win. */
  patterns: string[];
}

export const VALID_PATTERNS = [
  'HORIZONTAL',
  'VERTICAL',
  'DIAGONAL',
  'FOUR_CORNERS',
  'FULL_HOUSE',
] as const;

// Bounds so an admin can't set something that breaks the game.
const LIMITS: Record<keyof EditableSettings, [number, number]> = {
  selectionSeconds: [5, 600],
  drawIntervalSeconds: [2, 120],
  winnerDisplaySeconds: [2, 120],
  minPlayers: [1, 100],
  startingCoins: [0, 1_000_000],
  entryFee: [0, 1_000_000],
  falseBingoCooldownSec: [0, 300],
  patterns: [0, 0], // handled separately (not numeric)
};

/**
 * Runtime game configuration, stored in a single DB row so admins can change it live.
 * Cached briefly to keep the ~1s polling cheap.
 */
export class SettingsService {
  private cache: Settings | null = null;
  private cachedAt = 0;
  private readonly ttlMs = 3000;

  constructor(private readonly prisma: PrismaClient) {}

  async get(): Promise<Settings> {
    const now = Date.now();
    if (this.cache && now - this.cachedAt < this.ttlMs) return this.cache;
    const row = await this.prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
    this.cache = row;
    this.cachedAt = now;
    return row;
  }

  /** Apply a partial update, clamped to safe bounds. Returns the new settings. */
  async update(patch: Partial<EditableSettings>): Promise<Settings> {
    const data: Record<string, number | string[]> = {};
    for (const [key, [min, max]] of Object.entries(LIMITS) as [
      keyof EditableSettings,
      [number, number],
    ][]) {
      if (key === 'patterns') continue; // not numeric
      const value = patch[key];
      if (value === undefined || value === null) continue;
      const n = Math.round(Number(value));
      if (!Number.isFinite(n)) continue;
      data[key] = Math.min(max, Math.max(min, n));
    }

    // Patterns: keep only known values; never allow an empty set (nobody could win).
    if (Array.isArray(patch.patterns)) {
      const cleaned = [...new Set(patch.patterns)].filter((p) =>
        (VALID_PATTERNS as readonly string[]).includes(p),
      );
      if (cleaned.length > 0) data.patterns = cleaned;
    }
    const row = await this.prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, ...data },
      update: data,
    });
    this.cache = row;
    this.cachedAt = Date.now();
    return row;
  }

  /** Drop the cache so the next read is fresh. */
  invalidate(): void {
    this.cache = null;
  }
}
