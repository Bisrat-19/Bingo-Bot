import type { Game } from '@prisma/client';
import type { PlayerWithUser } from '../repositories/player.repository';
import type { LeaderboardRow } from '../repositories/statistics.repository';
import { WinningPattern } from '../types/index';
import { callLabel, displayName, esc, formatDuration, mention } from '../utils/format';

const PATTERN_LABELS: Record<string, string> = {
  [WinningPattern.HORIZONTAL]: 'Horizontal',
  [WinningPattern.VERTICAL]: 'Vertical',
  [WinningPattern.DIAGONAL]: 'Diagonal',
};

export function prettyPattern(p: string): string {
  return PATTERN_LABELS[p] ?? p;
}

export function helpText(): string {
  return [
    '🎲 <b>Bingo Bot — Commands</b>',
    '',
    '/create — create a new game in this group',
    '/join — join the current game',
    '/card — get your card (in DM)',
    '/status — current game status',
    '/players — who has joined',
    '/bingo — claim a win (or tap the BINGO button)',
    '/end — host: end the current game',
    '/restart — host: start a fresh game',
    '/help — show this message',
    '',
    '<b>How to win:</b> mark called numbers on your card, complete a line',
    '(row, column, or diagonal), then be the <b>first to press BINGO</b>.',
    'Completing a line does <i>not</i> auto-win — you must press the button!',
  ].join('\n');
}

export function lobbyText(game: Game, players: PlayerWithUser[]): string {
  const names = players.map((p) => esc(displayName(p.user))).join(', ') || '<i>none yet</i>';
  return [
    '🎲 <b>Bingo lobby</b>',
    `Game ID: <code>${game.id}</code>`,
    '',
    `👥 <b>Players (${players.length}/${game.maxPlayers}):</b> ${names}`,
    `⏱ Draw interval: <b>${game.intervalMs / 1000}s</b>`,
    `⏳ Countdown: <b>${game.countdownSec}s</b>`,
    `🎯 Min players to start: <b>${game.minPlayers}</b>`,
    '',
    'Tap <b>Join Game</b> — then <b>View Card</b> to see your card in DM.',
    '<i>You must press Start (host) once enough players have joined.</i>',
  ].join('\n');
}

export function countdownText(secondsLeft: number): string {
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');
  return `⏳ <b>Game starts in</b>\n\n<b>${mm}:${ss}</b>\n\nOpen your card with /card and get ready!`;
}

export function numberCalledText(number: number, order: number, total: number): string {
  return [
    '🎱 <b>Number Called</b>',
    '',
    `<b>${callLabel(number)}</b>`,
    '',
    `Ball ${order} of ${total} · ${75 - total} remaining`,
    'Mark it on your card, then press <b>BINGO</b> if you have a line!',
  ].join('\n');
}

export function cardCaption(game: Game, marksCount: number): string {
  const last = game.currentNumber ? callLabel(game.currentNumber) : '—';
  return [
    '🎴 <b>Your Bingo card</b>',
    `Last call: <b>${last}</b> · You've marked <b>${marksCount}</b>`,
    '',
    '🔸 = called, tap to mark · ✅ = marked · 🆓 = free',
    'Press <b>BINGO</b> the moment you complete a line — first valid press wins!',
  ].join('\n');
}

// The single "live game board" message, edited in place on every draw and pinned to
// the top of the chat. Shows the current ball and the full called history.
export function boardText(called: number[]): string {
  const last = called.length ? callLabel(called[called.length - 1]) : '—';
  // Show the most recent calls first, cap the list so the message stays compact.
  const recent = [...called].reverse().slice(0, 20).map(callLabel).join('  ');
  return [
    '🎱 <b>BINGO — LIVE</b>',
    '',
    `🔴 <b>Current number:</b> ${last}`,
    `🧮 <b>Called:</b> ${called.length}/75`,
    called.length ? `\n<b>Recent:</b> ${recent}` : '\nGet ready — first number incoming…',
    '',
    '👇 Mark called numbers (🔸) on your card below, then press <b>BINGO</b> on a line!',
  ].join('\n');
}

export function winnerText(
  winner: { username?: string | null; firstName?: string | null; telegramId?: bigint },
  pattern: string,
  numbersCalled: number,
  durationMs: number,
  lastNumber: number | null,
): string {
  return [
    '🎉 <b>BINGO!</b>',
    '',
    `🏆 <b>Winner:</b> ${mention(winner)}`,
    `🧩 <b>Winning Pattern:</b> ${prettyPattern(pattern)}`,
    `🎱 <b>Numbers Called:</b> ${numbersCalled}${lastNumber ? ` (last: ${callLabel(lastNumber)})` : ''}`,
    `⏱ <b>Game Duration:</b> ${formatDuration(durationMs)}`,
    '',
    'Congratulations! 🎊  Use /restart to play again.',
  ].join('\n');
}

export function noWinnerText(): string {
  return '📴 All 75 numbers were called and nobody pressed a valid BINGO. Game over — /restart to try again.';
}

export function statusText(game: Game, playerCount: number, calledCount: number): string {
  return [
    '📊 <b>Game status</b>',
    `State: <b>${game.status}</b>`,
    `Players: <b>${playerCount}</b>`,
    `Numbers called: <b>${calledCount}/75</b>`,
    game.currentNumber ? `Current number: <b>${callLabel(game.currentNumber)}</b>` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function playersText(players: PlayerWithUser[]): string {
  if (players.length === 0) return '👥 No players have joined yet.';
  const lines = players.map((p, i) => `${i + 1}. ${esc(displayName(p.user))}`);
  return ['👥 <b>Players</b>', ...lines].join('\n');
}

export function leaderboardText(rows: LeaderboardRow[]): string {
  if (rows.length === 0) return '🏅 No games have been played yet.';
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => {
    const badge = medals[i] ?? `${i + 1}.`;
    return `${badge} ${esc(displayName(r.user))} — <b>${r.gamesWon}</b> wins / ${r.gamesPlayed} played`;
  });
  return ['🏅 <b>Leaderboard</b>', ...lines].join('\n');
}
