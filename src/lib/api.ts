import type { ActionResult, WebState } from './types';
import { getDevUser, getGameId, getInitData } from './telegram';

// All requests carry the raw initData (server-side HMAC auth) + gameId. The dev fallback
// only works when the backend runs in development.
function body(extra?: Record<string, unknown>): string {
  return JSON.stringify({
    gameId: getGameId(),
    initData: getInitData(),
    devUser: getDevUser(),
    ...extra,
  });
}

async function post<T>(path: string, extra?: Record<string, unknown>): Promise<T | { error: string }> {
  try {
    const res = await fetch('/api' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body(extra),
    });
    return (await res.json()) as T;
  } catch {
    return { error: 'network' };
  }
}

export const api = {
  state: () => post<WebState>('/state'),
  join: () => post<ActionResult>('/join'),
  start: () => post<ActionResult>('/start'),
  mark: (number: number) => post<ActionResult>('/mark', { number }),
  bingo: () => post<ActionResult>('/bingo'),
  leave: () => post<ActionResult>('/leave'),
};
