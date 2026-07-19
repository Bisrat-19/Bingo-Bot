import { COLUMNS } from '../types/index';

interface NameLike {
  username?: string | null;
  firstName?: string | null;
  telegramId?: bigint | number;
}

// Escape text for Telegram HTML parse mode.
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function displayName(u: NameLike): string {
  if (u.username) return `@${u.username}`;
  if (u.firstName) return u.firstName;
  return 'Player';
}

// A clickable mention via tg://user link (works even without a username).
export function mention(u: NameLike): string {
  const label = esc(u.firstName || (u.username ? `@${u.username}` : 'Player'));
  if (u.telegramId != null) return `<a href="tg://user?id=${u.telegramId}">${label}</a>`;
  return label;
}

// The letter a number belongs to, e.g. 7 -> "B", 42 -> "N".
export function letterFor(n: number): string {
  return COLUMNS[Math.floor((n - 1) / 15)];
}

export function callLabel(n: number): string {
  return `${letterFor(n)}-${n}`;
}

// milliseconds -> "MM:SS"
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
