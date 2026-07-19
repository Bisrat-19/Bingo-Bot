import type { PlayerView } from '@/lib/types';

// Horizontal strip of player chips under the boards.
export function Players({ players }: { players: PlayerView[] }) {
  if (players.length === 0) return null;
  return (
    <div className="players-strip">
      {players.map((p, i) => (
        <div className={'pchip' + (p.isWinner ? ' winner' : '')} key={i}>
          {p.isWinner ? '👑 ' : p.hasBingo ? '⭐ ' : ''}
          {p.name} · {p.marks}
        </div>
      ))}
    </div>
  );
}
