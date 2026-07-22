'use client';

import { useSummary } from '@/lib/queries';

export function ProfileScreen() {
  const { data } = useSummary();

  const a = data?.account;
  const b = data?.balances;
  const s = data?.stats;
  const name = a?.username ? `@${a.username}` : (a?.firstName ?? 'Player');

  return (
    <div className="panelscreen">
      <div className="ps-label">Account</div>
      <div className="acct">
        <div className="acct-avatar">{(a?.username || a?.firstName || '?').charAt(0).toUpperCase()}</div>
        <div>
          <div className="acct-name">{name}</div>
          <div className="acct-phone">{a?.phone ? `📞 ${a.phone}` : 'No phone on file'}</div>
        </div>
      </div>

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

      <div className="ps-label">Stats</div>
      <div className="statlist">
        <div className="statrow">
          <span>💳 Total withdrawal</span>
          <b>{s?.totalWithdrawal ?? 0} Birr</b>
        </div>
        <div className="statrow">
          <span>💰 Total deposit</span>
          <b>{s?.totalDeposit ?? 0} Birr</b>
        </div>
        <div className="statrow">
          <span>🏆 Games won</span>
          <b>{s?.gamesWon ?? 0}</b>
        </div>
        <div className="statrow">
          <span>🎲 Games played</span>
          <b>{s?.gamesPlayed ?? 0}</b>
        </div>
      </div>
    </div>
  );
}
