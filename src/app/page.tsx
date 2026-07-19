'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { haptic, initTelegram } from '@/lib/telegram';
import type { ActionResult, GameStatus, WebState } from '@/lib/types';
import { Ball } from '@/components/Ball';
import { CalledBalls } from '@/components/CalledBalls';
import { Dashboard } from '@/components/Dashboard';
import { Card } from '@/components/Card';
import { ActionBar } from '@/components/ActionBar';
import { WinnerOverlay } from '@/components/WinnerOverlay';

const STATUS_LABEL: Record<GameStatus, { cls: string; label: string }> = {
  WAITING_FOR_PLAYERS: { cls: 'wait', label: 'Lobby' },
  CARD_GENERATED: { cls: 'wait', label: 'Lobby' },
  COUNTDOWN: { cls: 'wait', label: 'Starting' },
  PLAYING: { cls: 'live', label: 'LIVE' },
  FINISHED: { cls: 'done', label: 'Finished' },
  CANCELLED: { cls: '', label: 'Cancelled' },
};

function StatusPill({ status }: { status: GameStatus }) {
  const s = STATUS_LABEL[status];
  return <div className={'pill ' + s.cls}>{s.label}</div>;
}

type Res = ActionResult | { error: string };
function isErr<T extends object>(r: T | { error: string }): r is { error: string } {
  return 'error' in r;
}

export default function Page() {
  const [state, setState] = useState<WebState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overlayClosed, setOverlayClosed] = useState(false);

  const prevCalled = useRef<Set<number>>(new Set());
  const first = useRef(true);
  const toastTimer = useRef<number | undefined>(undefined);

  // Initialize the Telegram Apps SDK + runtime once, client-side.
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
    // Buzz once when a new number is called.
    const newly = s.called.filter((n) => !prevCalled.current.has(n));
    if (newly.length && !first.current) haptic('light');
    prevCalled.current = new Set(s.called);
    first.current = false;
    setState(s);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 1200);
    return () => window.clearInterval(id);
  }, [refresh]);

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

  const run = useCallback(
    async (fn: () => Promise<Res>, okMsg?: string) => {
      setBusy(true);
      const res = await fn();
      setBusy(false);
      if (isErr(res)) showToast('Network error');
      else if (res.ok) {
        if (okMsg) showToast(okMsg);
      } else showToast(res.reason || 'Failed');
      void refresh();
    },
    [refresh, showToast],
  );

  const onJoin = () => run(api.join, 'Joined! 🎴');
  const onStart = () => run(api.start);

  const onBingo = async () => {
    setBusy(true);
    const res = await api.bingo();
    setBusy(false);
    if (isErr(res)) showToast('Network error');
    else if (res.ok) {
      haptic('success');
      showToast('🎉 BINGO! You win!');
    } else if (res.reason === 'invalid') {
      haptic('error');
      showToast("❌ Invalid Bingo — you don't have a line yet.");
    } else if (res.reason === 'cooldown') {
      showToast(`⏳ Wait ${res.retryAfterSec}s before trying again.`);
    } else {
      showToast(res.reason || 'Not yet!');
    }
    void refresh();
  };

  if (!state) return <div className="loading">Loading game…</div>;

  const showWinner = state.status === 'FINISHED' && !!state.winner && !overlayClosed;

  return (
    <div className="game">
      <header className="game-top">
        <div className="game-title">🎲 Bingo 75</div>
        <div className="top-right">
          {state.status === 'PLAYING' && <StatusPill status={state.status} />}
          <button className="refresh-top" onClick={() => void refresh()} aria-label="refresh">
            ⟳
          </button>
        </div>
      </header>

      <div className="stage">
        <div className="ball-row">
          <Ball
            current={state.currentNumber}
            calledCount={state.called.length}
            countdownLeft={state.countdownLeft}
            status={state.status}
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
            active={state.status === 'PLAYING'}
          />
        </div>
      </div>

      <ActionBar state={state} busy={busy} onJoin={onJoin} onStart={onStart} onBingo={onBingo} />

      {toast && <div className="toast">{toast}</div>}
      {showWinner && <WinnerOverlay name={state.winner!.name} onClose={() => setOverlayClosed(true)} />}
    </div>
  );
}
