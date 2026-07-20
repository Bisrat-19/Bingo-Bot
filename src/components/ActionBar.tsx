import type { RoomState } from '@/lib/types';

interface Props {
  state: RoomState;
  busy: boolean;
  onBingo: () => void;
}

// Casino-style control bar: stat tiles + the BINGO button while a round is running.
export function ActionBar({ state, busy, onBingo }: Props) {
  const playing = state.phase === 'PLAYING';
  const joined = state.myCardNumber != null;

  return (
    <div className="bottombar">
      <div className="stat">
        <div className="label">Called</div>
        <div className="value">{state.called.length}/75</div>
      </div>
      <div className="stat">
        <div className="label">Players</div>
        <div className="value">{state.playersCount}</div>
      </div>
      <div className="stat">
        <div className="label">Coins</div>
        <div className="value coins">{state.coins ?? 0}</div>
      </div>
      <div className="stat">
        <div className="label">Pot</div>
        <div className="value">{state.pot}</div>
      </div>
      {playing && joined ? (
        // Never disabled — duplicate presses are de-duped in the handler so the button
        // always feels instant.
        <button
          className="act-btn bingo"
          onPointerDown={onBingo}
          onClick={(e) => e.preventDefault()}
        >
          Bingo
        </button>
      ) : (
        <button className="act-btn" disabled>
          {state.phase === 'SELECTING' ? 'Pick' : playing ? 'Waiting' : 'Next'}
        </button>
      )}
    </div>
  );
}
