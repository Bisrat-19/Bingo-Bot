import { memo } from 'react';
import { LETTERS } from '@/lib/bingo';

interface Props {
  card: number[][] | null;
  marked: number[];
  called: number[];
  onMark: (n: number) => void;
  active: boolean; // game is PLAYING
}

// The player's 5×5 card: white cells with a colored BINGO header and a gold star free
// center. Marked numbers get a red daub; callable (called, not yet marked) cells pulse.
function CardImpl({ card, marked, called, onMark, active }: Props) {
  const markedSet = new Set(marked);
  const calledSet = new Set(called);

  return (
    <div className="card-panel">
      <div className="bingo-head">
        {LETTERS.map((l, i) => (
          <div key={l} className={`hc${i}`}>
            {l}
          </div>
        ))}
      </div>
      {!card ? (
        <p style={{ textAlign: 'center', color: '#6b5a34', fontWeight: 700, padding: '18px 6px' }}>
          Join to get your card
        </p>
      ) : (
        <div className="card-grid">
          {card.flatMap((row, r) =>
            row.map((n, c) => {
              if (n === 0) {
                return (
                  <div key={`${r}-${c}`} className="pcell free">
                    ★
                  </div>
                );
              }
              const isMarked = markedSet.has(n);
              const callable = !isMarked && calledSet.has(n);
              const cls = ['pcell', isMarked ? 'marked' : '', callable ? 'callable' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={`${r}-${c}`}
                  className={cls}
                  disabled={!active || isMarked}
                  onPointerDown={() => onMark(n)}
                  onClick={(e) => e.preventDefault()}
                >
                  {n}
                </button>
              );
            }),
          )}
        </div>
      )}
    </div>
  );
}

export const Card = memo(
  CardImpl,
  (a, b) =>
    a.card === b.card &&
    a.active === b.active &&
    a.marked.length === b.marked.length &&
    a.called.length === b.called.length,
);
