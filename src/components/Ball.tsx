import { columnOf, letterFor } from '@/lib/bingo';

interface Props {
  current: number | null;
  calledCount: number;
  countdownLeft: number | null;
  status: string;
}

// The big chrome bingo ball: the current call's LETTER + number, plus a progress badge.
// (It no longer blinks — the current number blinks on the board instead.)
export function Ball({ current, calledCount, countdownLeft, status }: Props) {
  const counting = status === 'COUNTDOWN' && countdownLeft != null;
  return (
    <div className="ball-wrap">
      <div className="chrome-ball">
        {current != null && !counting && (
          <span className={`ball-letter col${columnOf(current)}`}>{letterFor(current)}</span>
        )}
        <span className="ball-num">{counting ? countdownLeft : (current ?? '')}</span>
        <div className="ball-progress">{counting ? 'starting…' : `${calledCount}/75`}</div>
      </div>
    </div>
  );
}
