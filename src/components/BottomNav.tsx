import { memo } from 'react';
import { Gamepad2, History, Wallet, User, type LucideIcon } from 'lucide-react';

export type Tab = 'home' | 'history' | 'wallet' | 'profile';

const TABS: { key: Tab; label: string; Icon: LucideIcon }[] = [
  { key: 'home', label: 'Game', Icon: Gamepad2 },
  { key: 'history', label: 'History', Icon: History },
  { key: 'wallet', label: 'Wallet', Icon: Wallet },
  { key: 'profile', label: 'Profile', Icon: User },
];

/**
 * The app's main navigation. While a round is in progress the Game tab reads "Playing"
 * and pulses, so it is obvious the player is in a live round from any screen.
 */
function BottomNavImpl({
  tab,
  playing,
  onChange,
}: {
  tab: Tab;
  playing: boolean;
  onChange: (t: Tab) => void;
}) {
  return (
    <nav className="bottomnav">
      {TABS.map(({ key, label, Icon }) => {
        const on = tab === key;
        const live = key === 'home' && playing;
        return (
          <button
            key={key}
            className={'navbtn' + (on ? ' on' : '') + (live ? ' live' : '')}
            onPointerDown={() => onChange(key)}
            onClick={(e) => e.preventDefault()}
          >
            <Icon className="navicon" size={20} strokeWidth={2.2} />
            <span className="navlabel">{live ? 'Playing' : label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export const BottomNav = memo(BottomNavImpl);
