import type { ActionResult, RoomState } from './types';
import { getDevUser, getInitData } from './telegram';

// Every request carries the raw initData (server-side HMAC auth). The dev fallback only
// works when the backend runs in development.
function body(extra?: Record<string, unknown>): string {
  return JSON.stringify({
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
  state: () => post<RoomState>('/room/state'),
  select: (cardNumber: number) => post<ActionResult>('/room/select', { cardNumber }),
  mark: (number: number) => post<ActionResult>('/room/mark', { number }),
  bingo: () => post<ActionResult>('/room/bingo'),
};
