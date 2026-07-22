import { memo } from 'react';
import { LogOut, RefreshCw, Zap } from 'lucide-react';
import type { RoomState } from '@/lib/types';
import { Card } from './Card';
import { NumberBoard } from './NumberBoard';

const LETTER = (n: number) => ['B', 'I', 'N', 'G', 'O'][Math.floor((n - 1) / 15)] ?? '';

interface Props {
  state: RoomState;
  mode: 'manual' | 'auto';
  claiming: boolean;
  localMarks: Map<number, Set<number>>;
  onMode: (m: 'manual' | 'auto') => void;
  onMark: (n: number, cardNumber: number) => void;
  onBingo: () => void;
  onLeave: () => void;
  onRefresh: () => void;
}

/**
 * The live round: called-number board on the left, the current ball and the player's
 * cartelas on the right, and the actions pinned underneath.
 */
function GameScreenImpl({
  state,
  mode,
  claiming,
  localMarks,
  onMode,
  onMark,
  onBingo,
  onLeave,
  onRefresh,
}: Props) {
  const cur = state.currentNumber;
  // The three calls just before the current ball, newest first.
  const recent = state.called.slice(-4, -1).reverse();
  // Cards shrink a notch with more than one, so two cartelas fit without scrolling.
  const multi = state.myCards.length > 1;

  return (
    <div className={'gscreen' + (multi ? ' multi' : '')}>
      <div className="gstats four">
        <div className="gstat">
          <div className="gs-k">Called</div>
          <div className="gs-v">{state.called.length}</div>
        </div>
        <div className="gstat">
          <div className="gs-k">Players</div>
          <div className="gs-v">{state.playersCount}</div>
        </div>
        <div className="gstat">
          <div className="gs-k">Stake</div>
          <div className="gs-v">{state.entryFee}</div>
        </div>
        <div className="gstat">
          <div className="gs-k">Prize</div>
          <div className="gs-v gold">{state.winAmount}</div>
        </div>
      </div>

      <div className="gbody">
        <NumberBoard called={state.called} current={cur} />

        <div className="gright">
          <div className="callcard">
            <div className="callcard-side">
              <div className="callcard-label">Current Call</div>
              {recent.length > 0 && (
                <div className="recent-balls">
                  {recent.map((n) => (
                    <span className={'mini-ball ball-' + LETTER(n).toLowerCase()} key={n}>
                      <b>{LETTER(n)}</b>
                      <i>{n}</i>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div
              className={'callball' + (cur ? ' pop ball-' + LETTER(cur).toLowerCase() : '')}
              key={cur ?? 0}
            >
              {cur ? (
                <>
                  <span className="cb-letter">{LETTER(cur)}</span>
                  <span className="cb-num">{cur}</span>
                </>
              ) : (
                <span className="cb-num">–</span>
              )}
            </div>
          </div>

          <div className="grow">
            <button
              className={'chip wide' + (mode === 'auto' ? ' on' : '')}
              onPointerDown={() => onMode(mode === 'auto' ? 'manual' : 'auto')}
              onClick={(e) => e.preventDefault()}
            >
              <Zap size={15} strokeWidth={2.6} /> Auto {mode === 'auto' ? 'ON' : 'OFF'}
            </button>
          </div>

          {state.myCards.map((c) => (
            <div className={'cartela' + (c.hasBingo ? ' ready' : '')} key={c.cardNumber}>
              <div className="cartela-tag">
                Cartela #{c.cardNumber}
                {c.hasBingo && <span className="ready-flag">BINGO</span>}
              </div>
              <Card
                card={c.card}
                marked={mode === 'auto' ? state.called : [...c.marked, ...(localMarks.get(c.cardNumber) ?? [])]}
                called={state.called}
                onMark={mode === 'auto' ? undefined : (n) => onMark(n, c.cardNumber)}
                active={state.phase === 'PLAYING'}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="gactions">
        <button className="ga leave" onPointerDown={onLeave} onClick={(e) => e.preventDefault()}>
          <LogOut size={17} strokeWidth={2.4} /> Leave
        </button>
        <button className="ga refresh" onPointerDown={onRefresh} onClick={(e) => e.preventDefault()}>
          <RefreshCw size={17} strokeWidth={2.4} /> Refresh
        </button>
        <button
          className={'ga bingo' + (claiming ? ' claiming' : '') + (state.hasBingo ? ' hot' : '')}
          onPointerDown={onBingo}
          onClick={(e) => e.preventDefault()}
        >
          {claiming ? '···' : 'BINGO'}
        </button>
      </div>
    </div>
  );
}

export const GameScreen = memo(GameScreenImpl);
