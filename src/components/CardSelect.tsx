import { memo } from 'react';
import { Card } from './Card';

interface Props {
  poolSize: number;
  taken: number[];
  mine: number | null;
  secondsLeft: number | null;
  playersCount: number;
  myCard: number[][] | null;
  busy: boolean;
  onSelect: (n: number) => void;
  onDeselect: () => void;
}

/**
 * The card-selection screen: a grid of numbered cards. A card taken by someone else is
 * locked; your pick is highlighted. The 30s countdown starts when the FIRST player picks.
 */
function CardSelectImpl({
  poolSize,
  taken,
  mine,
  secondsLeft,
  playersCount,
  myCard,
  busy,
  onSelect,
  onDeselect,
}: Props) {
  const takenSet = new Set(taken);

  return (
    <div className="select-screen">
      <div className="select-head">
        {secondsLeft == null ? (
          <>
            <div className="select-title">Pick your card</div>
            <div className="select-sub">The 30s timer starts on the first pick</div>
          </>
        ) : (
          <>
            <div className="select-timer">{secondsLeft}s</div>
            <div className="select-sub">
              Round starts soon · {playersCount} player{playersCount === 1 ? '' : 's'} in
            </div>
          </>
        )}
      </div>

      <div className="card-pool">
        {Array.from({ length: poolSize }, (_, i) => {
          const n = i + 1;
          const isMine = mine === n;
          const isTaken = takenSet.has(n) && !isMine;
          const cls = ['pool-tile', isMine ? 'mine' : '', isTaken ? 'taken' : '']
            .filter(Boolean)
            .join(' ');
          // Only taken cards are disabled — never block on an in-flight request, so
          // rapid taps stay responsive.
          return (
            <button
              key={n}
              className={cls}
              disabled={isTaken}
              onPointerDown={() => (isMine ? onDeselect() : onSelect(n))}
              onClick={(e) => e.preventDefault()}
            >
              {n}
            </button>
          );
        })}
      </div>

      {mine != null && myCard && (
        <div className="my-pick">
          <div className="my-pick-label">Your card · #{mine} — tap it again to release</div>
          <Card card={myCard} marked={[]} called={[]} onMark={() => {}} active={false} />
        </div>
      )}
    </div>
  );
}

export const CardSelect = memo(
  CardSelectImpl,
  (a, b) =>
    a.mine === b.mine &&
    a.onDeselect === b.onDeselect &&
    a.secondsLeft === b.secondsLeft &&
    a.playersCount === b.playersCount &&
    a.taken.length === b.taken.length &&
    a.myCard === b.myCard,
);
