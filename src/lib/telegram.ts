// Thin, typed wrapper around the Telegram WebApp runtime. We read the raw `initData`
// (needed for backend HMAC auth) and the launch `start_param` (the gameId for group
// deep links), and expose theme/haptics/viewport helpers. Using the injected global is
// the most robust approach and coexists with @telegram-apps/sdk.

interface TgWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string };
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

export function getInitData(): string {
  return wa()?.initData ?? '';
}

export function getGameId(): string {
  const fromUrl = new URLSearchParams(location.search).get('gameId');
  if (fromUrl) return fromUrl;
  return wa()?.initDataUnsafe?.start_param ?? '';
}

// Dev-only fallback so the UI can be exercised in a plain browser (?devUser=123).
export function getDevUser(): string | undefined {
  return new URLSearchParams(location.search).get('devUser') ?? undefined;
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
