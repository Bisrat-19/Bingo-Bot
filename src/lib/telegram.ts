// Thin, typed wrapper around the Telegram WebApp runtime. We read the raw `initData`
// (needed for backend HMAC auth) and the launch `start_param` (the gameId for group
// deep links), and expose theme/haptics/viewport helpers. Using the injected global is
// the most robust approach and coexists with @telegram-apps/sdk.

interface TgWebApp {
  initData: string;
  initDataUnsafe?: {
    start_param?: string;
    user?: { first_name?: string; last_name?: string; username?: string };
  };
  themeParams?: Record<string, string>;
  colorScheme?: 'light' | 'dark';
  viewportStableHeight?: number;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  onEvent?: (event: string, cb: () => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: string) => void;
    notificationOccurred: (type: string) => void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

const wa = (): TgWebApp | undefined => window.Telegram?.WebApp;

export function initTelegram(): void {
  const app = wa();
  if (!app) return;
  try {
    app.ready();
    app.expand();
  } catch {
    /* ignore */
  }
}

/**
 * Telegram also passes the launch payload in the URL fragment
 * (`#tgWebAppData=<urlencoded initData>`). Reading it is more reliable than depending
 * on telegram-web-app.js having loaded and populated the global.
 */
function initDataFromHash(): string {
  try {
    const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    if (!raw) return '';
    return new URLSearchParams(raw).get('tgWebAppData') ?? '';
  } catch {
    return '';
  }
}

/**
 * The Telegram payload, from the most reliable source available:
 *   1. the injected global (telegram-web-app.js)
 *   2. the launch URL fragment (#tgWebAppData=…)
 *   3. sessionStorage — the fragment is only present on the FIRST load, so we cache it
 * Cached on first sight so later reads still work after navigation/hydration.
 */
export function getInitData(): string {
  const live = wa()?.initData || initDataFromHash();
  if (live) {
    try {
      sessionStorage.setItem('tg_init_data', live);
    } catch {
      /* storage blocked */
    }
    return live;
  }
  try {
    return sessionStorage.getItem('tg_init_data') ?? '';
  } catch {
    return '';
  }
}

/** Diagnostics for troubleshooting the Telegram handshake. */
export function authDebug(): string {
  const hasGlobal = Boolean(window.Telegram?.WebApp);
  const fromGlobal = wa()?.initData?.length ?? 0;
  let fromHash = 0;
  try {
    const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    fromHash = new URLSearchParams(raw).get('tgWebAppData')?.length ?? 0;
  } catch { /* ignore */ }
  return `tg=${hasGlobal ? 'yes' : 'no'} global=${fromGlobal} hash=${fromHash}`;
}

/** True when we have no Telegram auth payload at all (opened outside Telegram). */
export function hasTelegramAuth(): boolean {
  return getInitData().length > 0;
}

// Dev-only fallback so the UI can be exercised in a plain browser (?devUser=123).
export function getDevUser(): string | undefined {
  return new URLSearchParams(location.search).get('devUser') ?? undefined;
}

/** Name/username from the Telegram launch payload (display only — the server
 *  independently verifies identity from initData). */
export function getTgProfile(): { name: string; username: string | null } {
  let u = wa()?.initDataUnsafe?.user;
  if (!u) {
    // Fall back to the `user` field inside the raw initData payload.
    try {
      const raw = new URLSearchParams(getInitData()).get('user');
      if (raw) u = JSON.parse(raw) as typeof u;
    } catch {
      /* ignore */
    }
  }
  const name = [u?.first_name, u?.last_name].filter(Boolean).join(' ');
  return { name: name || 'Player', username: u?.username ?? null };
}

export function isDark(): boolean {
  return (wa()?.colorScheme ?? 'dark') === 'dark';
}

export type Haptic = 'light' | 'success' | 'error';
export function haptic(type: Haptic): void {
  const hf = wa()?.HapticFeedback;
  if (!hf) return;
  try {
    if (type === 'success') hf.notificationOccurred('success');
    else if (type === 'error') hf.notificationOccurred('error');
    else hf.impactOccurred('light');
  } catch {
    /* ignore */
  }
}

export function close(): void {
  try {
    (wa() as unknown as { close?: () => void })?.close?.();
  } catch {
    /* ignore */
  }
}
