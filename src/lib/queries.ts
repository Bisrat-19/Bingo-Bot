'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { GameHistory, PlayerSummary } from './types';

/** Query keys, kept in one place so invalidation and reads never drift apart. */
export const QK = {
  summary: ['summary'] as const,
  history: ['history'] as const,
  catalog: ['catalog'] as const,
};

/**
 * The fixed 100-card catalog as a Map(cardNumber -> 5x5 numbers). It never changes, so
 * it is fetched once and kept forever — previews are then instant lookups.
 */
export function useCatalog() {
  return useQuery({
    queryKey: QK.catalog,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<Map<number, number[][]>> => {
      const res = await api.catalog();
      if ('error' in res || !res.ok) throw new Error('Could not load cards');
      return new Map(res.cards.map((c) => [c.number, c.card]));
    },
  });
}

/** Wallet + Profile data (balances, stats, ledger). Cached until invalidated. */
export function useSummary() {
  return useQuery({
    queryKey: QK.summary,
    queryFn: async (): Promise<PlayerSummary> => {
      const res = await api.summary();
      if ('error' in res || !res.ok) throw new Error('Could not load wallet');
      return res;
    },
  });
}

/** The player's finished rounds. Cached until invalidated. */
export function useHistory() {
  return useQuery({
    queryKey: QK.history,
    queryFn: async (): Promise<GameHistory[]> => {
      const res = await api.history(20);
      if ('error' in res || !res.ok) throw new Error('Could not load history');
      return res.games;
    },
  });
}

/**
 * Drop cached screen data so the next view refetches. Call this after anything that
 * changes money or ends a round: staking a card, winning, a deposit landing, etc.
 */
export function useInvalidatePlayerData() {
  const qc = useQueryClient();
  return (which: 'summary' | 'history' | 'all' = 'all') => {
    if (which === 'summary' || which === 'all') void qc.invalidateQueries({ queryKey: QK.summary });
    if (which === 'history' || which === 'all') void qc.invalidateQueries({ queryKey: QK.history });
  };
}
