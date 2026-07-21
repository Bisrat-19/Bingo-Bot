'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getTgProfile, haptic, initTelegram } from '@/lib/telegram';
import { ensureSession } from '@/lib/session';
import type { ActionResult, RoomState } from '@/lib/types';
import { Ball } from '@/components/Ball';
import { CalledBalls } from '@/components/CalledBalls';
import { Dashboard } from '@/components/Dashboard';
import { Card } from '@/components/Card';
import { CardSelect } from '@/components/CardSelect';
import { WaitingScreen } from '@/components/WaitingScreen';
import { ActionBar } from '@/components/ActionBar';
import { WinnerOverlay } from '@/components/WinnerOverlay';
import { RegisterScreen } from '@/components/RegisterScreen';

type Res = ActionResult | { error: string };
function isErr<T extends object>(r: T | { error: string }): r is { error: string } {
  return 'error' in r;
}

export default function Page() {
  const [state, setState] = useState<RoomState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Optimistic pick so the tile highlights the instant it's tapped. */
  const [pendingCards, setPendingCards] = useState<Set<number>>(new Set());
  /** Cards being released, hidden immediately so the tap feels instant. */
  const [releasing, setReleasing] = useState<Set<number>>(new Set());
  /** Cells tapped locally, shown instantly while the request is in flight. */
  const [localMarks, setLocalMarks] = useState<Map<number, Set<number>>>(new Map());
  /** Flips the BINGO button the moment it's pressed, before the server answers. */
  const [claiming, setClaiming] = useState(false);
  /**
   * MANUAL: you tap the numbers and press BINGO (the original behaviour).
   * AUTO:   called numbers are daubed for you and BINGO is pressed the moment one of
   *         your cards completes a line.
   */
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');

  const prevCalled = useRef<Set<number>>(new Set());
  /** Drives the adaptive poll rate (fast while picking, calmer while playing). */
  const phaseRef = useRef<string>('');
  const pace = useRef<() => void>(() => {});
  const first = useRef(true);
  const toastTimer = useRef<number | undefined>(undefined);
  const inflight = useRef(false);
  const roundRef = useRef<string | null>(null);
  const sigRef = useRef<string>('');

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
      setPendingCards(new Set());
      setReleasing(new Set());
      setLocalMarks(new Map());
    }
    // Skip the React update when nothing meaningful changed — during PLAYING this drops
    // re-renders from ~1/sec to one per drawn ball.
    const sig = [
      s.roundId, s.phase, s.secondsLeft, s.currentNumber, s.called.length,
      s.takenCards.join(','), s.myCards.map((c) => c.cardNumber).join(','),
      s.myCards.reduce((n, c) => n + c.marked.length, 0),
      s.myCards.map((c) => (c.hasBingo ? 1 : 0)).join(''), s.playersCount,
      s.coins, s.pot, s.winAmount, s.entryFee, s.nextRoundInSec, s.winner?.cardNumber ?? '',
    ].join('|');
    phaseRef.current = s.phase;
    pace.current();
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    setState(s);
    // A release is confirmed once the card is no longer ours; drop the local override
    // so re-picking the same card works immediately.
    setReleasing((prev) => {
      if (prev.size === 0) return prev;
      const held = new Set(s.myCards.map((c) => c.cardNumber));
      const next = new Set([...prev].filter((n) => held.has(n)));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('bingo_mode');
      if (saved === 'auto' || saved === 'manual') setMode(saved);
    } catch {
      /* storage can be unavailable; manual is a safe default */
    }
  }, []);

  const stateRef = useRef<RoomState | null>(null);
  stateRef.current = state;

  const changeMode = useCallback((next: 'manual' | 'auto') => {
    const cur = stateRef.current;

    // Leaving AUTO: everything it daubed becomes a real mark, so the card carries on
    // from where it was instead of appearing to reset to blank.
    if (next === 'manual' && cur && cur.phase === 'PLAYING') {
      const called = new Set(cur.called);
      setLocalMarks((prev) => {
        const carried = new Map(prev);
        for (const c of cur.myCards) {
          const hits = c.card.flat().filter((n) => n !== 0 && called.has(n));
          if (hits.length === 0) continue;
          carried.set(c.cardNumber, new Set([...(carried.get(c.cardNumber) ?? []), ...hits]));
          // Persist too, so a reload does not lose them.
          void api.mark(0, c.cardNumber, hits);
        }
        return carried;
      });
    }

    setMode(next);
    try {
      localStorage.setItem('bingo_mode', next);
    } catch {
      /* ignore */
    }
    haptic('light');
  }, []);

  // Log in once (initData -> JWT), then poll ~1s to keep everyone in sync.
  useEffect(() => {
    let id: number | undefined;
    void (async () => {
      await ensureSession();
      await refresh();
      // Selection is the competitive part: cards must grey out almost as they are
      // taken. During play a ball only lands every few seconds, so a slower poll is
      // plenty and keeps the battery cost down.
      let current = 0;
      const schedule = () => {
        const want = phaseRef.current === 'SELECTING' ? 450 : 900;
        if (want === current) return;
        current = want;
        if (id) window.clearInterval(id);
        id = window.setInterval(() => void refresh(), want);
      };
      schedule();
      pace.current = schedule;
    })();
    return () => {
      if (id) window.clearInterval(id);
    };
  }, [refresh]);

  const onSelect = useCallback(
    async (n: number) => {
      if (!state || state.phase !== 'SELECTING') return;
      // Instant feedback: highlight immediately, then confirm with the server.
      setPendingCards((prev) => new Set(prev).add(n));
      haptic('light');
      const res = await api.select(n);
      const undo = () =>
        setPendingCards((prev) => {
          const next = new Set(prev);
          next.delete(n);
          return next;
        });
      if (isErr(res)) {
        undo();
        showToast('Network error');
      } else if (!res.ok) {
        undo();
        haptic('error');
        showToast(res.reason || 'Could not pick that card');
      }
      void refresh();
    },
    [state, refresh, showToast],
  );

  const onDeselect = useCallback(
    async (n: number) => {
      // Drop it from the grid on the same frame as the tap; the server confirms after.
      setPendingCards((prev) => {
        const next = new Set(prev);
        next.delete(n);
        return next;
      });
      setReleasing((prev) => new Set(prev).add(n));
      haptic('light');
      const res = await api.deselect(n);
      if (!isErr(res) && !res.ok) {
        // Put it back: the server refused, so the card is still ours.
        setReleasing((prev) => {
          const next = new Set(prev);
          next.delete(n);
          return next;
        });
        showToast(res.reason || 'Could not release the card');
      }
      void refresh();
    },
    [refresh, showToast],
  );

  const onMark = useCallback(
    (n: number, cardNumber: number) => {
      if (!state) return;
      if (!state.called.includes(n)) {
        haptic('error');
        showToast(`${n} not called yet!`);
        return;
      }
      // Paint it instantly on THAT card only; the network round-trip happens after.
      setLocalMarks((prev) => {
        const forCard = prev.get(cardNumber);
        if (forCard?.has(n)) return prev;
        const next = new Map(prev);
        next.set(cardNumber, new Set(forCard ?? []).add(n));
        return next;
      });
      haptic('light');
      void api.mark(n, cardNumber);
    },
    [state, showToast],
  );

  const onBingo = useCallback(async (auto = false) => {
    // Fired on pointer-down for the lowest possible latency: with "first valid press
    // wins", every millisecond counts. The ref de-dupes without disabling the button.
    if (inflight.current) return;
    inflight.current = true;
    setClaiming(true); // paint immediately — no waiting on the network
    haptic('light');
    const res = await api.bingo();
    inflight.current = false;
    setClaiming(false);
    if (isErr(res)) {
      if (!auto) showToast('Network error');
    } else if (res.ok) {
      haptic('success');
      showToast(
        res.cardNumber != null
          ? `🎉 BINGO on card #${res.cardNumber}! You win!`
          : '🎉 BINGO! You win!',
      );
    } else if (auto) {
      // An auto attempt that misses is normal (someone else was first, or the line had
      // already passed). Staying silent keeps the screen calm instead of nagging.
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
  }, [refresh, showToast]);

  /**
   * AUTO mode: claim the moment the server says one of your cards completed a line on
   * the ball just called. It keys off `currentNumber`, so it fires at most once per
   * ball and never spams the server after a miss.
   */
  const autoTried = useRef<string>('');
  useEffect(() => {
    if (mode !== 'auto' || !state) return;
    if (state.phase !== 'PLAYING' || !state.hasBingo) return;
    const key = `${state.roundId}:${state.currentNumber}`;
    if (autoTried.current === key) return;
    autoTried.current = key;
    void onBingo(true);
  }, [mode, state, onBingo]);

  if (!state) return <div className="loading">Connecting to the Bingo room…</div>;

  if (!state.registered) {
    const profile = getTgProfile();
    return (
      <div className="game">
        <RegisterScreen name={profile.name} />
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  const selecting = state.phase === 'SELECTING';
  // Confirmed cards plus any pick still in flight, so the grid never flickers.
  const myCardNumbers = [
    ...new Set([...state.myCards.map((c) => c.cardNumber), ...pendingCards]),
  ]
    .filter((n) => !releasing.has(n))
    .sort((a, b) => a - b);
  // A player who opened the app mid-round has no card — they wait for the next round
  // instead of being dropped onto a board they can't play.
  const spectating = !selecting && state.myCards.length === 0;

  return (
    <div className="game">
      <header className="game-top">
        <div className="game-title">🎲 Bingo 75</div>
        <div className="mode-toggle" role="group" aria-label="Play mode">
          <button
            className={mode === 'manual' ? 'on' : ''}
            onPointerDown={() => changeMode('manual')}
            onClick={(e) => e.preventDefault()}
          >
            Manual
          </button>
          <button
            className={mode === 'auto' ? 'on' : ''}
            onPointerDown={() => changeMode('auto')}
            onClick={(e) => e.preventDefault()}
          >
            Auto
          </button>
        </div>
        <div className="top-right">
          {state.phase === 'PLAYING' && <div className="pill live">LIVE</div>}
        </div>
      </header>

      <div className="stage">
        {selecting ? (
          <CardSelect
            poolSize={state.poolSize}
            taken={state.takenCards.filter((n) => !myCardNumbers.includes(n))}
            mine={myCardNumbers}
            maxCards={state.maxCards}
            secondsLeft={state.secondsLeft}
            playersCount={state.playersCount}
            entryFee={state.entryFee}
            busy={busy}
            onSelect={onSelect}
            onDeselect={onDeselect}
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
              {/* Every card the player bought, laid out in a row. */}
              <div className="my-cards">
                {state.myCards.map((c) => (
                  <div className={'my-card' + (c.hasBingo ? ' ready' : '')} key={c.cardNumber}>
                    {state.myCards.length > 1 && (
                      <div className="my-card-tag">
                        #{c.cardNumber}
                        {c.hasBingo && <span className="ready-flag">BINGO</span>}
                      </div>
                    )}
                    <Card
                      card={c.card}
                      marked={
                        mode === 'auto'
                          ? state.called
                          : [...c.marked, ...(localMarks.get(c.cardNumber) ?? [])]
                      }
                      called={state.called}
                      onMark={mode === 'auto' ? undefined : (n) => onMark(n, c.cardNumber)}
                      active={state.phase === 'PLAYING'}
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <ActionBar state={state} claiming={claiming} onBingo={onBingo} />

      {toast && <div className="toast">{toast}</div>}
      {state.phase === 'FINISHED' && state.winner && (
        <WinnerOverlay
          name={state.winner.name}
          cardNumber={state.winner.cardNumber}
          prize={state.winner.prize}
          pattern={state.winner.pattern}
          line={state.winner.line}
          card={state.winner.card}
          nextIn={state.nextRoundInSec}
        />
      )}
    </div>
  );
}
