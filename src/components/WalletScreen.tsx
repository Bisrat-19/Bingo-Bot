'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSummary } from '@/lib/queries';

/**
 * Friendly label per ledger reason — the words the player reads in their history.
 */
const LABEL: Record<string, string> = {
  DEPOSIT: 'Deposit',
  WITHDRAWAL_HOLD: 'Withdrawal',
  WITHDRAWAL_REFUND: 'Withdrawal returned',
  ENTRY_FEE: 'Stake',
  PRIZE: 'Won',
  ROUND_REFUND: 'Refund',
  ADMIN_ADJUST: 'Adjustment',
  BONUS: 'Bonus',
  SIGNUP_BONUS: 'Welcome bonus',
};

const GAME_REASONS = new Set(['ENTRY_FEE', 'PRIZE', 'ROUND_REFUND']);

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WalletScreen() {
  const { data, isFetching, refetch } = useSummary();
  const [tab, setTab] = useState<'balances' | 'history'>('balances');

  const b = data?.balances;

  return (
    <div className="panelscreen">
      <div className="ps-head">
        <div>
          <div className="ps-label">Wallet</div>
          <div className="ps-big">{b?.total ?? 0} Birr</div>
          <div className="ps-sub">Total balance</div>
        </div>
        <button
          className="ps-reload icon"
          onPointerDown={() => void refetch()}
          onClick={(e) => e.preventDefault()}
          aria-label="Reload"
        >
          <RefreshCw size={18} strokeWidth={2.4} className={isFetching ? 'spin' : ''} />
        </button>
      </div>

      <div className="seg2">
        <button className={tab === 'balances' ? 'on' : ''} onPointerDown={() => setTab('balances')}>
          Balances
        </button>
        <button className={tab === 'history' ? 'on' : ''} onPointerDown={() => setTab('history')}>
          History
        </button>
      </div>

      {tab === 'balances' ? (
        <>
          <div className="totalcard">
            <div className="totalcard-label">Total balance</div>
            <div className="totalcard-value">{b?.total ?? 0} Birr</div>
          </div>

          <div className="bucket-row">
            <div className="bucket">
              <div className="bucket-k">Main</div>
              <div className="bucket-v">{b?.main ?? 0} Birr</div>
            </div>
            <div className="bucket">
              <div className="bucket-k">Bonus</div>
              <div className="bucket-v">{b?.bonus ?? 0} Birr</div>
            </div>
            <div className="bucket">
              <div className="bucket-k">Deposited</div>
              <div className="bucket-v">{b?.deposited ?? 0} Birr</div>
            </div>
          </div>

          <div className="ps-note">
            Main is prizes you have won. Bonus is spent first and cannot be withdrawn;
            deposits and winnings can.
          </div>
        </>
      ) : (
        <div className="ledger">
          {data && data.ledger.length === 0 && <div className="ps-empty">No transactions yet.</div>}
          {data?.ledger.map((l, i) => (
            <div className="ledger-row" key={i}>
              <div>
                <div className="ledger-reason">{LABEL[l.reason] ?? l.reason}</div>
                <div className="ledger-date">
                  {fmtDate(l.createdAt)}
                  {GAME_REASONS.has(l.reason) && l.refId && (
                    <> · Game #{l.refId.slice(-6).toUpperCase()}</>
                  )}
                </div>
              </div>
              <div className={'ledger-delta ' + (l.delta >= 0 ? 'plus' : 'minus')}>
                {l.delta >= 0 ? '+' : ''}
                {l.delta} <span className="ledger-bal">{l.balanceAfter} Birr</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
