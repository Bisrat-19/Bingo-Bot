import { LETTERS } from '@/lib/bingo';

interface Props {
  called: number[];
  current: number | null;
}

// The full 75-number board: 5 BINGO columns × 15 rows in a pink checkerboard.
// Called numbers get a gold highlight box; the current number blinks until the next call.
export function Dashboard({ called, current }: Props) {
  const calledSet = new Set(called);
  return (
    <div className="board">
      <div className="bingo-head">
        {LETTERS.map((l, i) => (
          <div key={l} className={`hc${i}`}>
            {l}
          </div>
        ))}
      </div>
      <div className="board-grid">
        {Array.from({ length: 15 }).flatMap((_, r) =>
          LETTERS.map((_letter, c) => {
            const n = c * 15 + r + 1;
            const cls = [
              'bcell',
              `p${(r + c) % 2}`,
              calledSet.has(n) ? 'called' : '',
              current === n ? 'current' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div className={cls} key={n}>
                {n}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
