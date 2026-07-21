import { memo, useCallback, useRef } from 'react';

interface Props {
  poolSize: number;
  taken: number[];
  /** Cards this player already holds. */
  mine: number[];
  /** How many cards one player may hold. */
  maxCards: number;
  secondsLeft: number | null;
  playersCount: number;
  entryFee: number;
  busy: boolean;
  onSelect: (n: number) => void;
  onDeselect: (n: number) => void;
}

/** One pool tile. Memoised so a poll repaints only the tiles that actually changed. */
const PoolTile = memo(function PoolTile({
  n,
  isMine,
  isTaken,
  locked,
  dimmed,
  onTap,
}: {
  n: number;
  isMine: boolean;
  isTaken: boolean;
  locked: boolean;
  dimmed: boolean;
  onTap: (n: number) => void;
}) {
  const cls = ['pool-tile', isMine ? 'mine' : '', isTaken ? 'taken' : '', dimmed ? 'dimmed' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button
      className={cls}
      disabled={locked}
      onPointerDown={() => onTap(n)}
      onClick={(e) => e.preventDefault()}
    >
      {n}
    </button>
  );
});

/**
 * The card-selection screen: a grid of numbered cards, and nothing else.
 *
 * No card contents are rendered here on purpose. Selection is the time-pressured part
 * of the round, so the screen stays as light as possible and every tap is instant.
 */
function CardSelectImpl({
  poolSize,
  taken,
  mine,
  maxCards,
  secondsLeft,
  playersCount,
  entryFee,
  onSelect,
  onDeselect,
}: Props) {
  const takenSet = new Set(taken);
  const mineSet = new Set(mine);
  const full = mine.length >= maxCards;

  // Held through refs so `onTap` NEVER changes identity. The parent rebuilds its
  // handlers on every poll, and a changing callback prop would defeat the memo on
  // every tile, repainting the whole grid several times a second for nothing.
  const live = useRef({ mineSet, onSelect, onDeselect });
  live.current = { mineSet, onSelect, onDeselect };

  const onTap = useCallback((n: number) => {
    const { mineSet: held, onSelect: sel, onDeselect: del } = live.current;
    if (held.has(n)) del(n);
    else sel(n);
  }, []);

  return (
    <div className="select-screen">
      <div className="select-head">
        {secondsLeft == null ? (
          <>
            <div className="select-title">Pick your card</div>
            <div className="select-sub">
              {maxCards > 1
                ? `Take up to ${maxCards} cards · ${entryFee} birr each`
                : 'The timer starts on the first pick'}
            </div>
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

      {maxCards > 1 && (
        <div className="mine-strip">
          <span className={'mine-count' + (full ? ' full' : '')}>
            {mine.length} / {maxCards}
          </span>
          {mine.length === 0 ? (
            <span className="mine-hint">Tap cards to take them</span>
          ) : (
            <>
              {mine.map((n) => (
                <button key={n} className="mine-chip" onPointerDown={() => onDeselect(n)}>
                  #{n} <span aria-hidden>✕</span>
                </button>
              ))}
              <span className="mine-hint">Tap to release</span>
            </>
          )}
        </div>
      )}

      <div className="card-pool">
        {Array.from({ length: poolSize }, (_, i) => {
          const n = i + 1;
          const isMine = mineSet.has(n);
          const isTaken = takenSet.has(n) && !isMine;
          return (
            <PoolTile
              key={n}
              n={n}
              isMine={isMine}
              isTaken={isTaken}
              locked={!isMine && (isTaken || full)}
              dimmed={full && !isMine && !isTaken}
              onTap={onTap}
            />
          );
        })}
      </div>
    </div>
  );
}

export const CardSelect = memo(
  CardSelectImpl,
  (a, b) =>
    a.mine.join() === b.mine.join() &&
    a.maxCards === b.maxCards &&
    a.onDeselect === b.onDeselect &&
    a.secondsLeft === b.secondsLeft &&
    a.playersCount === b.playersCount &&
    // Compare WHICH cards are taken, not how many: two players swapping in the same
    // tick leaves the count identical while the grid has actually changed.
    a.taken.join() === b.taken.join(),
);
