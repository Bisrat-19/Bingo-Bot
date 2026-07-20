'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { haptic, initTelegram } from '@/lib/telegram';
import type { ActionResult, RoomState } from '@/lib/types';
import { Ball } from '@/components/Ball';
import { CalledBalls } from '@/components/CalledBalls';
import { Dashboard } from '@/components/Dashboard';
import { Card } from '@/components/Card';
import { CardSelect } from '@/components/CardSelect';
import { WaitingScreen } from '@/components/WaitingScreen';
import { ActionBar } from '@/components/ActionBar';
import { WinnerOverlay } from '@/components/WinnerOverlay';

type Res = ActionResult | { error: string };
function isErr<T extends object>(r: T | { error: string }): r is { error: string } {
  return 'error' in r;
}

export default function Page() {
  const [state, setState] = useState<RoomState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Optimistic pick so the tile highlights the instant it's tapped. */
  const [pendingCard, setPendingCard] = useState<number | null>(null);

  const prevCalled = useRef<Set<number>>(new Set());
  const first = useRef(true);
  const toastTimer = useRef<number | undefined>(undefined);
  const inflight = useRef(false);
  const roundRef = useRef<string | null>(null);

  useEffect(() => {
    initTelegram();
    void import('@telegram-apps/sdk-react')
      .then(({ init }) => {
        try {
          init();
        } catch {
          /* outside Telegram */
        }
      })
      .catch(() => {});
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  const refresh = useCallback(async () => {
    const s = await api.state();
    if (isErr(s)) return;
    const newly = s.called.filter((n) => !prevCalled.current.has(n));
    if (newly.length && !first.current) haptic('light');
    prevCalled.current = new Set(s.called);
    first.current = false;
    // A new round clears any optimistic pick.
    if (roundRef.current !== s.roundId) {
      roundRef.current = s.roundId;
      setPendingCard(null);
    }
    setState(s);
  }, []);

  // ~1s polling keeps selection and play in sync for everyone.
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 1000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const onSelect = useCallback(
    async (n: number) => {
      if (!state || state.phase !== 'SELECTING') return;
      // Instant feedback: highlight immediately, then confirm with the server.
      setPendingCard(n);
      haptic('light');
      const res = await api.select(n);
      if (isErr(res)) {
        setPendingCard(null);
        showToast('Network error');
      } else if (!res.ok) {
        setPendingCard(null);
        haptic('error');
        showToast(res.reason || 'Could not pick that card');
      } else {
        showToast(`Card #${n} is yours 🎴`);
      }
      void refresh();
    },
    [state, refresh, showToast],
  );

  const onMark = useCallback(
    async (n: number) => {
      if (!state) return;
      if (!state.called.includes(n)) {
        haptic('error');
        showToast(`${n} not called yet!`);
        return;
      }
      haptic('light');
      const res = await api.mark(n);
      if (isErr(res)) showToast('Network error');
      else if (!res.ok) showToast(res.reason || 'Could not mark');
      void refresh();
    },
    [state, refresh, showToast],
  );

  const onBingo = async () => {
    // De-dupe rapid presses without ever disabling the button.
    if (inflight.current) return;
    inflight.current = true;
    haptic('light');
    const res = await api.bingo();
    inflight.current = false;
    if (isErr(res)) showToast('Network error');
    else if (res.ok) {
      haptic('success');
      showToast('🎉 BINGO! You win!');
    } else if (res.reason === 'invalid') {
      haptic('error');
      showToast("❌ Invalid Bingo — you don't have a line yet.");
    } else if (res.reason === 'passed') {
      haptic('error');
      showToast('⏭️ Too late — that line passed! Finish another pattern.');
    } else if (res.reason === 'cooldown') {
      showToast(`⏳ Wait ${res.retryAfterSec}s before trying again.`);
    } else {
      showToast(res.reason || 'Not yet!');
    }
    void refresh();
  };

  if (!state) return <div className="loading">Connecting to the Bingo room…</div>;

  const selecting = state.phase === 'SELECTING';
  // A player who opened the app mid-round has no card — they wait for the next round
  // instead of being dropped onto a board they can't play.
  const spectating = !selecting && state.myCardNumber == null;

  return (
    <div className="game">
      <header className="game-top">
        <div className="game-title">🎲 Bingo 75</div>
        <div className="top-right">
          {state.phase === 'PLAYING' && <div className="pill live">LIVE</div>}
          <button className="refresh-top" onClick={() => void refresh()} aria-label="refresh">
            ⟳
          </button>
        </div>
      </header>

      <div className="stage">
        {selecting ? (
          <CardSelect
            poolSize={state.poolSize}
            taken={state.takenCards}
            mine={state.myCardNumber ?? pendingCard}
            secondsLeft={state.secondsLeft}
            playersCount={state.playersCount}
            myCard={state.card}
            busy={busy}
            onSelect={onSelect}
          />
        ) : spectating ? (
          <WaitingScreen
            currentNumber={state.currentNumber}
            calledCount={state.called.length}
            playersCount={state.playersCount}
            finished={state.phase === 'FINISHED'}
            nextRoundInSec={state.nextRoundInSec}
          />
        ) : (
          <>
            <div className="ball-row">
              <Ball
                current={state.currentNumber}
                calledCount={state.called.length}
                countdownLeft={null}
                status={state.phase}
              />
              <CalledBalls called={state.called} />
            </div>

            <div className="playrow">
              <Dashboard called={state.called} current={state.currentNumber} />
              <Card
                card={state.card}
                marked={state.marked}
                called={state.called}
                onMark={onMark}
                active={state.phase === 'PLAYING'}
              />
            </div>
          </>
        )}
      </div>

      <ActionBar state={state} busy={busy} onBingo={onBingo} />

      {toast && <div className="toast">{toast}</div>}
      {state.phase === 'FINISHED' && state.winner && (
        <WinnerOverlay
          name={state.winner.name}
          cardNumber={state.winner.cardNumber}
          pattern={state.winner.pattern}
          line={state.winner.line}
          card={state.winner.card}
          nextIn={state.nextRoundInSec}
        />
      )}
    </div>
  );
}
