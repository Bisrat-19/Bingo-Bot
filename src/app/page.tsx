'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getTgProfile, haptic, initTelegram } from '@/lib/telegram';
import { ensureSession } from '@/lib/session';
import { useInvalidatePlayerData } from '@/lib/queries';
import type { ActionResult, RoomState } from '@/lib/types';
import { CardSelect } from '@/components/CardSelect';
import { GameScreen } from '@/components/GameScreen';
import { WinnerOverlay } from '@/components/WinnerOverlay';
import { RegisterScreen } from '@/components/RegisterScreen';
import { BottomNav, type Tab } from '@/components/BottomNav';
import { HomeScreen } from '@/components/HomeScreen';
import { HistoryScreen } from '@/components/HistoryScreen';
import { WalletScreen } from '@/components/WalletScreen';
import { ProfileScreen } from '@/components/ProfileScreen';

type Res = ActionResult | { error: string };
function isErr<T extends object>(r: T | { error: string }): r is { error: string } {
  return 'error' in r;
}

export default function Page() {
  const [state, setState] = useState<RoomState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /** Which of the four sections is showing. */
  const [tab, setTab] = useState<Tab>('home');
  /** True once the player has entered the table from Home. */
  const [inGame, setInGame] = useState(false);

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
  const [sound, setSound] = useState(true);

  const prevCalled = useRef<Set<number>>(new Set());
  /** Drives the adaptive poll rate (fast while picking, calmer while playing). */
  const phaseRef = useRef<string>('');
  const pace = useRef<() => void>(() => {});
  const first = useRef(true);
  const toastTimer = useRef<number | undefined>(undefined);
  const inflight = useRef(false);
  const roundRef = useRef<string | null>(null);
  const sigRef = useRef<string>('');
  const stateRef = useRef<RoomState | null>(null);
  stateRef.current = state;
  /**
   * The round the player chose to step away from. Mid-round their cards stay in play
   * (and can still win), but they asked to leave the table, so we must not drag them
   * back on the next poll.
   */
  const leftRound = useRef<string | null>(null);
  // Drop the cached Wallet/History/Profile data whenever money moves or a round ends.
  const invalidate = useInvalidatePlayerData();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const prevCoins = useRef<number | null>(null);
  /**
   * Polls overlap (they fire on an interval, not back-to-back), so responses can arrive
   * out of order. A stale snapshot applied after a fresh one briefly resurrects old
   * state — a just-released card flashing back to "taken". Sequence numbers make sure
   * only ever-newer snapshots are applied.
   */
  const reqSeq = useRef(0);
  const appliedSeq = useRef(0);

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

  useEffect(() => {
    // Auto is intentionally NOT restored: every game starts in MANUAL by default.
    try {
      setSound(localStorage.getItem('bingo_sound') !== 'off');
    } catch {
      /* storage can be unavailable; the default is fine */
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  const refresh = useCallback(async () => {
    const seq = ++reqSeq.current;
    const s = await api.state();
    if (isErr(s)) return;
    if (seq <= appliedSeq.current) return; // an older response finishing late — discard
    appliedSeq.current = seq;
    const newly = s.called.filter((n) => !prevCalled.current.has(n));
    if (newly.length && !first.current) haptic('light');
    prevCalled.current = new Set(s.called);
    first.current = false;

    // A new round clears any optimistic pick.
    if (roundRef.current !== s.roundId) {
      const firstEver = roundRef.current === null;
      roundRef.current = s.roundId;
      leftRound.current = null;
      invalidateRef.current('all'); // a round ended/started: history and balance may have changed
      setPendingCards(new Set());
      setReleasing(new Set());
      setLocalMarks(new Map());
      // Auto is per-game: every new round starts in MANUAL. (Skip the very first poll so
      // we don't fight the initial mount.)
      if (!firstEver) setMode('manual');
    }

    const sig = [
      s.roundId,
      s.phase,
      s.secondsLeft,
      s.currentNumber,
      s.called.length,
      s.takenCards.join(','),
      s.myCards.map((c) => c.cardNumber).join(','),
      s.myCards.reduce((n, c) => n + c.marked.length, 0),
      s.myCards.map((c) => (c.hasBingo ? 1 : 0)).join(''),
      s.playersCount,
      s.coins,
      s.pot,
      s.winAmount,
      s.entryFee,
      s.nextRoundInSec,
      s.winner?.cardNumber ?? '',
    ].join('|');

    // Balance moved (stake, win, deposit, refund) -> the wallet cache is stale.
    if (prevCoins.current !== null && s.coins != null && s.coins !== prevCoins.current) {
      invalidateRef.current('summary');
    }
    if (s.coins != null) prevCoins.current = s.coins;

    phaseRef.current = s.phase;
    pace.current();
    if (sig === sigRef.current) return;
    sigRef.current = sig;
    setState(s);

    // A release is confirmed once the card is no longer ours.
    setReleasing((prev) => {
      if (prev.size === 0) return prev;
      const held = new Set(s.myCards.map((c) => c.cardNumber));
      const next = new Set([...prev].filter((n) => held.has(n)));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  // Log in once (initData -> JWT), then poll to keep everyone in sync.
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

  /** Holding a card puts you at the table, unless you deliberately left this round. */
  useEffect(() => {
    if (!state || state.myCards.length === 0) return;
    if (leftRound.current === state.roundId) return;
    setInGame(true);
  }, [state]);

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
          void api.mark(0, c.cardNumber, hits);
        }
        return carried;
      });
    }

    setMode(next);
    haptic('light');
  }, []);

  const changeSound = useCallback((on: boolean) => {
    setSound(on);
    try {
      localStorage.setItem('bingo_sound', on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, []);

  const onSelect = useCallback(
    async (n: number) => {
      const cur = stateRef.current;
      if (!cur || cur.phase !== 'SELECTING') return;
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
    [refresh, showToast],
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
      const cur = stateRef.current;
      if (!cur) return;
      if (!cur.called.includes(n)) {
        haptic('error');
        showToast(`${n} not called yet!`);
        return;
      }
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
    [showToast],
  );

  const onBingo = useCallback(
    async (auto = false) => {
      // Fired on pointer-down for the lowest possible latency: with "first valid press
      // wins", every millisecond counts. The ref de-dupes without disabling the button.
      if (inflight.current) return;
      inflight.current = true;
      setClaiming(true);
      haptic('light');
      const res = await api.bingo();
      inflight.current = false;
      setClaiming(false);

      if (isErr(res)) {
        if (!auto) showToast('Network error');
      } else if (res.ok) {
        haptic('success');
        showToast(
          res.cardNumber != null ? `🎉 BINGO on card #${res.cardNumber}! You win!` : '🎉 BINGO! You win!',
        );
      } else if (auto) {
        // A missed auto attempt is normal; staying silent keeps the screen calm.
      } else if (res.reason === 'invalid') {
        haptic('error');
        showToast('❌ Not a win');
      } else if (res.reason === 'passed') {
        haptic('error');
        showToast('⏭️ Too late');
      } else if (res.reason === 'cooldown') {
        showToast(`⏳ Wait ${res.retryAfterSec}s before trying again.`);
      } else {
        showToast(res.reason || 'Not yet!');
      }
      void refresh();
    },
    [refresh, showToast],
  );

  /**
   * AUTO mode: claim the moment the server says one of your cards completed a line on
   * the ball just called. Keyed off `currentNumber`, so it fires at most once per ball.
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

  const leaveTable = useCallback(async () => {
    const cur = stateRef.current;
    // Leaving during selection gives the stake back; mid-round the cards stay in play.
    if (cur?.phase === 'SELECTING' && cur.myCards.length > 0) {
      await api.deselect();
      void refresh();
    }
    if (cur) leftRound.current = cur.roundId;
    setInGame(false);
    setTab('home');
  }, [refresh]);

  if (!state) return <div className="loading">Connecting to the Bingo room…</div>;

  if (!state.registered) {
    const profile = getTgProfile();
    return (
      <div className="app">
        <RegisterScreen name={profile.name} />
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  const selecting = state.phase === 'SELECTING';
  const holdsCards = state.myCards.length > 0;
  // Confirmed cards plus any pick still in flight, so the grid never flickers.
  const myCardNumbers = [...new Set([...state.myCards.map((c) => c.cardNumber), ...pendingCards])]
    .filter((n) => !releasing.has(n))
    .sort((a, b) => a - b);

  // The table takes over the screen only while the player is actually at it.
  const atTable = inGame && tab === 'home';
  // The live game is full-screen with its own action bar, so the app's bottom nav is
  // hidden — matching how the round takes over the whole display.
  const inLiveGame = atTable && !selecting && holdsCards;

  return (
    <div className={'app' + (inLiveGame ? ' ingame' : '')}>
      {atTable ? (
        selecting || !holdsCards ? (
          <CardSelect
            balance={state.coins ?? 0}
            onLeave={() => void leaveTable()}
            onRefresh={() => void refresh()}
            poolSize={state.poolSize}
            taken={state.takenCards.filter((n) => !myCardNumbers.includes(n) && !releasing.has(n))}
            mine={myCardNumbers}
            maxCards={state.maxCards}
            secondsLeft={state.secondsLeft}
            playersCount={state.playersCount}
            entryFee={state.entryFee}
            busy={false}
            onSelect={onSelect}
            onDeselect={onDeselect}
          />
        ) : (
          <GameScreen
            state={state}
            mode={mode}
            claiming={claiming}
            localMarks={localMarks}
            onMode={changeMode}
            onMark={onMark}
            onBingo={() => void onBingo(false)}
            onLeave={() => void leaveTable()}
            onRefresh={() => void refresh()}
          />
        )
      ) : tab === 'home' ? (
        <HomeScreen
          balance={state.coins ?? 0}
          stake={state.entryFee}
          playersCount={state.playersCount}
          inRound={holdsCards}
          phase={state.phase}
          onPlay={() => {
            setInGame(true);
            setTab('home');
            haptic('light');
          }}
        />
      ) : tab === 'history' ? (
        <HistoryScreen />
      ) : tab === 'wallet' ? (
        <WalletScreen />
      ) : (
        <ProfileScreen />
      )}

      {/* The live game has its own Leave/Refresh/BINGO bar, so the app nav steps aside. */}
      {!inLiveGame && (
        <BottomNav
          tab={tab}
          playing={holdsCards}
          onChange={(t) => {
            setTab(t);
            haptic('light');
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}

      {state.phase === 'FINISHED' && state.winner && atTable && (
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
