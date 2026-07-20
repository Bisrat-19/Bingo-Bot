import { getInitData } from './telegram';

/**
 * Session handling for the Mini App.
 *
 * Telegram's `initData` is exchanged ONCE for our own JWT (`/api/auth/login`); every
 * later request sends that JWT. This is the standard production pattern: it avoids
 * re-verifying the HMAC on every call and keeps the session alive even if the Telegram
 * payload is no longer readable (e.g. after an in-app navigation drops the URL hash).
 */

const KEY = 'bingo_session';
const LAUNCH_KEY = 'bingo_launch';
let memoryToken: string | null = null;

/**
 * The bot embeds a short-lived launch token in the Mini App URL (?tk=…). Some Telegram
 * clients open the app as a plain link with no initData, so this is the reliable path.
 * Cached because the query string can be lost on later navigations.
 */
function getLaunchToken(): string {
  try {
    const fromUrl = new URLSearchParams(location.search).get('tk');
    if (fromUrl) {
      sessionStorage.setItem(LAUNCH_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(LAUNCH_KEY) ?? '';
  } catch {
    return '';
  }
}

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = localStorage.getItem(KEY);
  } catch {
    /* storage blocked */
  }
  return memoryToken;
}

function setToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked — memory only */
  }
}

export function clearSession(): void {
  setToken(null);
}

let loginInFlight: Promise<boolean> | null = null;

/** Exchange initData for a session JWT. Concurrent calls share one request. */
export function login(): Promise<boolean> {
  if (loginInFlight) return loginInFlight;

  loginInFlight = (async () => {
    const initData = getInitData();
    const launchToken = getLaunchToken();
    if (!initData && !launchToken) return false; // opened outside Telegram

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ initData, launchToken }),
      });
      const data = (await res.json()) as { ok?: boolean; token?: string };
      if (data.ok && data.token) {
        setToken(data.token);
        return true;
      }
    } catch {
      /* network */
    }
    return false;
  })().finally(() => {
    loginInFlight = null;
  });

  return loginInFlight;
}

/** Ensure we have a session before the first API call. */
export async function ensureSession(): Promise<boolean> {
  if (getToken()) return true;
  return login();
}
