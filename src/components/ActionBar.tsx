import type { RoomState } from '@/lib/types';

interface Props {
  state: RoomState;
  claiming: boolean;
  onBingo: () => void;
}

/**
 * Casino-style control bar. BID / BALANCE / PLAYERS / WIN all update live — PLAYERS and
 * WIN grow in real time as people take cards during selection.
 */
export function ActionBar({ state, claiming, onBingo }: Props) {
  const playing = state.phase === 'PLAYING';
  const joined = state.myCards.length > 0;

  return (
    <div className="bottombar">
      <div className="stat">
        <div className="label">Balance</div>
        <div className="value coins">{state.coins ?? 0}</div>
      </div>
      <div className="stat">
        <div className="label">Bid</div>
        <div className="value">
          {state.entryFee}
          {state.myCards.length > 1 && <span className="mult">×{state.myCards.length}</span>}
        </div>
      </div>
      <div className="stat">
        <div className="label">Players</div>
        <div className="value">{state.playersCount}</div>
      </div>
      <div className="stat">
        <div className="label">Win</div>
        <div className="value win">{state.winAmount}</div>
      </div>
      {playing && joined ? (
        // Never disabled; `claiming` only swaps the label so the press feels instant.
        <button
          className={'act-btn bingo' + (claiming ? ' claiming' : '')}
          onPointerDown={onBingo}
          onClick={(e) => e.preventDefault()}
        >
          {claiming ? '···' : 'Bingo'}
        </button>
      ) : (
        <button className="act-btn" disabled>
          {state.phase === 'SELECTING' ? 'Pick' : playing ? 'Waiting' : 'Next'}
        </button>
      )}
    </div>
  );
}
