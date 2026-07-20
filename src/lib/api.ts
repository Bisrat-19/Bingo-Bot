import type { ActionResult, GameSettings, RoomState } from './types';
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
  mark: (number: number) => request<ActionResult>('/room/mark', { number }),
  bingo: () => request<ActionResult>('/room/bingo'),

  // Admin-only (server enforces membership via ADMIN_TELEGRAM_IDS).
  getSettings: () => request<{ ok: boolean; settings: GameSettings; reason?: string }>('/admin/settings'),
  saveSettings: (patch: Partial<GameSettings>) =>
    request<{ ok: boolean; settings: GameSettings; reason?: string }>('/admin/settings', { patch }),
};
