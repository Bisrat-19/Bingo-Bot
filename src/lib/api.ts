import type { ActionResult, GameHistory, GameSettings, PlayerSummary, RoomState } from './types';
import { getDevUser } from './telegram';
import { clearSession, getToken, login } from './session';

/**
 * All calls carry our session JWT. If the server ever rejects it (expired/rotated),
 * we transparently re-login with initData once and retry — so the player never sees
 * an auth error mid-game.
 */
async function request<T>(
  path: string,
  extra?: Record<string, unknown>,
  retry = true,
): Promise<T | { error: string }> {
  const token = getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  try {
    const res = await fetch('/api' + path, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ devUser: getDevUser(), ...extra }),
    });

    if (res.status === 401 && retry) {
      clearSession();
      if (await login()) return request<T>(path, extra, false);
    }
    return (await res.json()) as T;
  } catch {
    return { error: 'network' };
  }
}

export const api = {
  state: () => request<RoomState>('/room/state'),
  select: (cardNumber: number) => request<ActionResult>('/room/select', { cardNumber }),
  /** Release one card, or every card when no number is given. */
  deselect: (cardNumber?: number) => request<ActionResult>('/room/deselect', { cardNumber }),
  /** One number, or a whole list (used when AUTO hands over to MANUAL). */
  mark: (number: number, cardNumber?: number, numbers?: number[]) =>
    request<ActionResult>('/room/mark', numbers ? { numbers, cardNumber } : { number, cardNumber }),
  summary: () => request<PlayerSummary>('/player/summary'),
  history: (take = 20) => request<{ ok: boolean; games: GameHistory[] }>('/player/history', { take }),
  bingo: () => request<ActionResult>('/room/bingo'),

  // Admin-only (server enforces membership via ADMIN_TELEGRAM_IDS).
  getSettings: () => request<{ ok: boolean; settings: GameSettings; reason?: string }>('/admin/settings'),
  saveSettings: (patch: Partial<GameSettings>) =>
    request<{ ok: boolean; settings: GameSettings; reason?: string }>('/admin/settings', { patch }),
};
