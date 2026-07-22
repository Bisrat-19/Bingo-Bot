import { memo } from 'react';

interface Props {
  balance: number;
  stake: number;
  playersCount: number;
  /** A round the player already holds cards in. */
  inRound: boolean;
  phase: string;
  onPlay: () => void;
}

/**
 * The landing screen: welcome, balance, and the single live table.
 *
 * The room runs one game at a time, so there is exactly one stake to choose — the one
 * the admin has configured. Offering a list of stakes here would be inventing tables
 * that do not exist.
 */
function HomeScreenImpl({ balance, stake, playersCount, inRound, phase, onPlay }: Props) {
  const affordable = balance >= stake;
  const live = phase === 'PLAYING';

  return (
    <div className="home">
      <div className="home-hero">
        <div className="hero-blob a" />
        <div className="hero-blob b" />
        <div className="hero-title">
          Welcome to
          <br />
          Chewata
        </div>
      </div>

      <div className="home-balance">
        <span className="wallet-chip">
          <span aria-hidden>👛</span> {balance}
        </span>
      </div>

      <div className="stake-box">
        <div className="stake-box-title">Choose Your Stake</div>

        <button
          className={'stake-row' + (affordable ? '' : ' poor')}
          onPointerDown={affordable ? onPlay : undefined}
          onClick={(e) => e.preventDefault()}
          disabled={!affordable}
        >
          <span className="stake-play">{inRound ? 'Resume' : 'Play'}</span>
          <span className="stake-amount">{stake}</span>
        </button>

        {!affordable && (
          <div className="stake-note">
            You need <b>{stake}</b> birr to join. Top up from the bot with 💰 Deposit.
          </div>
        )}
      </div>

      <div className="home-status">
        <span className={'status-dot' + (live ? ' live' : '')} />
        {live
          ? `Round in progress · ${playersCount} playing`
          : playersCount > 0
            ? `${playersCount} player${playersCount === 1 ? '' : 's'} picking cards`
            : 'Table open · be the first in'}
      </div>
    </div>
  );
}

export const HomeScreen = memo(HomeScreenImpl);
