import { memo, useCallback, useRef } from 'react';
import { LogOut, RefreshCw } from 'lucide-react';
import { useCatalog } from '@/lib/queries';

const HEAD = ['B', 'I', 'N', 'G', 'O'];

/**
 * A small preview of one selected card, rendered from the cached catalog — no backend
 * call, so it appears the instant the card is tapped. Memoised on its numbers, which
 * never change for a given card.
 */
const MiniCartela = memo(function MiniCartela({ number, card }: { number: number; card: number[][] }) {
  return (
    <div className="mini-cartela">
      <div className="mini-cartela-tag">#{number}</div>
      <div className="mini-cartela-head">
        {HEAD.map((h) => (
          <div key={h} className={'mc-h ' + h.toLowerCase()}>
            {h}
          </div>
        ))}
      </div>
      <div className="mini-cartela-grid">
        {card.flatMap((row, r) =>
          row.map((n, c) => (
            <div key={`${r}-${c}`} className={'mc-cell' + (n === 0 ? ' free' : '')}>
              {n === 0 ? '★' : n}
            </div>
          )),
        )}
      </div>
    </div>
  );
});

interface Props {
  balance: number;
  onLeave: () => void;
  onRefresh: () => void;
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
  balance,
  onLeave,
  onRefresh,
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
  // The fixed catalog, cached once. Previews are then instant lookups.
  const { data: catalog } = useCatalog();

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
      {/* Status strip: leaving, the countdown, and what this round costs. */}
      <div className="selbar">
        <button className="selbar-btn leave" onPointerDown={onLeave} onClick={(e) => e.preventDefault()}>
          <LogOut size={16} strokeWidth={2.4} /> Leave
        </button>
        <div className="selbar-timer">{secondsLeft == null ? '–' : `${secondsLeft}`}</div>
        <div className="selbar-stat">
          <span className="sb-k">Wallet</span>
          <span className="sb-v">{balance}</span>
        </div>
        <div className="selbar-stat">
          <span className="sb-k">Stake</span>
          <span className="sb-v">{entryFee}</span>
        </div>
        <button className="selbar-btn icon" onPointerDown={onRefresh} onClick={(e) => e.preventDefault()} aria-label="Refresh">
          <RefreshCw size={22} strokeWidth={2.4} />
        </button>
      </div>

      {/* One line for state: how many boards are held, who else is in, and the chips
          for releasing them. The top bar already carries the countdown. */}
      <div className="boards-line">
        <span className={'boards-count' + (full ? ' full' : '')}>
          Boards: {mine.length}/{maxCards}
        </span>
        {mine.map((n) => (
          <button key={n} className="mine-chip" onPointerDown={() => onDeselect(n)}>
            #{n} <span aria-hidden>✕</span>
          </button>
        ))}
        <span className="boards-players">
          {secondsLeft == null
            ? 'Tap a card to join'
            : `${playersCount} player${playersCount === 1 ? '' : 's'} in`}
        </span>
      </div>

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

      {/* Preview of the cards you hold, below the grid. The container is ALWAYS
          rendered at a fixed height: if it appeared only when a card is picked, the
          grid above would resize on every select/deselect. */}
      <div className={'preview-cartelas' + (mine.length > 1 ? ' two' : '')}>
        {catalog &&
          mine.map((n) => {
            const card = catalog.get(n);
            return card ? <MiniCartela key={n} number={n} card={card} /> : null;
          })}
        {mine.length === 0 && <div className="preview-empty">Your cards will show here</div>}
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
