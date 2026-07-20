import { callLabel } from '@/lib/bingo';

interface Props {
  currentNumber: number | null;
  calledCount: number;
  playersCount: number;
  finished: boolean;
  nextRoundInSec: number | null;
}

/**
 * Shown to a player who opened the app while a round is already running and therefore
 * has no card. They wait here until the round ends, then the selection screen opens.
 */
export function WaitingScreen({
  currentNumber,
  calledCount,
  playersCount,
  finished,
  nextRoundInSec,
}: Props) {
  return (
    <div className="waiting">
      <div className="waiting-icon">⏳</div>
      <div className="waiting-title">
        {finished ? 'Round finished' : 'Round in progress'}
      </div>
      <div className="waiting-sub">
        {finished
          ? `Card selection opens${nextRoundInSec != null ? ` in ${nextRoundInSec}s` : ' shortly'}…`
          : 'Please wait — you can pick a card as soon as this round ends.'}
      </div>

      <div className="waiting-stats">
        <div className="wstat">
          <div className="wlabel">Current</div>
          <div className="wvalue">{currentNumber ? callLabel(currentNumber) : '--'}</div>
        </div>
        <div className="wstat">
          <div className="wlabel">Called</div>
          <div className="wvalue">{calledCount}/75</div>
        </div>
        <div className="wstat">
          <div className="wlabel">Playing</div>
          <div className="wvalue">{playersCount}</div>
        </div>
      </div>

      <div className="waiting-note">You&apos;ll join the next round automatically 🎴</div>
    </div>
  );
}
