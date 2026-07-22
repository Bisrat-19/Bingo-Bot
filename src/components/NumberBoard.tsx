import { memo } from 'react';

const HEAD = ['B', 'I', 'N', 'G', 'O'];

/**
 * The full 75-number board, one column per letter. Called numbers light up; the number
 * just drawn gets a ring so it is findable at a glance.
 */
function NumberBoardImpl({ called, current }: { called: number[]; current: number | null }) {
  const hit = new Set(called);
  return (
    <div className="nboard">
      <div className="nboard-head">
        {HEAD.map((h) => (
          <div key={h} className={'nb-h ' + h.toLowerCase()}>
            {h}
          </div>
        ))}
      </div>
      <div className="nboard-grid">
        {Array.from({ length: 15 }, (_, r) =>
          HEAD.map((_h, c) => {
            const n = c * 15 + r + 1;
            const on = hit.has(n);
            return (
              <div
                key={n}
                className={'nb-c' + (on ? ' on' : '') + (current === n ? ' now' : '')}
                style={{ gridColumn: c + 1, gridRow: r + 1 }}
              >
                {n}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

export const NumberBoard = memo(
  NumberBoardImpl,
  (a, b) => a.called.length === b.called.length && a.current === b.current,
);
