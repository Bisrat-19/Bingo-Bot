/**
 * Short-lived, in-memory conversation state for the deposit/withdraw wizards.
 *
 * These flows take under a minute, so keeping them in memory is fine — if the server
 * restarts mid-flow the user simply starts again (nothing has been charged yet at that
 * point; withdrawals only hold coins at the final step).
 */

export type Flow = 'deposit' | 'withdraw' | 'register' | 'config';

export interface WizardState {
  flow: Flow;
  step: 'name' | 'phone' | 'amount' | 'receipt' | 'value';
  /** For the admin config flow: which setting is being edited. */
  configKey?: string;
  fullName?: string;
  phone?: string;
  amount?: number;
  startedAt: number;
}

const TTL_MS = 15 * 60 * 1000;
const states = new Map<string, WizardState>();

const key = (telegramId: number | bigint) => String(telegramId);

export function startWizard(telegramId: number | bigint, flow: Flow): WizardState {
  const state: WizardState = { flow, step: 'name', startedAt: Date.now() };
  states.set(key(telegramId), state);
  return state;
}

export function getWizard(telegramId: number | bigint): WizardState | undefined {
  const s = states.get(key(telegramId));
  if (!s) return undefined;
  if (Date.now() - s.startedAt > TTL_MS) {
    states.delete(key(telegramId));
    return undefined;
  }
  return s;
}

export function setWizard(telegramId: number | bigint, patch: Partial<WizardState>): void {
  const s = getWizard(telegramId);
  if (!s) return;
  states.set(key(telegramId), { ...s, ...patch });
}

export function clearWizard(telegramId: number | bigint): void {
  states.delete(key(telegramId));
}
