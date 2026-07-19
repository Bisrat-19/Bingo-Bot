import { columnOf, letterFor } from '@/lib/bingo';

// The row of recently-called balls (newest first): each shows its LETTER + number,
// colored by BINGO column.
export function CalledBalls({ called }: { called: number[] }) {
  const recent = [...called].slice(-5).reverse();
  return (
    <div className="called-balls">
      {recent.map((n, i) => (
        <div key={n} className={`mini-ball ${i === 0 ? 'cur' : 'col' + columnOf(n)}`}>
          <span className="ml">{letterFor(n)}</span>
          <span className="mn">{n}</span>
        </div>
      ))}
    </div>
  );
}
