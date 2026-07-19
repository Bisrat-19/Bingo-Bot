import type { WebState } from '@/lib/types';

interface Props {
  state: WebState;
  busy: boolean;
  onJoin: () => void;
  onStart: () => void;
  onBingo: () => void;
}

// Casino-style control bar: stat tiles + the primary action button (Join / Start / BINGO).
export function ActionBar({ state, busy, onJoin, onStart, onBingo }: Props) {
  const s = state.status;
  const pre = s === 'WAITING_FOR_PLAYERS' || s === 'CARD_GENERATED';

  let button = (
    <button className="act-btn" disabled>
      —
    </button>
  );

  if (s === 'FINISHED' || s === 'CANCELLED') {
    button = (
      <button className="act-btn" disabled>
        Over
      </button>
    );
  } else if (!state.joined && pre) {
    button = (
      <button className="act-btn" disabled={busy} onClick={onJoin}>
        Join
      </button>
    );
  } else if (state.joined && state.isHost && pre) {
    const enough = state.players.length >= state.minPlayers;
    button = (
      <button className="act-btn" disabled={busy || !enough} onClick={onStart}>
        {enough ? 'Start' : `Need ${state.minPlayers}`}
      </button>
    );
  } else if (state.joined && s === 'PLAYING') {
    button = (
      <button className="act-btn bingo" disabled={busy} onClick={onBingo}>
        Bingo
      </button>
    );
  } else if (state.joined && pre) {
    button = (
      <button className="act-btn" disabled>
        Wait
      </button>
    );
  }

  return (
    <div className="bottombar">
      <div className="stat">
        <div className="label">Called</div>
        <div className="value">{state.called.length}/75</div>
      </div>
      <div className="stat">
        <div className="label">Players</div>
        <div className="value">{state.players.length}</div>
      </div>
      <div className="stat">
        <div className="label">Marked</div>
        <div className="value">{state.marked.length}</div>
      </div>
      {button}
    </div>
  );
}
