import type { PlanRequest } from './api';
import { formatToken, toUnits } from './format';
import { ADDRESS, POSITIVE_DECIMAL } from './validation';

export type StepStatus = 'claimed' | 'unlocked' | 'locked';

/**
 * Status of step `index` (0-based). `lastClaimedStep` is the number of steps already claimed
 * (the contract's counter), and `chainTime` is the latest block timestamp, never the browser clock.
 */
export function stepStatus(index: number, unlockTime: number, lastClaimedStep: number, chainTime: number): StepStatus {
  if (index < lastClaimedStep) return 'claimed';
  return unlockTime <= chainTime ? 'unlocked' : 'locked';
}

// ---- Custom plan rows (PlanEditor "Custom" mode). Times are chain time (UTC), never the browser clock. ----


export const DAY = 86400;

/** One custom step: unlock given as "+N days from chain now" or as a UTC date-time (datetime-local value). */
export type CustomRow = { unlock: 'days' | 'date'; days: string; date: string; amount: string };

/** "2026-12-01T00:00" (read as UTC, like every time shown in the app) → unix seconds, or NaN. */
export function parseUtcDateTime(v: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v.trim())) return NaN;
  const ms = new Date(`${v.trim()}Z`).getTime();
  return Number.isNaN(ms) ? NaN : Math.floor(ms / 1000);
}

/** unix seconds → "YYYY-MM-DDTHH:MM" (UTC), the value a datetime-local input takes; with seconds → "…:SS". */
export function toUtcDateTimeInput(t: number, withSeconds = false): string {
  return new Date(t * 1000).toISOString().slice(0, withSeconds ? 19 : 16);
}

/** An existing schedule → Custom rows with exact (second-precision) UTC unlocks, for "Edit plan". */
export function scheduleToRows(schedule: { unlockTime: number; amount: string }[]): CustomRow[] {
  return schedule.map((st) => ({ unlock: 'date', days: '', date: toUtcDateTimeInput(st.unlockTime, true), amount: st.amount }));
}

/** A row's unlock time in unix seconds, or NaN if it can't be read. */
export function rowUnlockTime(row: CustomRow, chainTime: number): number {
  if (row.unlock === 'date') return parseUtcDateTime(row.date);
  const d = row.days.trim();
  return /^\d+(\.\d+)?$/.test(d) ? chainTime + Math.round(Number(d) * DAY) : NaN;
}

/** Sum of the row amounts as "1200.0", or '' if any amount can't be read. */
export function sumAmounts(rows: CustomRow[]): string {
  try {
    return formatToken(rows.reduce((a, r) => a + toUnits(/^\d+(\.\d+)?$/.test(r.amount.trim()) ? r.amount.trim() : 'x'), 0n));
  } catch {
    return '';
  }
}

/** Move row i by delta (−1 up, +1 down); out-of-range moves return the rows unchanged. */
export function moveRow<T>(rows: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= rows.length) return rows;
  const out = [...rows];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/**
 * Turn the Custom form into a schedule request. With `asIs` every frontend check is skipped (0 rows, zero amounts,
 * a total that differs from the sum, bad order all reach the contract); only unreadable times/amounts still block,
 * since they can't be sent at all.
 */
export function buildCustomRequest(p: {
  user: string;
  rows: CustomRow[];
  total: string;
  asIs: boolean;
  chainTime?: number;
}): { request?: PlanRequest; error?: string } {
  if (p.chainTime === undefined) return { error: 'Waiting for chain time' };
  const times = p.rows.map((r) => rowUnlockTime(r, p.chainTime!));
  const total = p.total.trim();
  if (times.some((t) => Number.isNaN(t))) return { error: 'Every unlock needs a valid number of days or a date-time' };
  if (p.rows.some((r) => !/^\d+(\.\d{1,18})?$/.test(r.amount.trim()))) return { error: 'Amounts must be numbers ≥ 0 (at most 18 decimals)' };
  if (!/^\d+(\.\d{1,18})?$/.test(total)) return { error: 'Total must be a number ≥ 0 (at most 18 decimals)' };
  if (!p.asIs) {
    const sum = sumAmounts(p.rows);
    if (!ADDRESS.test(p.user.trim())) return { error: 'User must be a 0x address' };
    if (p.rows.length === 0) return { error: 'Add at least one step' };
    if (times.some((t, i) => i > 0 && t <= times[i - 1])) return { error: 'Unlock times must increase' };
    if (p.rows.some((r) => !POSITIVE_DECIMAL.test(r.amount.trim()))) return { error: 'Amounts must be above 0' };
    if (!POSITIVE_DECIMAL.test(total)) return { error: 'Total must be above 0' };
    if (toUnits(total) !== toUnits(sum)) return { error: `Total ${total} ≠ sum of steps ${sum}` };
  }
  return {
    request: {
      kind: 'schedule',
      body: { user: p.user.trim(), totalAmount: total, schedule: p.rows.map((r, i) => ({ unlockTime: times[i], amount: r.amount.trim() })) },
    },
  };
}
