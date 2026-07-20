import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ALL_PATTERNS, type GameSettings } from '@/lib/types';

interface Props {
  onClose: () => void;
  onSaved: (msg: string) => void;
}

/** Numeric settings only — patterns are toggled separately below. */
type NumericKey = Exclude<keyof GameSettings, 'patterns'>;

const FIELDS: { key: NumericKey; label: string; hint: string }[] = [
  { key: 'selectionSeconds', label: 'Selection window', hint: 'seconds after the first pick' },
  { key: 'drawIntervalSeconds', label: 'Draw interval', hint: 'seconds between numbers' },
  { key: 'winnerDisplaySeconds', label: 'Winner display', hint: 'seconds before next round' },
  { key: 'minPlayers', label: 'Minimum players', hint: 'needed to start a round' },
  { key: 'startingCoins', label: 'Starting coins', hint: 'given to new players' },
  { key: 'entryFee', label: 'Entry fee', hint: 'coins charged per card' },
  { key: 'falseBingoCooldownSec', label: 'Wrong-bingo cooldown', hint: '0 = no cooldown' },
];

// Live game configuration. The server re-checks admin rights on every request.
export function AdminPanel({ onClose, onSaved }: Props) {
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await api.getSettings();
      if ('error' in res) setError('Network error');
      else if (!res.ok) setError(res.reason || 'Not allowed');
      else setSettings(res.settings);
    })();
  }, []);

  const setField = (key: NumericKey, value: string) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value === '' ? 0 : Number(value) });
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    const res = await api.saveSettings(settings);
    setSaving(false);
    if ('error' in res) setError('Network error');
    else if (!res.ok) setError(res.reason || 'Could not save');
    else {
      setSettings(res.settings);
      onSaved('⚙️ Settings saved');
      onClose();
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="admin-panel" onClick={(e) => e.stopPropagation()}>
        <div className="admin-head">
          <span>⚙️ Game settings</span>
          <button className="admin-x" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {!settings && !error && <div className="admin-loading">Loading…</div>}

        {settings && (
          <>
            <div className="admin-fields">
              {FIELDS.map((f) => (
                <label key={f.key} className="admin-field">
                  <span className="af-label">{f.label}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={settings[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                  <span className="af-hint">{f.hint}</span>
                </label>
              ))}
            </div>
            <div className="admin-section">Winning patterns</div>
            <div className="pattern-list">
              {ALL_PATTERNS.map((p) => {
                const on = settings.patterns?.includes(p.key) ?? false;
                return (
                  <button
                    key={p.key}
                    className={'pattern-chip' + (on ? ' on' : '')}
                    onClick={() => {
                      const cur = settings.patterns ?? [];
                      const next = on ? cur.filter((x) => x !== p.key) : [...cur, p.key];
                      if (next.length === 0) return; // at least one must stay enabled
                      setSettings({ ...settings, patterns: next });
                    }}
                  >
                    {on ? '✓ ' : ''}
                    {p.label}
                  </button>
                );
              })}
            </div>

            <button className="admin-save" disabled={saving} onClick={save}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            <p className="admin-note">
              Changes apply to the next round (current timers keep their values).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
