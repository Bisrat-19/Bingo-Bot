'use client';

import { RefreshCw } from 'lucide-react';
import { useHistory } from '@/lib/queries';

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Past rounds this player took part in. Cached; the game invalidates it after a round. */
export function HistoryScreen() {
  const { data: games, isFetching, refetch } = useHistory();

  return (
    <div className="panelscreen">
      <div className="ps-head">
        <div className="ps-title">Game history</div>
        <button
          className="ps-reload icon"
          onPointerDown={() => void refetch()}
          onClick={(e) => e.preventDefault()}
          aria-label="Reload"
        >
          <RefreshCw size={18} strokeWidth={2.4} className={isFetching ? 'spin' : ''} />
        </button>
      </div>

      {/* Skeleton cards while the first load is in flight: the screen keeps its shape
          instead of flashing empty then popping in. */}
      {games === undefined &&
        Array.from({ length: 4 }, (_, i) => (
          <div className="gcard skeleton" key={i} aria-hidden>
            <div className="gcard-top">
              <div className="sk sk-id" />
              <div className="sk sk-result" />
            </div>
            <div className="sk sk-date" />
            <div className="gcard-grid">
              <div className="sk sk-pill" />
              <div className="sk sk-pill" />
              <div className="sk sk-pill" />
              <div className="sk sk-pill" />
            </div>
            <div className="sk sk-foot" />
          </div>
        ))}

      {games?.map((g) => (
        <div className="gcard" key={g.code}>
          <div className="gcard-top">
            <div className="gcard-id">Game #{g.code}</div>
            <div className={'gcard-result ' + (g.won ? 'win' : 'loss')}>{g.won ? 'WON' : 'LOSS'}</div>
          </div>
          <div className="gcard-date">{when(g.playedAt)}</div>
          <div className="gcard-grid">
            <div className="gpill">
              Stake: <b>{g.stake} Birr</b>
            </div>
            <div className="gpill">
              Prize: <b>{g.prize} Birr</b>
            </div>
            <div className="gpill">
              My cards: <b>{g.myCards.map((c) => `#${c}`).join(' ')}</b>
            </div>
            <div className="gpill">
              🏆 Winner: <b>{g.winnerCard != null ? `#${g.winnerCard}` : 'none'}</b>
            </div>
          </div>
          <div className="gcard-foot">Winner count: {g.winners}</div>
        </div>
      ))}

      {games?.length === 0 && (
        <div className="ps-empty">
          <div className="ps-empty-icon">🕘</div>
          No games yet. Your finished rounds will appear here.
        </div>
      )}
      {games && games.length > 0 && <div className="ps-note">Showing your recent {games.length} games</div>}
    </div>
  );
}
